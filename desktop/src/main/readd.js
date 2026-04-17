/**
 * readd.js
 *
 * Executes the remove-then-re-add sequence for a single cart item.
 *
 * Strategy:
 *   1. Remove the item via its trash button (humanClick for CF safety)
 *   2. Wait for cart DOM to confirm removal (item count drops)
 *   3. Navigate to the product page
 *   4. Click "ADD TO CART" — also via humanClick
 *   5. Navigate back to /cart and return fresh parse
 *
 * Failure modes handled:
 *   - Item sold out between remove and re-add: we detect missing ADD TO CART
 *     button and log a warning instead of throwing
 *   - Navigation timeout: caught and logged, cart state preserved
 *   - CF interstitial on product page: detected by title check, abort + log
 */

const { humanClick } = require('./human-click');
const { parseCart } = require('./cart-parser');
const { pushLog } = require('./log-buffer');
const { markRefreshNow } = require('./runtime-status');
const { APP_CONFIG } = require('./config');

const NAV_OPTS = { waitUntil: 'domcontentloaded', timeout: 30_000 };

// Selectors for the product page ADD TO CART button.
// ThredUp uses a few variants — we try them in order.
const ADD_TO_CART_SELECTORS = [
  'button:has-text("ADD TO CART")',
  'button:has-text("Add to Cart")',
  'button:has-text("Add to Bag")',
  '[data-testid="add-to-cart"]',
];

async function reAdd(page, item) {
  const { title, productUrl, removeSelector, index } = item;

  pushLog('info', 'readd_start', `Starting re-add for item ${index}: ${title}`, {
    productUrl,
    secondsLeft: item.secondsLeft,
  });

  // ── Step 1: Navigate to cart if not already there ──────────────────────────
  if (!page.url().includes('/cart')) {
    await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  }

  // Count items before removal so we can confirm it worked
  const countBefore = (await parseCart(page)).length;

  // ── Step 2: Remove ──────────────────────────────────────────────────────────
  try {
    await humanClick(page, removeSelector);
    pushLog('info', 'readd_removed', `Clicked remove for: ${title}`);
  } catch (e) {
    pushLog('error', 'readd_remove_failed', `Could not click remove button`, {
      selector: removeSelector,
      error: String(e),
    });
    return { ok: false, reason: 'remove_click_failed' };
  }

  // Wait for DOM to reflect removal (item count drops or item disappears)
  try {
    await page.waitForFunction(
      (expectedCount) => {
        const timers = Array.from(document.querySelectorAll('*'))
          .filter(el => /Reserved for/i.test(el.textContent) &&
                        el.querySelectorAll('*').length < 5);
        return timers.length <= expectedCount;
      },
      countBefore - 1,
      { timeout: 8_000 }
    );
  } catch {
    // Soft failure — cart may have re-rendered; proceed anyway
    pushLog('warn', 'readd_remove_confirm_timeout', 'Could not confirm removal via DOM, proceeding');
  }

  // Small human-like pause after removing
  await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

  // ── Step 3: Navigate to product page ────────────────────────────────────────
  if (!productUrl) {
    pushLog('error', 'readd_no_url', `No product URL for item: ${title}`);
    return { ok: false, reason: 'no_product_url' };
  }

  try {
    await page.goto(productUrl, NAV_OPTS);
  } catch (e) {
    pushLog('error', 'readd_nav_failed', `Navigation to product page failed`, { error: String(e) });
    return { ok: false, reason: 'navigation_failed' };
  }

  // Detect CF interstitial
  const pageTitle = await page.title();
  if (/just a moment|cloudflare|checking your browser/i.test(pageTitle)) {
    pushLog('error', 'readd_cf_block', `Cloudflare blocked product page navigation`, { url: productUrl });
    return { ok: false, reason: 'cloudflare_block' };
  }

  // ── Step 4: Click ADD TO CART ────────────────────────────────────────────────
  let addSelector = null;
  for (const sel of ADD_TO_CART_SELECTORS) {
    const visible = await page.locator(sel).first().isVisible().catch(() => false);
    if (visible) { addSelector = sel; break; }
  }

  if (!addSelector) {
    pushLog('warn', 'readd_sold_out', `ADD TO CART button not found — item may be sold out`, {
      title,
      url: productUrl,
    });
    // Navigate back to cart to keep watcher in sync
    await page.goto(APP_CONFIG.cartUrl, NAV_OPTS).catch(() => {});
    return { ok: false, reason: 'sold_out' };
  }

  try {
    await humanClick(page, addSelector);
    pushLog('info', 'readd_added', `Clicked ADD TO CART for: ${title}`);
  } catch (e) {
    pushLog('error', 'readd_add_failed', `Could not click ADD TO CART`, { error: String(e) });
    return { ok: false, reason: 'add_click_failed' };
  }

  // Wait briefly for cart confirmation UI (badge update, modal, etc.)
  await new Promise(r => setTimeout(r, 1_200 + Math.random() * 600));

  // ── Step 5: Return to cart ───────────────────────────────────────────────────
  await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  markRefreshNow();

  const updatedCart = await parseCart(page);
  const reAdded = updatedCart.find(i => i.productUrl === productUrl);

  if (reAdded) {
    pushLog('info', 'readd_confirmed', `Re-add confirmed. New timer: ${reAdded.rawTimer}`, {
      title,
      newSecondsLeft: reAdded.secondsLeft,
    });
    return { ok: true, item: reAdded };
  } else {
    pushLog('warn', 'readd_unconfirmed', `Item not found in cart after re-add — may need manual check`, { title });
    return { ok: false, reason: 'not_in_cart_after_readd' };
  }
}

module.exports = { reAdd };

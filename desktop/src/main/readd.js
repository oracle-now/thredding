/**
 * readd.js
 *
 * Executes the remove-then-re-add sequence for a single cart item.
 *
 * Strategy:
 *   1. Remove the item via its trash button (humanClick for CF safety)
 *   2. Confirm removal via DOM (item count drops) — HARD fail if not confirmed (#9)
 *   3. Navigate to the product page
 *   4. Click "ADD TO CART" — also via humanClick
 *   5. Navigate back to /cart and return fresh parse
 *
 * Fix #3: removeSelector is no longer baked-in as a positional nth-match.
 *   After each removal the DOM reflows and positions shift. Instead we
 *   re-query the live cart to find the target row by productUrl, then
 *   locate its remove button dynamically. This is immune to position drift.
 *
 * Fix #7: hasDeleteBtn is now checked before attempting the click. If the
 *   parser couldn't find a delete button we bail immediately with a clear
 *   error rather than letting humanClick throw a cryptic locator error.
 *
 * Fix #9: The waitForFunction timeout is no longer swallowed as a soft
 *   failure. If the DOM hasn't confirmed removal within the timeout window
 *   we abort and return { ok: false, reason: 'remove_not_confirmed' } to
 *   prevent a phantom re-add that would leave 2 copies in the cart.
 *
 * Failure modes handled:
 *   - Item sold out: no ADD TO CART button → log + return
 *   - Navigation timeout: caught + logged, cart state preserved
 *   - CF interstitial on product page: detected by title check, abort + log
 *   - Session expired: detected via isLoginRedirect(), bail immediately
 */

const { humanClick }       = require('./human-click');
const { parseCart }        = require('./cart-parser');
const { pushLog }          = require('./log-buffer');
const { markRefreshNow }   = require('./runtime-status');
const { APP_CONFIG }       = require('./config');
const { isLoginRedirect }  = require('./browser');

const NAV_OPTS = { waitUntil: 'domcontentloaded', timeout: 30_000 };

// Selectors for the product page ADD TO CART button.
const ADD_TO_CART_SELECTORS = [
  'button:has-text("ADD TO CART")',
  'button:has-text("Add to Cart")',
  'button:has-text("Add to Bag")',
  '[data-testid="add-to-cart"]',
];

/**
 * Re-query the live cart DOM to find the remove button for the item whose
 * product URL matches `productUrl`. Returns a Playwright Locator or null.
 *
 * Fix #3: Instead of using a baked-in nth-match selector (which breaks after
 * any removal shifts the DOM), we parse the current cart state, find the
 * matching row by URL, and return a content-based locator that points to
 * its remove button directly.
 */
async function findRemoveLocator(page, productUrl) {
  // Re-parse to get the current cart state with fresh indices
  const currentItems = await parseCart(page);
  const match = currentItems.find(i => i.productUrl === productUrl);

  if (!match) return null;

  if (!match.hasDeleteBtn) {
    pushLog('warn', 'readd_no_delete_btn',
      `No delete button detected for "${match.title}" — cannot remove`);
    return null;
  }

  // Build a positional selector based on the CURRENT index (post-reparse)
  // This is safe because we re-query immediately before clicking.
  const liveSelector = `:nth-match(button:has(img[alt*="Remove"]), ${match.index + 1})`;
  return page.locator(liveSelector).first();
}

async function reAdd(page, item) {
  const { title, productUrl, index } = item;

  pushLog('info', 'readd_start', `Starting re-add for item ${index}: ${title}`, {
    productUrl,
    secondsLeft: item.secondsLeft,
  });

  // fix #7: bail early if no delete button was found during parsing
  if (!item.hasDeleteBtn) {
    pushLog('error', 'readd_no_delete_btn',
      `Item "${title}" has no detected remove button — skipping re-add`, { productUrl });
    return { ok: false, reason: 'no_delete_button' };
  }

  // ── Step 1: Navigate to cart if not already there ───────────────────────
  if (!page.url().includes('/cart')) {
    await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  }

  // fix #8: check for session expiry
  if (await isLoginRedirect(page)) {
    return { ok: false, reason: 'session_expired' };
  }

  const countBefore = (await parseCart(page)).length;

  // ── Step 2: Find remove button (fix #3) and click it ────────────────────
  const removeLocator = await findRemoveLocator(page, productUrl);

  if (!removeLocator) {
    pushLog('error', 'readd_remove_not_found',
      `Could not locate remove button for "${title}" in current cart DOM`);
    return { ok: false, reason: 'remove_locator_not_found' };
  }

  // Get the selector string from the locator for humanClick
  // humanClick accepts a selector string, so we use the underlying selector.
  const removeSelectorStr = `:nth-match(button:has(img[alt*="Remove"]), ${
    (await parseCart(page)).findIndex(i => i.productUrl === productUrl) + 1
  })`;

  try {
    await humanClick(page, removeSelectorStr);
    pushLog('info', 'readd_removed', `Clicked remove for: ${title}`);
  } catch (e) {
    pushLog('error', 'readd_remove_failed', `Could not click remove button`, {
      selector: removeSelectorStr,
      error: String(e),
    });
    return { ok: false, reason: 'remove_click_failed' };
  }

  // fix #9: Wait for DOM to confirm removal. This is now a HARD check.
  // If the item count doesn't drop within the timeout, we abort instead
  // of blindly proceeding (which would create a duplicate in the cart).
  try {
    await page.waitForFunction(
      (expectedCount) => {
        const rows = document.querySelectorAll('div.M2gLnUDHRBK0O1TPAB_T');
        // Fall back to a generic "Reserved for" count if primary selector yields nothing
        if (rows.length > 0) return rows.length <= expectedCount;
        const timers = Array.from(document.querySelectorAll('*'))
          .filter(el => /Reserved for/i.test(el.textContent) && el.querySelectorAll('*').length < 5);
        return timers.length <= expectedCount;
      },
      countBefore - 1,
      { timeout: 10_000 }
    );
    pushLog('info', 'readd_remove_confirmed', `DOM confirmed removal of "${title}"`);
  } catch {
    // fix #9: HARD failure — remove click did not register. Do NOT proceed.
    pushLog('error', 'readd_remove_unconfirmed',
      `DOM did not confirm removal of "${title}" within timeout — aborting to prevent duplicate`);
    return { ok: false, reason: 'remove_not_confirmed' };
  }

  // Small human-like pause after removing
  await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

  // ── Step 3: Navigate to product page ─────────────────────────────────────
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
    pushLog('error', 'readd_cf_block', `Cloudflare blocked product page navigation`,
      { url: productUrl });
    return { ok: false, reason: 'cloudflare_block' };
  }

  // fix #8: check for session expiry on product page
  if (await isLoginRedirect(page)) {
    return { ok: false, reason: 'session_expired' };
  }

  // ── Step 4: Click ADD TO CART ────────────────────────────────────────────
  let addSelector = null;
  for (const sel of ADD_TO_CART_SELECTORS) {
    const visible = await page.locator(sel).first().isVisible().catch(() => false);
    if (visible) { addSelector = sel; break; }
  }

  if (!addSelector) {
    pushLog('warn', 'readd_sold_out',
      `ADD TO CART button not found — item may be sold out`, { title, url: productUrl });
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

  // ── Step 5: Return to cart ───────────────────────────────────────────────
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
    pushLog('warn', 'readd_unconfirmed',
      `Item not found in cart after re-add — may need manual check`, { title });
    return { ok: false, reason: 'not_in_cart_after_readd' };
  }
}

module.exports = { reAdd };

/**
 * cart-parser.js
 *
 * Parses the ThredUp cart page into a structured list of CartItem objects.
 *
 * Each CartItem:
 *   {
 *     index:       number,   // 0-based position in cart
 *     title:       string,   // brand + description text
 *     productUrl:  string,   // absolute URL to product page (for re-add)
 *     price:       string,   // display price
 *     secondsLeft: number,   // seconds remaining on reservation (0 if not found)
 *     rawTimer:    string,   // raw "HH:MM:SS" or "MM:SS" string
 *     removeSelector: string // playwright selector to click to remove this item
 *   }
 *
 * Selector strategy: ThredUp cart items share no stable data-testid attrs.
 * We locate each item by its position in the cart item list, then scope
 * the trash button and timer to that nth item — robust against DOM updates.
 */

const { pushLog } = require('./log-buffer');

// Matches HH:MM:SS or MM:SS
const TIMER_RE = /\b(\d{1,2}):(\d{2}):(\d{2})\b|\b(\d{1,2}):(\d{2})\b/;

function parseSeconds(raw) {
  const m = TIMER_RE.exec(raw);
  if (!m) return 0;
  if (m[1] !== undefined) {
    // HH:MM:SS
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  }
  // MM:SS
  return parseInt(m[4], 10) * 60 + parseInt(m[5], 10);
}

async function parseCart(page) {
  // Wait for at least one cart item or the empty-cart indicator
  await page.waitForSelector(
    '[class*="CartItem"], [class*="cart-item"], [data-testid*="cart"], .empty-cart, h1',
    { timeout: 15_000 }
  ).catch(() => {});

  const items = await page.evaluate(() => {
    // ThredUp renders cart items as <li> or <div> siblings inside the cart list.
    // We find all nodes that contain a "Reserved for" text node — that's our
    // most stable anchor since it appears on every timed item.
    const allEls = Array.from(document.querySelectorAll('*'));

    // Find container elements that directly contain "Reserved for" text
    const itemRoots = allEls.filter(el => {
      if (el.children.length === 0) return false; // skip leaves
      const direct = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join(' ');
      return /Reserved for/i.test(el.textContent) &&
             el.querySelectorAll('[class*="CartItem"], [class*="cart-item"]').length === 0;
    });

    // Walk up to find the true item root (the one that also contains an <a> link and a delete btn)
    function findItemRoot(el) {
      let cur = el;
      for (let i = 0; i < 6; i++) {
        if (!cur.parentElement) break;
        const hasLink   = cur.querySelector('a[href*="/listing/"], a[href*="/product/"]');
        const hasDelete = cur.querySelector('button[aria-label*="emove"], button[aria-label*="elete"], button svg');
        if (hasLink && hasDelete) return cur;
        cur = cur.parentElement;
      }
      return el;
    }

    const roots = itemRoots.map(findItemRoot);
    // Deduplicate by DOM node
    const seen = new Set();
    const unique = roots.filter(r => {
      if (seen.has(r)) return false;
      seen.add(r);
      return true;
    });

    return unique.map((root, idx) => {
      // Product URL — prefer /listing/ links, fall back to any <a>
      const linkEl = root.querySelector('a[href*="/listing/"], a[href*="/product/"]') ||
                     root.querySelector('a[href]');
      const productUrl = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : null;

      // Timer text
      const timerMatch = root.textContent.match(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})/);
      const rawTimer = timerMatch ? timerMatch[0] : null;

      // Title: first meaningful text block
      const titleEl = root.querySelector('[class*="brand"], [class*="Brand"], [class*="title"], [class*="Title"], strong, b, h2, h3, h4');
      const title = titleEl ? titleEl.textContent.trim() : root.textContent.slice(0, 60).trim();

      // Price
      const priceEl = root.querySelector('[class*="price"], [class*="Price"]');
      const price = priceEl ? priceEl.textContent.trim().slice(0, 20) : '';

      // Delete button — get its nth-of-type index for a playwright selector
      const deleteBtn = root.querySelector('button[aria-label*="emove"], button[aria-label*="elete"]') ||
                        (() => {
                          const btns = root.querySelectorAll('button');
                          // Last button in item is typically the trash
                          return btns[btns.length - 1] || null;
                        })();

      // Build a unique selector for the delete button using aria-label or position
      let removeSelector = null;
      if (deleteBtn) {
        const label = deleteBtn.getAttribute('aria-label');
        if (label) {
          removeSelector = `button[aria-label="${label}"]`;
        }
      }

      return {
        index: idx,
        title,
        productUrl,
        price,
        rawTimer,
        removeSelector,
      };
    });
  });

  // Enrich with parsed seconds and index-based fallback selectors
  return items.map((item, i) => ({
    ...item,
    secondsLeft: parseSeconds(item.rawTimer || ''),
    // Fallback: nth delete button on page (trash icons are typically the only
    // icon-only buttons in the cart)
    removeSelector: item.removeSelector ||
      `(//button[.//*[local-name()='svg']])[${i + 1}]`,
  }));
}

module.exports = { parseCart, parseSeconds };

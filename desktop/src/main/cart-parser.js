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
 *
 * Key facts from DOM inspection (April 2026):
 *   - Product links use /product/ paths (NOT /listing/)
 *   - Remove buttons have NO aria-label on the <button> itself; the alt text
 *     "Remove item from cart" is on the <img> child inside the button
 *   - Remove buttons do NOT contain <svg>; they contain <img> with trash icon
 *   - Each cart row root has class containing M2gLnUDHRBK0O1TPAB_T
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
    // ThredUp renders each cart item in a row div with a known stable class.
    // Fall back to finding all nodes containing "Reserved for" text if the
    // stable class is ever renamed.
    let rows = Array.from(document.querySelectorAll('div.M2gLnUDHRBK0O1TPAB_T'));

    if (!rows.length) {
      // Fallback: find container elements that contain "Reserved for" text
      const allEls = Array.from(document.querySelectorAll('*'));
      const itemRoots = allEls.filter(el => {
        if (el.children.length === 0) return false;
        return /Reserved for/i.test(el.textContent) &&
               el.querySelectorAll('[class*="CartItem"], [class*="cart-item"]').length === 0;
      });

      function findItemRoot(el) {
        let cur = el;
        for (let i = 0; i < 6; i++) {
          if (!cur.parentElement) break;
          const hasLink   = cur.querySelector('a[href*="/product/"]');
          const hasDelete = cur.querySelector('button:has(img[alt*="emove"])') ||
                            cur.querySelector('button img[alt*="emove"]');
          if (hasLink && hasDelete) return cur;
          cur = cur.parentElement;
        }
        return el;
      }

      const roots = itemRoots.map(findItemRoot);
      const seen = new Set();
      rows = roots.filter(r => {
        if (seen.has(r)) return false;
        seen.add(r);
        return true;
      });
    }

    return rows.map((root, idx) => {
      // Product URL — ThredUp uses /product/ paths
      const linkEl = root.querySelector('a[href*="/product/"]') ||
                     root.querySelector('a[href]');
      const productUrl = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : null;

      // Timer text — the visible time is in span.u\:absolute.u\:left-0
      // Avoid the invisible ghost span (u:opacity-0) which also contains 00:00:00
      let rawTimer = null;
      const visibleTimerEl = root.querySelector('span[class*="absolute"]');
      if (visibleTimerEl) {
        const t = visibleTimerEl.textContent.trim();
        if (TIMER_RE.test(t)) rawTimer = t;
      }
      if (!rawTimer) {
        // Fallback: grab first timer match from full text (may double-capture ghost)
        const timerMatch = root.textContent.match(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})/);
        rawTimer = timerMatch ? timerMatch[0] : null;
      }

      // Title: brand heading (h3 in ThredUp's cart markup)
      const titleEl = root.querySelector('h3, h2, h4, [class*="brand"], [class*="Brand"], strong, b');
      const title = titleEl ? titleEl.textContent.trim() : root.textContent.slice(0, 60).trim();

      // Price
      const priceEl = root.querySelector('[class*="price"], [class*="Price"]');
      const price = priceEl ? priceEl.textContent.trim().slice(0, 20) : '';

      // Delete button — ThredUp uses a <button> containing <img alt="Remove item from cart">
      // The button itself has NO aria-label; target via the img alt text.
      const deleteBtn = root.querySelector('button:has(img[alt*="Remove"])') ||
                        (() => {
                          // :has() may not be supported in older Chromium — manual walk
                          const btns = Array.from(root.querySelectorAll('button'));
                          return btns.find(b => {
                            const img = b.querySelector('img');
                            return img && /remove/i.test(img.getAttribute('alt') || '');
                          }) || null;
                        })();

      // Build removeSelector — we use nth-of-type among trash buttons on the page
      // (resolved after this map, once we know the index)
      return {
        index: idx,
        title,
        productUrl,
        price,
        rawTimer,
        hasDeleteBtn: !!deleteBtn,
      };
    });
  });

  // Build per-item removeSelector using nth-match of the img-alt pattern,
  // which is stable and doesn't rely on aria-label or svg presence.
  return items.map((item, i) => ({
    ...item,
    secondsLeft: parseSeconds(item.rawTimer || ''),
    // Playwright CSS :nth-match — selects the (i+1)th remove button on the page
    // by targeting the <button> that contains an img with alt matching "Remove"
    removeSelector: `:nth-match(button:has(img[alt*="Remove"]), ${i + 1})`,
  }));
}

module.exports = { parseCart, parseSeconds };

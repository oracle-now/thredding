/**
 * cart-parser.js
 *
 * Parses the ThredUp cart page into a structured list of CartItem objects.
 *
 * Each CartItem:
 *   {
 *     index:          number,  // 0-based position in cart
 *     title:          string,  // brand + description text
 *     productUrl:     string,  // absolute URL to product page (for re-add)
 *     price:          string,  // display price
 *     secondsLeft:    number,  // seconds remaining on reservation.
 *                              //   -1  = timer element not found (selector miss)
 *                              //    0  = timer found but reads 0:00 (truly expired)
 *                              //   >0  = seconds remaining
 *     rawTimer:       string,  // raw "HH:MM:SS" or "MM:SS" string (null if missing)
 *     hasDeleteBtn:   boolean, // whether a remove button was detected
 *     removeSelector: string   // playwright selector to click to remove this item
 *   }
 *
 * Fix #4: parseSeconds() now returns -1 (not 0) when no timer element is found.
 *   The runner filters on secondsLeft > 0 — a -1 is correctly excluded, but can
 *   be distinguished from a genuine 0:00-display item for logging purposes.
 *
 * Fix #7: hasDeleteBtn is now surfaced on every item so runner.js / readd.js
 *   can bail early with a clear error instead of letting humanClick throw.
 *
 * NOTE: page.evaluate() runs in the browser context — no Node variables are
 * accessible inside. All regexes and helpers must be defined inline.
 */

const { pushLog } = require('./log-buffer');

// Node-side timer parser (used after evaluate returns)
// Returns -1 when no timer string is present (fix #4).
const TIMER_RE = /\b(\d{1,2}):(\d{2}):(\d{2})\b|\b(\d{1,2}):(\d{2})\b/;

function parseSeconds(raw) {
  if (!raw) return -1;            // fix #4: no timer string = unknown, not 0
  const m = TIMER_RE.exec(raw);
  if (!m) return -1;              // fix #4: regex miss = unknown, not 0
  if (m[1] !== undefined) {
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  }
  return parseInt(m[4], 10) * 60 + parseInt(m[5], 10);
}

async function parseCart(page) {
  await page.waitForSelector(
    '[class*="CartItem"], [class*="cart-item"], [data-testid*="cart"], .empty-cart, h1',
    { timeout: 15_000 }
  ).catch(() => {});

  const items = await page.evaluate(() => {
    // TIMER_RE must be defined here — page.evaluate has no access to Node scope
    const TIMER_RE_BROWSER = /\b(\d{1,2}):(\d{2}):(\d{2})\b|\b(\d{1,2}):(\d{2})\b/;

    // Primary: select by the stable cart row class
    let rows = Array.from(document.querySelectorAll('div.M2gLnUDHRBK0O1TPAB_T'));

    if (!rows.length) {
      // Fallback: find containers with "Reserved for" text
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
          const hasLink = cur.querySelector('a[href*="/product/"]');
          const hasDelete = (() => {
            const btns = Array.from(cur.querySelectorAll('button'));
            return btns.some(b => {
              const img = b.querySelector('img');
              return img && /remove/i.test(img.getAttribute('alt') || '');
            });
          })();
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
      // Product URL
      const linkEl = root.querySelector('a[href*="/product/"]') || root.querySelector('a[href]');
      const productUrl = linkEl
        ? new URL(linkEl.getAttribute('href'), location.origin).href
        : null;

      // Timer — grab visible span (absolute positioned), skip ghost (opacity-0)
      let rawTimer = null;
      const visibleTimerEl = root.querySelector('span[class*="absolute"]');
      if (visibleTimerEl) {
        const t = visibleTimerEl.textContent.trim();
        if (TIMER_RE_BROWSER.test(t)) rawTimer = t;
      }
      if (!rawTimer) {
        const timerMatch = root.textContent.match(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})/);
        rawTimer = timerMatch ? timerMatch[0] : null;
      }

      // Title
      const titleEl = root.querySelector(
        'h3, h2, h4, [class*="brand"], [class*="Brand"], strong, b'
      );
      const title = titleEl
        ? titleEl.textContent.trim()
        : root.textContent.slice(0, 60).trim();

      // Price
      const priceEl = root.querySelector('[class*="price"], [class*="Price"]');
      const price = priceEl ? priceEl.textContent.trim().slice(0, 20) : '';

      // Delete button — find button whose child <img> has alt containing "Remove"
      // fix #7: surface hasDeleteBtn explicitly on the returned object
      const btns = Array.from(root.querySelectorAll('button'));
      const deleteBtn = btns.find(b => {
        const img = b.querySelector('img');
        return img && /remove/i.test(img.getAttribute('alt') || '');
      }) || null;

      return {
        index: idx,
        title,
        productUrl,
        price,
        rawTimer,
        hasDeleteBtn: !!deleteBtn,  // fix #7: always present
      };
    });
  });

  // fix #3 (partial): removeSelector is now computed at call-time by readd.js
  // using a live DOM query, not baked-in positional nth-match.
  // We still emit it here as a fallback hint, but readd.js will re-query.
  return items.map((item, i) => ({
    ...item,
    secondsLeft: parseSeconds(item.rawTimer),  // fix #4: -1 when timer missing
    // removeSelector is intentionally NOT positional — readd.js will locate
    // the button by productUrl after the previous removal has settled.
    removeSelector: `button:has(img[alt*="Remove"]):near(a[href*="${encodeURIComponent(
      (item.productUrl || '').split('/').pop()
    )}"])`,
  }));
}

module.exports = { parseCart, parseSeconds };

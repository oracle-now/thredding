const { getPage } = require('./browser');
const { pushLog } = require('./log-buffer');
const { markCartDebugNow, markScanNow } = require('./runtime-status');
const { APP_CONFIG } = require('./config');

async function scanNow() {
  const page = await getPage();
  await page.goto(APP_CONFIG.cartUrl, { waitUntil: 'domcontentloaded' });
  markScanNow();
  const title = await page.title();
  pushLog('info', 'scan_now', 'Cart scan completed', { url: page.url(), title });
  return { url: page.url(), title };
}

async function dumpCurrentCartDebug() {
  const page = await getPage();
  await page.goto(APP_CONFIG.cartUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait a beat for React to hydrate
  await page.waitForTimeout(2000);

  const snapshot = await page.evaluate(() => {
    const lines = [];
    const sep = (label) => lines.push('', '=' .repeat(60), label, '='.repeat(60));

    // ── 1. Basic page info ─────────────────────────────────────
    sep('PAGE INFO');
    lines.push(`url:   ${location.href}`);
    lines.push(`title: ${document.title}`);
    const loggedIn = !location.href.includes('/login') && !location.href.includes('/signin');
    lines.push(`logged_in_guess: ${loggedIn}`);

    // ── 2. All elements containing "Reserved for" ─────────────────
    sep('ELEMENTS CONTAINING "Reserved for" (with 4-level parent chain)');
    const allEls = Array.from(document.querySelectorAll('*'));
    const timerEls = allEls.filter(el =>
      el.childNodes.length &&
      Array.from(el.childNodes).some(n => n.nodeType === 3 && /Reserved for/i.test(n.textContent))
    );
    if (!timerEls.length) {
      lines.push('NONE FOUND — cart may be empty or not yet rendered');
    }
    timerEls.forEach((el, i) => {
      lines.push(`\n--- Timer element ${i + 1} ---`);
      lines.push(`text:     ${el.textContent.trim().slice(0, 120)}`);
      lines.push(`tag:      ${el.tagName}`);
      lines.push(`class:    ${el.className}`);
      lines.push(`id:       ${el.id}`);
      // Walk up 4 levels
      let cur = el;
      for (let lvl = 1; lvl <= 4; lvl++) {
        cur = cur.parentElement;
        if (!cur) break;
        lines.push(`parent${lvl}: <${cur.tagName.toLowerCase()} class="${cur.className}" id="${cur.id}">`);
      }
    });

    // ── 3. All buttons with full attributes ──────────────────────
    sep('ALL BUTTONS (attributes + text + parent class)');
    const buttons = Array.from(document.querySelectorAll('button'));
    buttons.forEach((btn, i) => {
      const attrs = Array.from(btn.attributes).map(a => `${a.name}="${a.value}"`).join(' ');
      const text = btn.textContent.trim().slice(0, 80);
      const parentClass = btn.parentElement ? btn.parentElement.className : '';
      const hasSvg = !!btn.querySelector('svg');
      lines.push(`[${i}] text="${text}" svg=${hasSvg} attrs=[${attrs}] parentClass="${parentClass}"`);
    });

    // ── 4. All <a> hrefs inside the page ────────────────────────
    sep('ALL <a> HREFS (first 60)');
    const links = Array.from(document.querySelectorAll('a[href]'));
    links.slice(0, 60).forEach((a, i) => {
      lines.push(`[${i}] href="${a.getAttribute('href')}" text="${a.textContent.trim().slice(0, 60)}"`);
    });

    // ── 5. Raw HTML of likely cart container ────────────────────
    sep('CART CONTAINER RAW HTML (first candidate, truncated to 8000 chars)');
    // Try common cart container selectors in order
    const candidates = [
      '[data-testid*="cart"]',
      '[class*="cart"]',
      '[class*="Cart"]',
      'main',
    ];
    let cartEl = null;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.textContent.includes('Reserved for')) {
        cartEl = el;
        lines.push(`matched selector: ${sel}`);
        break;
      }
    }
    if (cartEl) {
      lines.push(cartEl.outerHTML.slice(0, 8000));
      if (cartEl.outerHTML.length > 8000) lines.push('... [TRUNCATED]');
    } else {
      lines.push('Could not find cart container — dumping <main> or <body> fallback');
      const fallback = document.querySelector('main') || document.body;
      lines.push(fallback.outerHTML.slice(0, 8000));
      if (fallback.outerHTML.length > 8000) lines.push('... [TRUNCATED]');
    }

    // ── 6. All text matching timer pattern ──────────────────────
    sep('ALL TIMER-LIKE TEXT (HH:MM:SS pattern)');
    const timerTexts = allEls
      .map(el => el.textContent.trim())
      .filter(t => /^\d{1,2}:\d{2}:\d{2}$/.test(t));
    if (timerTexts.length) {
      timerTexts.forEach(t => lines.push(t));
    } else {
      lines.push('NONE FOUND');
    }

    return lines.join('\n');
  });

  markCartDebugNow();
  pushLog('info', 'cart_debug_dump', 'Deep cart DOM dump complete — save the file to share');

  // Send to renderer for Save dialog
  return { text: snapshot, defaultName: `thredding-cart-debug-${Date.now()}.txt` };
}

module.exports = { scanNow, dumpCurrentCartDebug };

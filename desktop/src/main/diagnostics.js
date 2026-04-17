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
  await page.goto(APP_CONFIG.cartUrl, { waitUntil: 'domcontentloaded' });
  const snapshot = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    timerLikeText: Array.from(document.querySelectorAll('span'))
      .map(el => (el.textContent || '').trim())
      .filter(t => /^\d{1,2}:\d{2}:\d{2}$/.test(t))
      .slice(0, 20),
    buttons: Array.from(document.querySelectorAll('button'))
      .map(el => (el.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 25)
  }));
  markCartDebugNow();
  pushLog('info', 'cart_debug_dump', 'Captured cart debug snapshot', snapshot);
  return snapshot;
}

module.exports = { scanNow, dumpCurrentCartDebug };

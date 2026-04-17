const { getPage } = require('./browser');
const { pushLog } = require('./log-buffer');
const { APP_CONFIG } = require('./config');

async function openAuthWindow() {
  const page = await getPage({ headless: false });
  await page.goto(APP_CONFIG.cartUrl, { waitUntil: 'domcontentloaded' });
  pushLog('info', 'auth_window_opened', 'Opened interactive login window', { url: page.url() });
  return page;
}

module.exports = { openAuthWindow };

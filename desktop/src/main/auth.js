// Opens a real Electron WebContentsView (no automation flags) so Cloudflare
// sees a genuine browser. On window close we extract all thredup.com cookies
// and hand them to cookie-store.js for Playwright to reuse.
const { BrowserWindow, WebContentsView, session } = require('electron');
const { saveCookies } = require('./cookie-store');
const { refreshSessionPresence } = require('./runtime-status');
const { pushLog } = require('./log-buffer');
const { APP_CONFIG } = require('./config');

let loginWin = null;

async function openAuthWindow() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }

  loginWin = new BrowserWindow({
    width:  1280,
    height: 860,
    title:  'ThredUp — Log In',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const view = new WebContentsView();
  loginWin.contentView.addChildView(view);

  const resize = () => {
    const [w, h] = loginWin.getContentSize();
    view.setBounds({ x: 0, y: 0, width: w, height: h });
  };
  resize();
  loginWin.on('resize', resize);

  view.webContents.loadURL(APP_CONFIG.cartUrl);
  pushLog('info', 'auth_window_opened', 'Real browser login window opened (Cloudflare-safe)');

  loginWin.on('closed', async () => {
    try {
      const cookies = await session.defaultSession.cookies.get({ domain: '.thredup.com' });
      if (cookies.length) {
        saveCookies(cookies);
        refreshSessionPresence();
        pushLog('info', 'auth_cookies_saved', `Saved ${cookies.length} cookies from login session`);
      } else {
        pushLog('warn', 'auth_cookies_empty', 'Window closed but no thredup.com cookies found — did you log in?');
      }
    } catch (e) {
      pushLog('error', 'auth_cookies_error', 'Failed to extract cookies', { error: String(e) });
    }
    loginWin = null;
  });
}

module.exports = { openAuthWindow };

// Playwright Firefox context with cookie injection from Electron login session.
// Cloudflare bypass strategy:
//   1. User logs in via real Electron WebContentsView (auth.js) — no automation flags
//   2. Cookies saved to disk by cookie-store.js
//   3. Here we inject those cookies before first navigation — session already trusted
//   4. Firefox UA + stealth headers for all subsequent requests
const path = require('node:path');
const { app } = require('electron');
const { loadCookies, sanitizeForPlaywright } = require('./cookie-store');
const sessionStore = require('./session-store');
const { APP_CONFIG } = require('./config');
const { refreshSessionPresence } = require('./runtime-status');
const { pushLog } = require('./log-buffer');

let context = null;
let cookiesInjected = false;

const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0';

const STEALTH_HEADERS = {
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'sec-fetch-dest':  'document',
  'sec-fetch-mode':  'navigate',
  'sec-fetch-site':  'none',
  'sec-fetch-user':  '?1',
  'upgrade-insecure-requests': '1',
};

function ensureProfileDir() {
  let profileDir = sessionStore.getProfileDir();
  if (!profileDir) {
    profileDir = path.join(app.getPath('userData'), 'ff-profile');
    sessionStore.saveProfileDir(profileDir);
  }
  refreshSessionPresence();
  return profileDir;
}

async function launchFirefox(headless) {
  const { firefox } = require('playwright');
  const profileDir = ensureProfileDir();
  return firefox.launchPersistentContext(profileDir, {
    headless,
    viewport:         { width: 1440, height: 900 },
    userAgent:        FIREFOX_UA,
    extraHTTPHeaders: STEALTH_HEADERS,
    timezoneId:       'America/Los_Angeles',
    locale:           'en-US',
    slowMo:           headless ? 100 : 0,
  });
}

async function getContext(options = {}) {
  const headless = options.headless ?? APP_CONFIG.headless;
  if (context) return context;

  pushLog('info', 'browser_launch', 'Launching Firefox context');
  context = await launchFirefox(headless);
  cookiesInjected = false;
  pushLog('info', 'browser_ready', 'Firefox context ready');
  return context;
}

async function getPage(options = {}) {
  const ctx = await getContext(options);

  // Inject cookies once per context lifetime
  if (!cookiesInjected) {
    const saved = loadCookies();
    if (saved?.length) {
      await ctx.addCookies(sanitizeForPlaywright(saved));
      cookiesInjected = true;
      pushLog('info', 'cookies_injected', `Injected ${saved.length} cookies into Playwright context`);
    } else {
      pushLog('warn', 'cookies_missing', 'No saved cookies — open Login first to authenticate');
    }
  }

  const pages = ctx.pages();
  return pages[0] || ctx.newPage();
}

async function closeContext() {
  if (context) {
    try { await context.close(); } catch {}
    context = null;
    cookiesInjected = false;
  }
}

module.exports = { getContext, getPage, closeContext, ensureProfileDir };

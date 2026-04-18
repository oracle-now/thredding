// browser.js — Playwright Firefox context with cookie injection.
//
// Fix #8: Cookie session expiry / login redirect detection.
//   - After each page.goto(), check whether we landed on a ThredUp login
//     page. If so, mark cookies as stale, clear the injected flag so they
//     will be re-injected on next getContext() call, and return a sentinel
//     so the caller can bail and surface a "please re-login" notice.
//
// Fix #10: getPage() validates page state before returning.
//   - If pages()[0] exists but is in a crashed/closed/broken state (e.g.
//     stuck mid-navigation from a prior crash) we close it and open a
//     fresh page rather than returning a page that will immediately fail.

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

// Regex patterns that indicate a ThredUp login/auth redirect (fix #8)
const LOGIN_URL_RE  = /thredup\.com\/(login|signup|auth|account\/login)/i;
const LOGIN_TITLE_RE = /sign\s*in|log\s*in|create\s*account|welcome\s*back/i;

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

/**
 * Returns a healthy Playwright Page.
 *
 * Fix #10: Validates the existing page before returning it. If the page is
 * in a broken state (closed, crashed, or stuck on chrome-error://), we close
 * it and open a fresh one. This prevents getPage() returning a zombie page
 * that causes all subsequent parseCart() calls to return empty.
 */
async function getPage(options = {}) {
  const ctx = await getContext(options);

  // Inject cookies once per context lifetime
  if (!cookiesInjected) {
    const saved = loadCookies();
    if (saved?.length) {
      await ctx.addCookies(sanitizeForPlaywright(saved));
      cookiesInjected = true;
      pushLog('info', 'cookies_injected',
        `Injected ${saved.length} cookies into Playwright context`);
    } else {
      pushLog('warn', 'cookies_missing',
        'No saved cookies — open Login first to authenticate');
    }
  }

  // fix #10: find or create a healthy page
  const pages = ctx.pages();
  let page = pages[0];

  if (page) {
    // Validate: a healthy page can evaluate simple JS without throwing.
    const healthy = await page.evaluate(() => true).catch(() => false);
    if (!healthy) {
      pushLog('warn', 'browser_stale_page',
        'Existing page is in a broken state — closing and opening a fresh page');
      await page.close().catch(() => {});
      page = null;
    }
  }

  if (!page) {
    page = await ctx.newPage();
  }

  return page;
}

/**
 * Check whether the current page is a ThredUp login redirect.
 *
 * Fix #8: Call this after any page.goto() that targets a ThredUp URL.
 * Returns true if we've been bounced to a login page, which means our
 * session cookies have expired.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isLoginRedirect(page) {
  const url   = page.url();
  const title = await page.title().catch(() => '');

  if (LOGIN_URL_RE.test(url) || LOGIN_TITLE_RE.test(title)) {
    pushLog('error', 'browser_session_expired',
      'Session expired — ThredUp redirected to login page. Re-open the app and log in again.',
      { url, title });
    // Reset injection state so cookies are re-injected if/when the user
    // logs in again via the Electron WebContentsView (auth.js).
    cookiesInjected = false;
    return true;
  }
  return false;
}

async function closeContext() {
  if (context) {
    try { await context.close(); } catch {}
    context = null;
    cookiesInjected = false;
  }
}

module.exports = { getContext, getPage, closeContext, ensureProfileDir, isLoginRedirect };

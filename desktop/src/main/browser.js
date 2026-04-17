// Cloudflare bypass strategy:
// 1. Playwright Firefox — Cloudflare treats Firefox far more leniently than Chromium
// 2. Realistic UA + stealth headers
// 3. Persistent profile so session/cookies survive between scans
// 4. All interactive clicks go through human-click.js (bezier CDP path injector)
const path = require('node:path');
const { app } = require('electron');
const sessionStore = require('./session-store');
const { APP_CONFIG } = require('./config');
const { refreshSessionPresence } = require('./runtime-status');
const { pushLog } = require('./log-buffer');

let context = null;
let currentHeadless = null;

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
  if (context && currentHeadless === headless) return context;
  if (context && currentHeadless !== headless) await closeContext();

  pushLog('info', 'browser_launch', 'Launching Firefox (Cloudflare-safe)');
  context = await launchFirefox(headless);
  currentHeadless = headless;
  pushLog('info', 'browser_ready', 'Firefox context ready');
  return context;
}

async function getPage(options = {}) {
  const ctx = await getContext(options);
  const pages = ctx.pages();
  return pages[0] || ctx.newPage();
}

async function closeContext() {
  if (context) {
    try { await context.close(); } catch {}
    context = null;
    currentHeadless = null;
  }
}

module.exports = { getContext, getPage, closeContext, ensureProfileDir };

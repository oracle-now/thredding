const path = require('node:path');
const { app } = require('electron');
const { chromium } = require('playwright');
const sessionStore = require('./session-store');
const { APP_CONFIG } = require('./config');
const { refreshSessionPresence } = require('./runtime-status');

let context = null;
let currentHeadless = null;

function ensureProfileDir() {
  let profileDir = sessionStore.getProfileDir();
  if (!profileDir) {
    profileDir = path.join(app.getPath('userData'), 'playwright-profile');
    sessionStore.saveProfileDir(profileDir);
  }
  refreshSessionPresence();
  return profileDir;
}

async function getContext(options = {}) {
  const headless = options.headless ?? APP_CONFIG.headless;
  if (context && currentHeadless === headless) return context;
  if (context && currentHeadless !== headless) await closeContext();
  context = await chromium.launchPersistentContext(ensureProfileDir(), {
    headless,
    viewport: { width: 1440, height: 980 }
  });
  currentHeadless = headless;
  return context;
}

async function getPage(options = {}) {
  const ctx = await getContext(options);
  const pages = ctx.pages();
  return pages[0] || ctx.newPage();
}

async function closeContext() {
  if (context) {
    await context.close();
    context = null;
    currentHeadless = null;
  }
}

module.exports = { getContext, getPage, closeContext, ensureProfileDir };

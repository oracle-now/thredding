// Uses camoufox for Cloudflare bypass (humanize + Firefox fingerprint)
// Falls back to Playwright chromium if camoufox is unavailable
const path = require('node:path');
const { app } = require('electron');
const sessionStore = require('./session-store');
const { APP_CONFIG } = require('./config');
const { refreshSessionPresence } = require('./runtime-status');
const { pushLog } = require('./log-buffer');

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

async function launchCamoufox(headless) {
  // camoufox is a Python package — we shell out to Python to get a CDP endpoint
  // then connect Playwright to it so the rest of the JS code works unchanged
  const { spawn } = require('node:child_process');
  const { chromium } = require('playwright');

  return new Promise((resolve, reject) => {
    const profileDir = ensureProfileDir();
    const py = spawn('python3', [
      '-c',
      `
import asyncio, json, sys
from camoufox.async_api import AsyncCamoufox

async def main():
    browser = await AsyncCamoufox(
        headless=${headless ? 'True' : 'False'},
        humanize=True,
        persistent_context=True,
        user_data_dir=${JSON.stringify(profileDir)},
    ).__aenter__()
    endpoint = browser.wsEndpoint
    sys.stdout.write(json.dumps({'ws': endpoint}) + '\\n')
    sys.stdout.flush()
    # keep alive until stdin closes
    await asyncio.get_event_loop().run_in_executor(None, sys.stdin.read)
    await browser.__aexit__(None, None, None)

asyncio.run(main())
      `
    ], { stdio: ['pipe', 'pipe', 'inherit'] });

    let buf = '';
    py.stdout.on('data', async (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      try {
        const { ws } = JSON.parse(line);
        pushLog('info', 'camoufox_launched', 'Camoufox CDP endpoint ready', { ws });
        const browser = await chromium.connectOverCDP(ws);
        const contexts = browser.contexts();
        const ctx = contexts[0] || await browser.newContext();
        ctx._camoufoxProcess = py;
        resolve(ctx);
      } catch (e) {
        reject(e);
      }
    });

    py.on('error', reject);
    py.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`camoufox exited ${code}`));
    });
  });
}

async function launchPlaywright(headless) {
  const { chromium } = require('playwright');
  const profileDir = ensureProfileDir();
  return chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1440, height: 980 }
  });
}

async function getContext(options = {}) {
  const headless = options.headless ?? APP_CONFIG.headless;
  if (context && currentHeadless === headless) return context;
  if (context && currentHeadless !== headless) await closeContext();

  try {
    pushLog('info', 'browser_launch', 'Trying camoufox (Cloudflare-safe)');
    context = await launchCamoufox(headless);
    pushLog('info', 'browser_ready', 'Camoufox context ready');
  } catch (e) {
    pushLog('warn', 'camoufox_fallback', 'Camoufox unavailable, falling back to Playwright', { error: String(e) });
    context = await launchPlaywright(headless);
    pushLog('info', 'browser_ready', 'Playwright context ready (fallback)');
  }

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
    try {
      const proc = context._camoufoxProcess;
      await context.close();
      if (proc) proc.stdin.end();
    } catch {}
    context = null;
    currentHeadless = null;
  }
}

module.exports = { getContext, getPage, closeContext, ensureProfileDir };

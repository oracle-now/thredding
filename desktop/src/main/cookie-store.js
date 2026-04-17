// Owns read/write of the ThredUp session cookie file.
//
// PRIMARY source: chrome-cookies-secure reads directly from the user's real
// Chrome cookie store (decrypted via macOS Keychain). The user just logs in
// once in their normal Chrome — no extension, no manual export needed.
//
// FALLBACK: cookies captured from Electron WebContentsView login are also
// accepted and saved here via saveCookies().
const fs   = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { pushLog } = require('./log-buffer');

const cookiePath = () =>
  path.join(app.getPath('userData'), 'thredup-cookies.json');

// Playwright requires sameSite to be capitalised correctly
const SAME_SITE_MAP = { strict: 'Strict', lax: 'Lax', none: 'None', '': 'None' };

function sanitizeForPlaywright(cookies) {
  return cookies.map(c => {
    const out = { ...c };
    const raw = String(out.sameSite ?? '').toLowerCase();
    out.sameSite = SAME_SITE_MAP[raw] ?? 'None';
    // Remove fields Playwright doesn't accept
    for (const k of ['hostOnly', 'session', 'storeId', 'id', 'expirationDate']) delete out[k];
    // Playwright needs numeric expires or -1
    if (out.expires === undefined || out.expires === null) out.expires = -1;
    return out;
  });
}

function saveCookies(cookies) {
  fs.writeFileSync(cookiePath(), JSON.stringify(cookies, null, 2), 'utf8');
}

function loadCookies() {
  try   { return JSON.parse(fs.readFileSync(cookiePath(), 'utf8')); }
  catch { return null; }
}

function clearCookies() {
  try { fs.unlinkSync(cookiePath()); } catch {}
}

function hasCookies() {
  const c = loadCookies();
  return Array.isArray(c) && c.length > 0;
}

// Reads ThredUp cookies directly from the user's real Chrome on disk.
// Decrypts via macOS Keychain — requires Chrome to be installed and the
// user to have previously logged into thredup.com in Chrome.
async function importFromChrome() {
  let chromeCookies;
  try {
    chromeCookies = require('chrome-cookies-secure');
  } catch {
    pushLog('error', 'chrome_import_missing', 'chrome-cookies-secure not installed — run: npm install');
    return { ok: false, reason: 'package_missing' };
  }

  return new Promise((resolve) => {
    chromeCookies.getCookies('https://www.thredup.com', 'puppeteer', (err, cookies) => {
      if (err) {
        pushLog('error', 'chrome_import_error', 'Failed to read Chrome cookies', { error: String(err) });
        return resolve({ ok: false, reason: String(err) });
      }
      if (!cookies || cookies.length === 0) {
        pushLog('warn', 'chrome_import_empty', 'No ThredUp cookies found in Chrome — log in at thredup.com in Chrome first');
        return resolve({ ok: false, reason: 'no_cookies' });
      }
      saveCookies(cookies);
      pushLog('info', 'chrome_import_ok', `Imported ${cookies.length} cookies from Chrome`);
      resolve({ ok: true, count: cookies.length });
    });
  });
}

module.exports = { saveCookies, loadCookies, clearCookies, hasCookies, sanitizeForPlaywright, importFromChrome };

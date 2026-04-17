// Owns read/write of the ThredUp session cookie file.
// Cookies are captured from the real Electron session after login
// and injected into Playwright so scans run with a trusted session.
const fs   = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const cookiePath = () =>
  path.join(app.getPath('userData'), 'thredup-cookies.json');

// Playwright requires sameSite to be capitalised correctly
const SAME_SITE_MAP = { strict: 'Strict', lax: 'Lax', none: 'None', '': 'None' };

function sanitizeForPlaywright(cookies) {
  return cookies.map(c => {
    const out = { ...c };
    const raw = String(out.sameSite ?? '').toLowerCase();
    out.sameSite = SAME_SITE_MAP[raw] ?? 'None';
    // Remove Electron-only fields Playwright doesn't accept
    for (const k of ['hostOnly', 'session', 'storeId', 'id']) delete out[k];
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

module.exports = { saveCookies, loadCookies, clearCookies, hasCookies, sanitizeForPlaywright };

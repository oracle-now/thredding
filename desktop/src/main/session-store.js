const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function getStorePath() {
  return path.join(app.getPath('userData'), 'session-store.json');
}

function readStore() {
  try { return JSON.parse(fs.readFileSync(getStorePath(), 'utf8')); }
  catch { return {}; }
}

function writeStore(next) {
  fs.mkdirSync(path.dirname(getStorePath()), { recursive: true });
  fs.writeFileSync(getStorePath(), JSON.stringify(next, null, 2), 'utf8');
}

function getProfileDir() { return readStore().profileDir || null; }

function saveProfileDir(profileDir) {
  const store = readStore();
  store.profileDir = profileDir;
  writeStore(store);
}

function clearProfileDir() {
  const store = readStore();
  delete store.profileDir;
  writeStore(store);
}

module.exports = { getProfileDir, saveProfileDir, clearProfileDir };

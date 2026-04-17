const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const sessionStore = require('./session-store');

const state = {
  watcherRunning: false,
  sessionPresent: false,
  profileDir: null,
  lastCartDebugAt: null,
  lastScanAt: null,
  lastRefreshAt: null
};

function resolveProfileDir() {
  return sessionStore.getProfileDir() || path.join(app.getPath('userData'), 'playwright-profile');
}

function refreshSessionPresence() {
  const profileDir = resolveProfileDir();
  state.profileDir = profileDir;
  state.sessionPresent = fs.existsSync(profileDir);
}

function setWatcherRunning(value) {
  state.watcherRunning = !!value;
  refreshSessionPresence();
}

function markCartDebugNow() { state.lastCartDebugAt = Date.now(); }
function markScanNow() { state.lastScanAt = Date.now(); }
function markRefreshNow() { state.lastRefreshAt = Date.now(); }

function getHealthSnapshot() {
  refreshSessionPresence();
  return { ...state };
}

module.exports = { refreshSessionPresence, setWatcherRunning, markCartDebugNow, markScanNow, markRefreshNow, getHealthSnapshot };

const fs = require('node:fs/promises');
const { dialog } = require('electron');
const sessionStore = require('./session-store');
const { ensureProfileDir, closeContext } = require('./browser');
const { stopRunner } = require('./runner');
const { pushLog } = require('./log-buffer');

async function resetSessionWithConfirmation() {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Reset Session'],
    defaultId: 0,
    cancelId: 0,
    title: 'Reset Session',
    message: 'Delete saved ThredUp session?',
    detail: 'This stops watching, closes the persistent browser, and clears the saved profile.'
  });
  if (result.response !== 1) {
    pushLog('info', 'session_reset_cancelled', 'User cancelled session reset');
    return { ok: false, cancelled: true };
  }
  const profileDir = ensureProfileDir();
  await stopRunner();
  await closeContext();
  await fs.rm(profileDir, { recursive: true, force: true });
  sessionStore.clearProfileDir();
  pushLog('warn', 'session_reset_done', 'Reset saved Playwright session', { profileDir });
  return { ok: true, cancelled: false };
}

module.exports = { resetSessionWithConfirmation };

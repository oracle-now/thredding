const fs = require('node:fs');
const { shell } = require('electron');
const { ensureProfileDir } = require('./browser');
const { pushLog } = require('./log-buffer');

async function openProfileFolder() {
  const profileDir = ensureProfileDir();
  fs.mkdirSync(profileDir, { recursive: true });
  await shell.openPath(profileDir);
  pushLog('info', 'profile_folder_opened', 'Opened Playwright profile folder', { profileDir });
}

module.exports = { openProfileFolder };

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, clipboard, dialog } = require('electron');
const { createTray } = require('./tray');
const { getRecentLogs, clearLogs, pushLog } = require('./log-buffer');
const { getHealthSnapshot } = require('./runtime-status');
const { openAuthWindow } = require('./auth');
const { openProfileFolder } = require('./open-profile-folder');
const { resetSessionWithConfirmation } = require('./reset-session');
const { scanNow, dumpCurrentCartDebug } = require('./diagnostics');
const { startRunner, stopRunner, testAutoRefresh, testProductPageAdd, testRemoveReadd } = require('./runner');
const { importFromChrome } = require('./cookie-store');
const { refreshSessionPresence } = require('./runtime-status');

let logsWindow = null;

function openLogsWindow() {
  if (logsWindow && !logsWindow.isDestroyed()) {
    logsWindow.show();
    logsWindow.focus();
    return logsWindow;
  }
  logsWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Thredding Logs',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  logsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'logs.html'));
  logsWindow.on('closed', () => { logsWindow = null; });
  return logsWindow;
}

// Save a text payload to disk via native Save dialog (main-process, no IPC needed)
async function saveTextFile(payload) {
  const result = await dialog.showSaveDialog({
    title: 'Save Debug File',
    defaultPath: payload.defaultName || 'thredding-debug.txt',
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  if (result.canceled || !result.filePath) {
    pushLog('info', 'save_cancelled', 'Save dialog cancelled');
    return { ok: false, cancelled: true };
  }
  await fs.writeFile(result.filePath, payload.text, 'utf8');
  pushLog('info', 'save_complete', `Debug file saved to ${result.filePath}`);
  return { ok: true, filePath: result.filePath };
}

async function registerIpc() {
  ipcMain.handle('logs:getRecent',      async () => getRecentLogs(300));
  ipcMain.handle('logs:clear',          async () => { clearLogs(); return { ok: true }; });
  ipcMain.handle('health:get',          async () => getHealthSnapshot());
  ipcMain.handle('clipboard:writeText', async (_e, text) => { clipboard.writeText(text); return { ok: true }; });
  // Legacy IPC path kept for renderer-triggered saves
  ipcMain.handle('debug:saveTextFile',  async (_e, payload) => saveTextFile(payload));
}

async function handleImportFromChrome() {
  openLogsWindow();
  const result = await importFromChrome();
  if (result.ok) refreshSessionPresence();
  return result;
}

async function handleDumpCartDebug() {
  openLogsWindow();
  const payload = await dumpCurrentCartDebug();
  // payload = { text: '...', defaultName: 'thredding-cart-debug-TIMESTAMP.txt' }
  if (payload && payload.text) {
    await saveTextFile(payload);
  } else {
    pushLog('warn', 'dump_empty', 'Dump returned no content');
  }
}

async function bootstrap() {
  await registerIpc();
  createTray({
    onImportFromChrome:   handleImportFromChrome,
    onOpenLogin:          openAuthWindow,
    onOpenLogs:           openLogsWindow,
    onOpenProfileFolder:  openProfileFolder,
    onResetSession:       async () => { const r = await resetSessionWithConfirmation(); if (r.ok) await openAuthWindow(); },
    onScanNow:            async () => { openLogsWindow(); await scanNow(); },
    onDumpCartDebug:      handleDumpCartDebug,
    onTestAutoRefresh:    async () => { openLogsWindow(); await testAutoRefresh(); },
    onTestProductPageAdd: async () => { openLogsWindow(); await testProductPageAdd(); },
    onTestRemoveReadd:    async () => { openLogsWindow(); await testRemoveReadd(); },
    onStart:              async () => { openLogsWindow(); await startRunner(); },
    onStop:               async () => { openLogsWindow(); await stopRunner(); },
    onQuit:               () => app.quit()
  });
  pushLog('info', 'app_ready', 'Desktop scaffold initialized');
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', (e) => e.preventDefault());

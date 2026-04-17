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

async function registerIpc() {
  ipcMain.handle('logs:getRecent',      async () => getRecentLogs(300));
  ipcMain.handle('logs:clear',          async () => { clearLogs(); return { ok: true }; });
  ipcMain.handle('health:get',          async () => getHealthSnapshot());
  ipcMain.handle('clipboard:writeText', async (_e, text) => { clipboard.writeText(text); return { ok: true }; });
  ipcMain.handle('debug:saveTextFile',  async (_e, payload) => {
    const result = await dialog.showSaveDialog({ title: 'Save Debug Bundle', defaultPath: payload.defaultName || 'thredding-debug.txt' });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    await fs.writeFile(result.filePath, payload.text, 'utf8');
    return { ok: true, filePath: result.filePath };
  });
}

async function handleImportFromChrome() {
  openLogsWindow();
  const result = await importFromChrome();
  if (result.ok) refreshSessionPresence();
  return result;
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
    onDumpCartDebug:      async () => { openLogsWindow(); await dumpCurrentCartDebug(); },
    onTestAutoRefresh:    testAutoRefresh,
    onTestProductPageAdd: testProductPageAdd,
    onTestRemoveReadd:    testRemoveReadd,
    onStart:              startRunner,
    onStop:               stopRunner,
    onQuit:               () => app.quit()
  });
  pushLog('info', 'app_ready', 'Desktop scaffold initialized');
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', (e) => e.preventDefault());

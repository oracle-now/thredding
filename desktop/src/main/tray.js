const { Tray, Menu, nativeImage } = require('electron');

let tray = null;

const HEART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <path fill="white" d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z"/>
</svg>`;

function heartIcon() {
  const b64 = Buffer.from(HEART_SVG).toString('base64');
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${b64}`);
  img.setTemplateImage(true);
  return img;
}

function createTray(handlers) {
  if (tray) return tray;
  tray = new Tray(heartIcon());
  tray.setToolTip('Thredding');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Import Cookies from Chrome', click: () => void handlers.onImportFromChrome() },
    { label: 'Open Login',                 click: () => void handlers.onOpenLogin() },
    { label: 'Open Logs',                  click: () => void handlers.onOpenLogs() },
    { label: 'Open Profile Folder',        click: () => void handlers.onOpenProfileFolder() },
    { label: 'Reset Session',              click: () => void handlers.onResetSession() },
    { type: 'separator' },
    { label: 'Scan Now',                   click: () => void handlers.onScanNow() },
    { label: 'Dump Cart Debug',            click: () => void handlers.onDumpCartDebug() },
    { label: 'Test Auto Refresh',          click: () => void handlers.onTestAutoRefresh() },
    { label: 'Test Product-Page Add',      click: () => void handlers.onTestProductPageAdd() },
    { label: 'Test Remove + Re-Add',       click: () => void handlers.onTestRemoveReadd() },
    { type: 'separator' },
    { label: 'Start Watching',             click: () => void handlers.onStart() },
    { label: 'Pause Watching',             click: () => void handlers.onStop() },
    { type: 'separator' },
    { label: 'Quit',                       click: () => void handlers.onQuit() }
  ]));
  return tray;
}

module.exports = { createTray };

const { Tray, Menu, nativeImage } = require('electron');

let tray = null;

function createTray(handlers) {
  if (tray) return tray;
  const blank = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9wS0AAAAASUVORK5CYII='
  );
  tray = new Tray(blank);
  tray.setToolTip('Thredding Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Login',            click: () => void handlers.onOpenLogin() },
    { label: 'Open Logs',             click: () => void handlers.onOpenLogs() },
    { label: 'Open Profile Folder',   click: () => void handlers.onOpenProfileFolder() },
    { label: 'Reset Session',         click: () => void handlers.onResetSession() },
    { type: 'separator' },
    { label: 'Scan Now',              click: () => void handlers.onScanNow() },
    { label: 'Dump Cart Debug',       click: () => void handlers.onDumpCartDebug() },
    { label: 'Test Auto Refresh',     click: () => void handlers.onTestAutoRefresh() },
    { label: 'Test Product-Page Add', click: () => void handlers.onTestProductPageAdd() },
    { label: 'Test Remove + Re-Add',  click: () => void handlers.onTestRemoveReadd() },
    { type: 'separator' },
    { label: 'Start Watching',        click: () => void handlers.onStart() },
    { label: 'Pause Watching',        click: () => void handlers.onStop() },
    { type: 'separator' },
    { label: 'Quit',                  click: () => void handlers.onQuit() }
  ]));
  return tray;
}

module.exports = { createTray };

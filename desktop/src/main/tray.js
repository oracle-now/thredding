const { Tray, Menu, nativeImage } = require('electron');

let tray = null;

// 16x16 white circle on transparent background — visible in both light and dark menu bars
const ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlz' +
  'AAALEgAACxIB0t1+/AAAABx0RVh0U29mdHdhcmUAQWRvYmUgRmlyZXdvcmtzIENTNXG14zYAAABY' +
  'SURBVDiNY/z//z8DJYCJgUIwasCoAaMGjBpAVQNYBg8e/I+LiwsDIyMjAyMDAwMTNptGDRg1YNSA' +
  'UQNGDRg1gKoGsAwePPgfFxcXBkZGRgZGBgYGJmw2AQAplQ3pGYjH2QAAAABJRU5ErkJggg==';

function createTray(handlers) {
  if (tray) return tray;

  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_B64}`);
  // On macOS, template images automatically invert for light/dark menu bars
  icon.setTemplateImage(true);

  tray = new Tray(icon);
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

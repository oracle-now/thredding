const entries = [];
const { APP_CONFIG } = require('./config');

function pushLog(level, event, message, meta) {
  entries.push({ ts: Date.now(), level, event, message, meta: meta || undefined });
  if (entries.length > APP_CONFIG.maxLogEntries) {
    entries.splice(0, entries.length - APP_CONFIG.maxLogEntries);
  }
  const line = `[${level.toUpperCase()}] ${event} ${message}`;
  if (level === 'error') console.error(line, meta || '');
  else if (level === 'warn') console.warn(line, meta || '');
  else console.log(line, meta || '');
}

function getRecentLogs(limit = 300) {
  return entries.slice(-limit);
}

function clearLogs() {
  entries.length = 0;
  pushLog('info', 'logs_cleared', 'Logs cleared');
}

module.exports = { pushLog, getRecentLogs, clearLogs };

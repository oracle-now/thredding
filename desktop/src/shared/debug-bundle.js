const IMPORTANT_EVENTS = new Set([
  'cart_debug_dump', 'scan_now', 'refresh_test',
  'runner_started', 'runner_stopped',
  'session_reset_done', 'session_reset_failed',
  'profile_folder_opened', 'auth_window_opened', 'app_ready'
]);

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function buildDebugBundle(entries, limit = 30) {
  const selected = (entries || [])
    .filter(e => IMPORTANT_EVENTS.has(e.event) || e.level === 'error')
    .slice(-limit);
  return [
    'Thredding Desktop Debug Bundle',
    `Generated: ${new Date().toISOString()}`,
    `Entries: ${selected.length}`,
    '',
    ...selected.flatMap(e => [
      `[${new Date(e.ts).toISOString()}] ${String(e.level).toUpperCase()} ${e.event}`,
      e.message,
      e.meta ? safeJson(e.meta) : '',
      ''
    ])
  ].join('\n');
}

module.exports = { buildDebugBundle };

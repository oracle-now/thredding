const { pushLog } = require('./log-buffer');
const { setWatcherRunning, markRefreshNow } = require('./runtime-status');

let running = false;

async function startRunner() {
  if (running) return;
  running = true;
  setWatcherRunning(true);
  pushLog('info', 'runner_started', 'Background watcher started');
}

async function stopRunner() {
  if (!running) return;
  running = false;
  setWatcherRunning(false);
  pushLog('info', 'runner_stopped', 'Background watcher stopped');
}

async function testRefresh(name) {
  markRefreshNow();
  pushLog('info', 'refresh_test', `Scaffolded refresh path invoked: ${name}`, { strategy: name, fallbackReason: 'unknown' });
  return { ok: true, strategy: name };
}

async function testAutoRefresh()    { return testRefresh('auto'); }
async function testProductPageAdd() { return testRefresh('product_page_add'); }
async function testRemoveReadd()    { return testRefresh('cart_remove_then_readd'); }

module.exports = { startRunner, stopRunner, testAutoRefresh, testProductPageAdd, testRemoveReadd };

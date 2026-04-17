/**
 * runner.js
 *
 * Background watcher loop.
 *
 * Behaviour:
 *   - Polls the cart every POLL_INTERVAL_MS
 *   - On each tick, parses all items and their timers
 *   - If any item has <= READD_THRESHOLD_SECONDS remaining, fires reAdd()
 *   - Prevents concurrent re-add operations with an in-flight flag
 *   - Backs off after a CF block or repeated failures
 *   - Gracefully stops on stopRunner()
 *
 * Thresholds (conservative defaults — tweak via APP_CONFIG if needed):
 *   POLL_INTERVAL_MS      = 30s  (cart scan frequency)
 *   READD_THRESHOLD_SECS  = 120s (2 min — trigger re-add with comfortable margin)
 *   BACKOFF_AFTER_CF_MS   = 5min (pause after Cloudflare detection)
 */

const { getPage } = require('./browser');
const { parseCart } = require('./cart-parser');
const { reAdd } = require('./readd');
const { pushLog } = require('./log-buffer');
const { setWatcherRunning, markRefreshNow } = require('./runtime-status');
const { APP_CONFIG } = require('./config');

const POLL_INTERVAL_MS     = 30_000;
const READD_THRESHOLD_SECS = 120;
const BACKOFF_AFTER_CF_MS  = 5 * 60_000;
const NAV_OPTS             = { waitUntil: 'domcontentloaded', timeout: 30_000 };

let running      = false;
let inFlight     = false;
let stopSignal   = false;
let pollTimer    = null;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

// ── Public API ────────────────────────────────────────────────────────────────

async function startRunner() {
  if (running) {
    pushLog('warn', 'runner_already_running', 'Watcher already running');
    return;
  }
  running    = true;
  stopSignal = false;
  consecutiveFailures = 0;
  setWatcherRunning(true);
  pushLog('info', 'runner_started', 'Cart watcher started', {
    pollIntervalSec: POLL_INTERVAL_MS / 1000,
    readdThresholdSec: READD_THRESHOLD_SECS,
  });
  schedulePoll(0); // first tick immediately
}

async function stopRunner() {
  if (!running) return;
  stopSignal = true;
  running    = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  setWatcherRunning(false);
  pushLog('info', 'runner_stopped', 'Cart watcher stopped');
}

// ── Manual one-shot actions (tray menu) ──────────────────────────────────────

async function testAutoRefresh() {
  pushLog('info', 'manual_scan', 'Manual scan triggered');
  return tick();
}

async function testProductPageAdd() {
  pushLog('info', 'manual_scan', 'Manual scan triggered (product_page_add path)');
  return tick();
}

async function testRemoveReadd() {
  pushLog('info', 'manual_readd', 'Manual force re-add triggered — targeting soonest-expiring item');
  const page = await getPage();
  await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  const items = await parseCart(page);
  if (!items.length) {
    pushLog('warn', 'manual_readd_empty', 'Cart is empty — nothing to re-add');
    return;
  }
  // Pick the item with least time remaining
  const target = items.slice().sort((a, b) => a.secondsLeft - b.secondsLeft)[0];
  pushLog('info', 'manual_readd_target', `Targeting: ${target.title} (${target.rawTimer} left)`);
  return reAdd(page, target);
}

// ── Internal ──────────────────────────────────────────────────────────────────

function schedulePoll(delayMs) {
  if (stopSignal) return;
  pollTimer = setTimeout(async () => {
    await tick();
    if (!stopSignal) schedulePoll(POLL_INTERVAL_MS);
  }, delayMs);
}

async function tick() {
  if (inFlight) {
    pushLog('debug', 'runner_skip', 'Skipping tick — re-add already in flight');
    return;
  }

  let page;
  try {
    page = await getPage();
    await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  } catch (e) {
    consecutiveFailures++;
    pushLog('error', 'runner_nav_error', 'Failed to load cart page', { error: String(e) });
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pushLog('error', 'runner_too_many_failures', `${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping watcher`);
      await stopRunner();
    }
    return;
  }

  // Detect CF block
  const title = await page.title();
  if (/just a moment|cloudflare|checking your browser/i.test(title)) {
    consecutiveFailures++;
    pushLog('warn', 'runner_cf_block', `Cloudflare challenge detected — backing off ${BACKOFF_AFTER_CF_MS / 60000} min`);
    if (!stopSignal) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => {
        if (!stopSignal) {
          consecutiveFailures = 0;
          schedulePoll(0);
        }
      }, BACKOFF_AFTER_CF_MS);
    }
    return;
  }

  let items;
  try {
    items = await parseCart(page);
  } catch (e) {
    consecutiveFailures++;
    pushLog('error', 'runner_parse_error', 'Failed to parse cart', { error: String(e) });
    return;
  }

  consecutiveFailures = 0; // reset on successful parse

  if (!items.length) {
    pushLog('info', 'runner_empty_cart', 'Cart is empty — watching');
    return;
  }

  // Log current state of all items
  pushLog('info', 'runner_tick', `Cart has ${items.length} item(s)`, {
    items: items.map(i => ({ title: i.title, timer: i.rawTimer, secondsLeft: i.secondsLeft })),
  });

  // Find items approaching expiry — sort ascending so we handle soonest first
  const expiring = items
    .filter(i => i.secondsLeft > 0 && i.secondsLeft <= READD_THRESHOLD_SECS)
    .sort((a, b) => a.secondsLeft - b.secondsLeft);

  if (!expiring.length) return; // nothing urgent

  // Only process one item per tick to keep operations serialised
  const target = expiring[0];
  pushLog('info', 'runner_readd_queued', `Item expiring soon: ${target.title} (${target.rawTimer} left)`);

  inFlight = true;
  try {
    await reAdd(page, target);
  } catch (e) {
    pushLog('error', 'runner_readd_error', 'Unexpected error during re-add', { error: String(e) });
  } finally {
    inFlight = false;
  }
}

module.exports = { startRunner, stopRunner, testAutoRefresh, testProductPageAdd, testRemoveReadd };

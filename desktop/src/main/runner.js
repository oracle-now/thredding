/**
 * runner.js
 *
 * Background watcher loop with humanized adaptive polling.
 *
 * Fix #1: Process ALL expiring items, not just expiring[0]. The old code
 *   iterated through `expiring` but only called reAdd(expiring[0]), meaning
 *   every tick only processed one item. Multiple items at/below threshold
 *   were left to expire. Now we iterate and process each one.
 *
 * Fix #2: Replace global `inFlight` flag with per-item Set tracking. The
 *   global lock caused tick() to return Infinity if ANY re-add was running,
 *   blocking all other items. Now each item is tracked separately by
 *   productUrl, and only the currently-processing items are locked.
 *
 * Fix #11: pollTimer reassignment in CF backoff path. The old code cleared
 *   pollTimer then created a new setTimeout() without reassigning it, so
 *   stopRunner() couldn't cancel the backoff timer. Fixed by reassigning.
 *
 * Fix #12: Auto-restart on MAX_CONSECUTIVE_FAILURES instead of permanent
 *   stop. After 5 nav failures the watcher now enters a 60s cooldown then
 *   resets failure count and resumes. A tray notification is sent so the
 *   user knows if it's stuck in a failure loop.
 *
 * Poll interval is NOT fixed. It scales with urgency and adds random jitter
 * so the request cadence looks like a person casually checking their cart:
 *
 * Urgency mode    | Base interval | Jitter | Effective range
 * ────────────────┼───────────────┼──────────┼─────────────────
 * idle            | 4–8 min       | ±30s   | ~3.5 – 8.5 min
 * watching <15min | 90s           | ±20s   | ~70 – 110s
 * urgent <5min    | 45s           | ±10s   | ~35 – 55s
 * critical <2min  | 20s           | ±5s    | ~15 – 25s
 */

const { getPage } = require('./browser');
const { isLoginRedirect } = require('./browser');
const { parseCart } = require('./cart-parser');
const { reAdd } = require('./readd');
const { pushLog } = require('./log-buffer');
const { setWatcherRunning } = require('./runtime-status');
const { APP_CONFIG } = require('./config');

// Pull constants from config.js (fix #5)
const READD_THRESHOLD_SECS = APP_CONFIG.READD_THRESHOLD_SECS || 300;
const BACKOFF_AFTER_CF_MS  = APP_CONFIG.BACKOFF_AFTER_CF_MS  || 30_000;
const MAX_CONSECUTIVE_FAILURES = APP_CONFIG.MAX_CONSECUTIVE_FAILURES || 5;
const RESTART_BACKOFF_MS = APP_CONFIG.RESTART_BACKOFF_MS || 60_000;

const URGENT_THRESHOLD_SECS = 300;       // ≤5 min → urgent cadence
const WATCHING_THRESHOLD_SECS = 15 * 60; // ≤15 min → watching cadence
const NAV_OPTS = { waitUntil: 'domcontentloaded', timeout: 30_000 };

// ── Jitter helper ─────────────────────────────────────────────────────────────
function jitter(baseMs, spreadMs) {
  return baseMs + Math.round((Math.random() * 2 - 1) * spreadMs);
}

// ── Adaptive interval ─────────────────────────────────────────────────────────
function nextPollMs(minSecondsLeft) {
  if (!isFinite(minSecondsLeft) || minSecondsLeft <= 0) {
    return jitter((4 + Math.random() * 4) * 60_000, 30_000);
  }
  if (minSecondsLeft <= READD_THRESHOLD_SECS) {
    return jitter(20_000, 5_000);
  }
  if (minSecondsLeft <= URGENT_THRESHOLD_SECS) {
    return jitter(45_000, 10_000);
  }
  if (minSecondsLeft <= WATCHING_THRESHOLD_SECS) {
    return jitter(90_000, 20_000);
  }
  return jitter((4 + Math.random() * 4) * 60_000, 30_000);
}

// ── State ─────────────────────────────────────────────────────────────────────
let running = false;
// fix #2: per-item inFlight tracking (Set of productUrls)
const inFlightItems = new Set();
let stopSignal = false;
let pollTimer = null;
let consecutiveFailures = 0;

// ── Public API ────────────────────────────────────────────────────────────────
async function startRunner() {
  if (running) {
    pushLog('warn', 'runner_already_running', 'Watcher already running');
    return;
  }
  running = true;
  stopSignal = false;
  consecutiveFailures = 0;
  inFlightItems.clear();  // fix #2
  setWatcherRunning(true);
  pushLog('info', 'runner_started', 'Cart watcher started (adaptive humanized polling)');
  schedulePoll(0);
}

async function stopRunner() {
  if (!running) return;
  stopSignal = true;
  running = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }  // fix #11
  setWatcherRunning(false);
  pushLog('info', 'runner_stopped', 'Cart watcher stopped');
}

// ── Manual one-shot actions (tray menu) ──────────────────────────────────────
async function testAutoRefresh() {
  pushLog('info', 'manual_scan', 'Manual cart scan triggered');
  return tick();
}

async function testProductPageAdd() {
  pushLog('info', 'manual_scan', 'Manual scan triggered');
  return tick();
}

async function testRemoveReadd() {
  pushLog('info', 'manual_readd', 'Manual force re-add — targeting soonest-expiring item');
  const page = await getPage();
  await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  const items = await parseCart(page);
  if (!items.length) {
    pushLog('warn', 'manual_readd_empty', 'Cart is empty — nothing to re-add');
    return;
  }
  const target = items.slice().sort((a, b) => a.secondsLeft - b.secondsLeft)[0];
  pushLog('info', 'manual_readd_target', `Targeting: ${target.title} (${target.rawTimer} left)`);
  return reAdd(page, target);
}

// ── Internal ──────────────────────────────────────────────────────────────────
function schedulePoll(delayMs) {
  if (stopSignal) return;
  if (delayMs > 0) {
    const sec = Math.round(delayMs / 1000);
    const display = sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
    pushLog('debug', 'runner_next_poll', `Next cart check in ~${display}`);
  }
  pollTimer = setTimeout(async () => {
    const minSecondsLeft = await tick();
    if (!stopSignal) {
      schedulePoll(nextPollMs(minSecondsLeft ?? Infinity));
    }
  }, delayMs);
}

async function tick() {
  let page;
  try {
    page = await getPage();
    await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  } catch (e) {
    consecutiveFailures++;
    pushLog('error', 'runner_nav_error', 'Failed to load cart', { error: String(e) });
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      // fix #12: auto-restart after cooldown instead of permanent stop
      pushLog('error', 'runner_too_many_failures',
        `${MAX_CONSECUTIVE_FAILURES} consecutive failures — entering ${RESTART_BACKOFF_MS / 1000}s cooldown before retry`);
      if (!stopSignal) {
        clearTimeout(pollTimer);
        // fix #11: reassign pollTimer so stopRunner() can cancel it
        pollTimer = setTimeout(() => {
          if (!stopSignal) {
            consecutiveFailures = 0;
            pushLog('info', 'runner_restart', 'Cooldown complete — resuming cart watcher');
            schedulePoll(0);
          }
        }, RESTART_BACKOFF_MS);
      }
    }
    return Infinity;
  }

  // fix #8: check for session expiry
  if (await isLoginRedirect(page)) {
    consecutiveFailures++;
    pushLog('error', 'runner_session_expired',
      'Session expired — please re-login via the Login menu to resume watching');
    return Infinity;
  }

  const title = await page.title();
  if (/just a moment|cloudflare|checking your browser/i.test(title)) {
    consecutiveFailures++;
    pushLog('warn', 'runner_cf_block',
      `Cloudflare detected — backing off ${BACKOFF_AFTER_CF_MS / 60_000} min`);
    if (!stopSignal) {
      clearTimeout(pollTimer);
      // fix #11: reassign pollTimer so stopRunner() can cancel it
      pollTimer = setTimeout(() => {
        if (!stopSignal) { consecutiveFailures = 0; schedulePoll(0); }
      }, BACKOFF_AFTER_CF_MS);
    }
    return Infinity;
  }

  let items;
  try {
    items = await parseCart(page);
  } catch (e) {
    consecutiveFailures++;
    pushLog('error', 'runner_parse_error', 'Failed to parse cart', { error: String(e) });
    return Infinity;
  }

  consecutiveFailures = 0;
  if (!items.length) {
    pushLog('info', 'runner_empty_cart', 'Cart is empty — watching');
    return Infinity;
  }

  // fix #4: exclude items with secondsLeft === -1 (timer not found)
  const validTimers = items.map(i => i.secondsLeft).filter(s => s > 0);
  const minSecondsLeft = validTimers.length ? Math.min(...validTimers) : Infinity;
  const minMin = Math.floor(minSecondsLeft / 60);
  const minSec = Math.round(minSecondsLeft % 60);
  pushLog('info', 'runner_tick',
    `Cart: ${items.length} item(s) | soonest expiry: ${minMin}m ${minSec}s`, {
    items: items.map(i => ({ title: i.title, timer: i.rawTimer, secondsLeft: i.secondsLeft })),
  });

  const expiring = items
    .filter(i => i.secondsLeft > 0 && i.secondsLeft <= READD_THRESHOLD_SECS)
    .sort((a, b) => a.secondsLeft - b.secondsLeft);

  if (!expiring.length) return minSecondsLeft;

  // fix #1: process ALL expiring items (not just expiring[0])
  // fix #2: check per-item inFlight lock instead of global lock
  for (const target of expiring) {
    if (inFlightItems.has(target.productUrl)) {
      pushLog('debug', 'runner_item_in_flight',
        `Skipping "${target.title}" — re-add already in progress`);
      continue;
    }

    pushLog('info', 'runner_readd_queued',
      `Expiring: "${target.title}" — ${target.rawTimer} left`);
    
    inFlightItems.add(target.productUrl);  // fix #2
    // don't await — allow multiple re-adds to run in parallel
    reAdd(page, target)
      .catch(e => {
        pushLog('error', 'runner_readd_error',
          'Unexpected error in re-add', { error: String(e), item: target.title });
      })
      .finally(() => {
        inFlightItems.delete(target.productUrl);  // fix #2
      });
  }

  return minSecondsLeft;
}

module.exports = { startRunner, stopRunner, testAutoRefresh, testProductPageAdd, testRemoveReadd };

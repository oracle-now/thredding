/**
 * runner.js
 *
 * Background watcher loop with humanized, adaptive polling.
 *
 * Poll interval is NOT fixed. It scales with urgency and adds random jitter
 * so the request cadence looks like a person casually checking their cart:
 *
 *   Urgency mode    | Base interval | Jitter   | Effective range
 *   ────────────────┼───────────────┼──────────┼─────────────────
 *   idle            | 4–8 min       | ±30s     | ~3.5 – 8.5 min
 *   watching <15min | 90s           | ±20s     | ~70 – 110s
 *   urgent <5min    | 45s           | ±10s     | ~35 – 55s
 *   critical <2min  | 20s           | ±5s      | ~15 – 25s
 *
 * Rationale:
 *   - A human doesn't poll on a metronome. Random jitter breaks regularity.
 *   - When nothing is close to expiring, polling rarely (4–8 min) is
 *     indistinguishable from a user leaving the cart tab open in the background.
 *   - As expiry approaches, frequency ramps up naturally — same as a human
 *     refreshing more often when they know time is short.
 *   - The re-add sequence itself uses humanClick (bezier mouse paths + CDP
 *     events with realistic timestamps) so individual actions are human-patterned.
 */

const { getPage } = require('./browser');
const { parseCart } = require('./cart-parser');
const { reAdd } = require('./readd');
const { pushLog } = require('./log-buffer');
const { setWatcherRunning } = require('./runtime-status');
const { APP_CONFIG } = require('./config');

// ── Timing constants ──────────────────────────────────────────────────────────
const READD_THRESHOLD_SECS    = 120;         // fire re-add at ≤2 min
const URGENT_THRESHOLD_SECS   = 300;         // ≤5 min → urgent cadence
const WATCHING_THRESHOLD_SECS = 15 * 60;     // ≤15 min → watching cadence
const BACKOFF_AFTER_CF_MS     = 5 * 60_000;  // pause 5 min after CF block
const MAX_CONSECUTIVE_FAILURES = 5;
const NAV_OPTS = { waitUntil: 'domcontentloaded', timeout: 30_000 };

// ── Jitter helper ─────────────────────────────────────────────────────────────
// Returns a random value in [base - spread, base + spread]
function jitter(baseMs, spreadMs) {
  return baseMs + Math.round((Math.random() * 2 - 1) * spreadMs);
}

// ── Adaptive interval ─────────────────────────────────────────────────────────
// Picks the next poll delay based on how soon the next item expires.
function nextPollMs(minSecondsLeft) {
  if (!isFinite(minSecondsLeft) || minSecondsLeft <= 0) {
    // Idle: cart empty or no timers — check every 4–8 min
    return jitter((4 + Math.random() * 4) * 60_000, 30_000);
  }
  if (minSecondsLeft <= READD_THRESHOLD_SECS) {
    // Critical: re-add may have just fired, watch closely
    return jitter(20_000, 5_000);
  }
  if (minSecondsLeft <= URGENT_THRESHOLD_SECS) {
    // Urgent: <5 min remaining
    return jitter(45_000, 10_000);
  }
  if (minSecondsLeft <= WATCHING_THRESHOLD_SECS) {
    // Watching: <15 min remaining
    return jitter(90_000, 20_000);
  }
  // Relaxed: plenty of time — idle cadence
  return jitter((4 + Math.random() * 4) * 60_000, 30_000);
}

// ── State ─────────────────────────────────────────────────────────────────────
let running      = false;
let inFlight     = false;
let stopSignal   = false;
let pollTimer    = null;
let consecutiveFailures = 0;

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
  pushLog('info', 'runner_started', 'Cart watcher started (adaptive humanized polling)');
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

// Returns the minimum secondsLeft across all cart items (Infinity if empty/unknown)
async function tick() {
  if (inFlight) {
    pushLog('debug', 'runner_skip', 'Skipping tick — re-add in flight');
    return Infinity;
  }

  let page;
  try {
    page = await getPage();
    await page.goto(APP_CONFIG.cartUrl, NAV_OPTS);
  } catch (e) {
    consecutiveFailures++;
    pushLog('error', 'runner_nav_error', 'Failed to load cart', { error: String(e) });
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pushLog('error', 'runner_too_many_failures',
        `${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping watcher`);
      await stopRunner();
    }
    return Infinity;
  }

  // Detect CF block
  const title = await page.title();
  if (/just a moment|cloudflare|checking your browser/i.test(title)) {
    consecutiveFailures++;
    pushLog('warn', 'runner_cf_block',
      `Cloudflare detected — backing off ${BACKOFF_AFTER_CF_MS / 60_000} min`);
    if (!stopSignal) {
      clearTimeout(pollTimer);
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

  const validTimers = items.map(i => i.secondsLeft).filter(s => s > 0);
  const minSecondsLeft = validTimers.length ? Math.min(...validTimers) : Infinity;
  const minMin = Math.floor(minSecondsLeft / 60);
  const minSec = Math.round(minSecondsLeft % 60);

  pushLog('info', 'runner_tick',
    `Cart: ${items.length} item(s) | soonest expiry: ${minMin}m ${minSec}s`, {
      items: items.map(i => ({ title: i.title, timer: i.rawTimer, secondsLeft: i.secondsLeft })),
    });

  // Items at or below re-add threshold — handle soonest first, one per tick
  const expiring = items
    .filter(i => i.secondsLeft > 0 && i.secondsLeft <= READD_THRESHOLD_SECS)
    .sort((a, b) => a.secondsLeft - b.secondsLeft);

  if (!expiring.length) return minSecondsLeft;

  const target = expiring[0];
  pushLog('info', 'runner_readd_queued',
    `Expiring: "${target.title}" — ${target.rawTimer} left`);

  inFlight = true;
  try {
    await reAdd(page, target);
  } catch (e) {
    pushLog('error', 'runner_readd_error', 'Unexpected error in re-add', { error: String(e) });
  } finally {
    inFlight = false;
  }

  return minSecondsLeft;
}

module.exports = { startRunner, stopRunner, testAutoRefresh, testProductPageAdd, testRemoveReadd };

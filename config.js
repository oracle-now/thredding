// config.js — central configuration
// Fix #5: READD_THRESHOLD_SECS raised from 120 → 300 to give ample re-add margin

module.exports = {
  CART_URL: 'https://www.thredup.com/cart',

  // How often to poll the cart (ms)
  POLL_INTERVAL_MS: 15_000,

  // Re-add an item when this many seconds remain on its hold timer.
  // The full re-add sequence (navigate → remove → re-add → return) takes
  // 15–60 s under real conditions.  120 s was dangerously tight; 300 s
  // gives a comfortable 4-5× safety margin even on a slow connection.
  READD_THRESHOLD_SECS: 300,

  // How long to wait (ms) after a Cloudflare challenge before retrying
  BACKOFF_AFTER_CF_MS: 30_000,

  // Stop the watcher after this many consecutive navigation failures
  MAX_CONSECUTIVE_FAILURES: 5,

  // Milliseconds to wait between re-add retries when recovering from failure
  RESTART_BACKOFF_MS: 60_000,
};

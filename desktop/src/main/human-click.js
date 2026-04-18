/**
 * human-click.js
 *
 * Moves the mouse along a realistic bezier path then dispatches a click.
 *
 * Fix #6: CDP is ONLY available in Chromium. Firefox (which this app uses)
 * does NOT support CDP sessions — page.context().newCDPSession() always
 * throws. The original code silently fell back to page.locator().click(),
 * meaning the bezier path was NEVER actually used.
 *
 * New behaviour:
 *   1. Try CDP first (works if user switches to Chromium in the future).
 *   2. If CDP is unavailable, fall back to Playwright's mouse.move() API
 *      which drives real mouse events through Playwright's own input system.
 *      This is NOT as low-level as raw CDP, but it still produces smooth
 *      curved pointer events rather than an instant click teleport.
 *   3. Log clearly which path was taken so it's never ambiguous.
 */

const { emitPath } = require('./path-emitter');
const { pushLog } = require('./log-buffer');

/**
 * Get the bounding box center of a selector on the page.
 */
async function getCenter(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`humanClick: element not found or not visible — ${selector}`);
  return {
    x: box.x + box.width  / 2,
    y: box.y + box.height / 2,
    width: box.width,
  };
}

/**
 * humanClick(page, selector, options?)
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {object} [options]
 * @param {{x:number,y:number}} [options.from]  - cursor start position
 * @param {number} [options.postClickMs=80]     - dwell after mouseReleased
 */
async function humanClick(page, selector, options = {}) {
  const target = await getCenter(page, selector);

  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const from = options.from ?? {
    x: viewport.width  * (0.3 + Math.random() * 0.4),
    y: viewport.height * (0.3 + Math.random() * 0.4),
  };

  const samples = emitPath(from, target, { width: target.width });

  // ── Attempt 1: CDP (Chromium only) ───────────────────────────────────────
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {
    // fix #6: CDP is always unavailable in Firefox. Log once at warn level
    // (not silently) so the operator knows humanization is running via
    // Playwright mouse API instead of raw CDP.
    pushLog('warn', 'human_click_no_cdp',
      'CDP unavailable (Firefox) — using Playwright mouse.move() path instead', { selector });
  }

  if (cdp) {
    // ── CDP path: raw Input.dispatchMouseEvent events (Chromium) ───────────
    const t0 = Date.now() / 1000;

    for (const s of samples) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: s.x, y: s.y,
        timestamp: t0 + s.t / 1000,
        buttons: 0,
        pointerType: 'mouse',
      });
    }

    const last   = samples[samples.length - 1];
    const tsClick = t0 + last.t / 1000;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: last.x, y: last.y,
      button: 'left', buttons: 1, clickCount: 1,
      timestamp: tsClick,
      pointerType: 'mouse',
    });

    await new Promise(r => setTimeout(r, options.postClickMs ?? (60 + Math.random() * 60)));

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: last.x, y: last.y,
      button: 'left', buttons: 0, clickCount: 1,
      timestamp: tsClick + 0.01,
      pointerType: 'mouse',
    });

    await cdp.detach();
    pushLog('debug', 'human_click_cdp',
      `Clicked ${selector} via CDP bezier path (${samples.length} samples)`);
    return;
  }

  // ── Fallback path: Playwright mouse.move() (Firefox-compatible) ──────────
  // fix #6: Drive each bezier sample through Playwright's mouse API.
  // This goes through the browser's real input pipeline (not a synthetic
  // JS dispatch), producing curved movement visible to anti-bot heuristics.
  const mouse = page.mouse;

  // Move to start position silently
  await mouse.move(from.x, from.y);

  // Replay bezier samples
  for (const s of samples) {
    await mouse.move(s.x, s.y);
    // Tiny real-time delay per sample to spread events over time
    if (s.t > 0) {
      await new Promise(r => setTimeout(r, Math.min(s.t, 8)));
    }
  }

  const last = samples[samples.length - 1];
  await mouse.move(last.x, last.y);

  // Natural press-dwell-release
  await mouse.down();
  await new Promise(r => setTimeout(r, options.postClickMs ?? (60 + Math.random() * 60)));
  await mouse.up();

  pushLog('debug', 'human_click_mouse_api',
    `Clicked ${selector} via Playwright mouse bezier path (${samples.length} samples)`);
}

module.exports = { humanClick };

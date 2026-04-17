/**
 * humanClick — moves the mouse along a realistic bezier path then clicks.
 *
 * Uses CDP Input.dispatchMouseEvent directly so Cloudflare's JS challenge
 * sees properly timestamped, curved, human-like pointer events.
 *
 * Usage:
 *   const { humanClick } = require('./human-click');
 *   await humanClick(page, selector);           // clicks center of element
 *   await humanClick(page, selector, { from }); // explicit start position
 */

const { emitPath } = require('./path-emitter');
const { pushLog }  = require('./log-buffer');

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
 * @param {{x:number,y:number}} [options.from]  - cursor start position (defaults to near page center)
 * @param {number} [options.postClickMs=80]     - dwell after mouseReleased before returning
 */
async function humanClick(page, selector, options = {}) {
  const target = await getCenter(page, selector);

  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const from = options.from ?? {
    x: viewport.width  * (0.3 + Math.random() * 0.4),
    y: viewport.height * (0.3 + Math.random() * 0.4),
  };

  const samples = emitPath(from, target, { width: target.width });

  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {
    // Firefox doesn't support CDP sessions — fall back to normal click
    pushLog('warn', 'human_click_fallback', 'CDP unavailable, using playwright click', { selector });
    await page.locator(selector).first().click();
    return;
  }

  const t0 = Date.now() / 1000;

  // Dispatch move events along the bezier path
  for (const s of samples) {
    await cdp.send('Input.dispatchMouseEvent', {
      type:        'mouseMoved',
      x:           s.x,
      y:           s.y,
      timestamp:   t0 + s.t / 1000,
      buttons:     0,
      pointerType: 'mouse',
    });
  }

  const last = samples[samples.length - 1];
  const tsClick = t0 + last.t / 1000;

  await cdp.send('Input.dispatchMouseEvent', {
    type:        'mousePressed',
    x:           last.x,
    y:           last.y,
    button:      'left',
    buttons:     1,
    clickCount:  1,
    timestamp:   tsClick,
    pointerType: 'mouse',
  });

  // Natural dwell between press and release (60-120ms)
  await new Promise(r => setTimeout(r, options.postClickMs ?? (60 + Math.random() * 60)));

  await cdp.send('Input.dispatchMouseEvent', {
    type:        'mouseReleased',
    x:           last.x,
    y:           last.y,
    button:      'left',
    buttons:     0,
    clickCount:  1,
    timestamp:   tsClick + 0.01,
    pointerType: 'mouse',
  });

  await cdp.detach();
  pushLog('debug', 'human_click', `Clicked ${selector} via CDP path (${samples.length} samples)`);
}

module.exports = { humanClick };

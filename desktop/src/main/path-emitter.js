/**
 * emit_path — generates a realistic human-like mouse path between two points.
 *
 * Uses a cubic bezier curve with randomized control points to simulate
 * natural hand movement. Outputs timestamped {x, y, t} samples compatible
 * with CDP Input.dispatchMouseEvent.
 *
 * Based on the cdp_injector.py pattern from the thredding project.
 */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function cubicBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt**3 * p0.x + 3 * mt**2 * t * p1.x + 3 * mt * t**2 * p2.x + t**3 * p3.x,
    y: mt**3 * p0.y + 3 * mt**2 * t * p1.y + 3 * mt * t**2 * p2.y + t**3 * p3.y,
  };
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * emitPath(start, end, options) → Array<{x, y, t}>
 *
 * @param {{x: number, y: number}} start   - starting cursor position
 * @param {{x: number, y: number}} end     - target center position
 * @param {object} options
 * @param {number} [options.width=40]      - target element width (for final micro-wobble)
 * @param {number} [options.steps=40]      - number of path samples
 * @param {number} [options.durationMs=380] - total movement duration in ms
 * @returns {Array<{x: number, y: number, t: number}>}
 */
function emitPath(start, end, options = {}) {
  const width      = options.width      ?? 40;
  const steps      = options.steps      ?? 40;
  const durationMs = options.durationMs ?? randBetween(280, 480);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Control points — offset perpendicular to the line of travel
  // to create a natural arc rather than a straight diagonal
  const perpX = -dy / dist || 0;
  const perpY =  dx / dist || 0;

  const wobble1 = randBetween(0.1, 0.35) * dist;
  const wobble2 = randBetween(0.05, 0.2) * dist;
  const side = Math.random() < 0.5 ? 1 : -1;

  const cp1 = {
    x: lerp(start.x, end.x, 0.25) + perpX * wobble1 * side,
    y: lerp(start.y, end.y, 0.25) + perpY * wobble1 * side,
  };
  const cp2 = {
    x: lerp(start.x, end.x, 0.75) + perpX * wobble2 * -side,
    y: lerp(start.y, end.y, 0.75) + perpY * wobble2 * -side,
  };

  const samples = [];

  for (let i = 0; i <= steps; i++) {
    const tNorm = i / steps;

    // Ease-in-out: slow start, fast middle, decelerate near target
    const eased = tNorm < 0.5
      ? 2 * tNorm * tNorm
      : 1 - Math.pow(-2 * tNorm + 2, 2) / 2;

    const pos = cubicBezier(start, cp1, cp2, end, eased);

    // Add sub-pixel jitter to simulate hand tremor
    const jitter = Math.max(0.3, (1 - tNorm) * 1.2);
    pos.x += (Math.random() - 0.5) * jitter;
    pos.y += (Math.random() - 0.5) * jitter;

    // Final approach: constrain to within target bounds
    if (tNorm > 0.92) {
      const half = width / 2;
      pos.x = Math.max(end.x - half, Math.min(end.x + half, pos.x));
    }

    samples.push({
      x: Math.round(pos.x * 10) / 10,
      y: Math.round(pos.y * 10) / 10,
      t: Math.round(eased * durationMs),
    });
  }

  return samples;
}

module.exports = { emitPath };

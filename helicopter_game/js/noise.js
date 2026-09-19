/* Seeded 2-D value noise + fractal Brownian motion.
 * Deterministic for a given seed, so the world is the same on every device. */
(function (global) {
  'use strict';

  function hash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296; // [0, 1)
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function value(x, y, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const a = hash(xi, yi, seed);
    const b = hash(xi + 1, yi, seed);
    const c = hash(xi, yi + 1, seed);
    const d = hash(xi + 1, yi + 1, seed);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  function fbm(x, y, seed, octaves) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value(x * freq, y * freq, seed + i * 101);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  global.Noise = { hash, value, fbm };
})(typeof window !== 'undefined' ? window : globalThis);

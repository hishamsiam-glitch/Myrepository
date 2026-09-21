/* Procedural terrain: elevation/moisture fields, biome classification,
 * ground height for collision, chunk rendering cache and pickup placement.
 *
 * World units are CSS pixels. Elevation is a 0..1 field; the ground height
 * the helicopter must clear is derived from it (0 over lowlands, up to ~100
 * on snowy peaks) and lives in the same units as the helicopter altitude. */
(function (global) {
  'use strict';

  const Noise = global.Noise;

  const CHUNK = 256;        // world px per chunk
  const CELL = 4;           // world px per terrain cell
  const CELLS = CHUNK / CELL;
  const MAX_ALT = 120;      // helicopter ceiling, altitude units

  const BIOME = {
    DEEP_WATER: 0, WATER: 1, BEACH: 2, GRASS: 3, FOREST: 4, DESERT: 5,
    HILLS: 6, CANYON: 7, MOUNTAIN: 8, SNOW: 9,
  };
  const BIOME_NAME = ['Deep sea', 'Coastal water', 'Beach', 'Grassland', 'Forest',
    'Desert', 'Hills', 'Canyon', 'Mountains', 'Snow peaks'];

  // [r, g, b] base colours per biome.
  const BIOME_RGB = [
    [22, 62, 120], [38, 108, 168], [222, 204, 150], [104, 160, 72], [46, 112, 52],
    [214, 178, 104], [124, 140, 70], [170, 96, 58], [116, 110, 104], [236, 240, 246],
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function makeWorld(seed) {
    seed = seed | 0;

    // Large-scale "region" field decides whether an area is ocean, plains or
    // a mountain range, so the player encounters distinct terrains over time.
    function region(x, y) {
      return Noise.fbm(x / 4200 + 7.3, y / 4200 - 2.1, seed + 900, 2);
    }

    function elevation(x, y) {
      const base = Noise.fbm(x / 640, y / 640, seed, 5);
      const r = region(x, y);
      const e = (base - 0.5) * 1.7 + 0.52 + (r - 0.5) * 0.8;
      return clamp(e, 0, 1);
    }

    function moisture(x, y) {
      const m = Noise.fbm(x / 1500 + 41, y / 1500 + 13, seed + 300, 3);
      return clamp((m - 0.5) * 3 + 0.5, 0, 1);
    }

    function biomeOf(e, m) {
      if (e < 0.30) return BIOME.DEEP_WATER;
      if (e < 0.38) return BIOME.WATER;
      if (e < 0.42) return BIOME.BEACH;
      if (e < 0.62) {
        if (m < 0.33) return BIOME.DESERT;
        if (m > 0.64) return BIOME.FOREST;
        return BIOME.GRASS;
      }
      if (e < 0.74) return m < 0.33 ? BIOME.CANYON : BIOME.HILLS;
      if (e < 0.86) return BIOME.MOUNTAIN;
      return BIOME.SNOW;
    }

    // Ground height in altitude units (0..~100).
    function groundFromElevation(e) {
      if (e <= 0.60) return 0;
      const t = (e - 0.60) / 0.40;
      return Math.pow(t, 1.3) * 100;
    }

    function groundAt(x, y) { return groundFromElevation(elevation(x, y)); }
    function biomeAt(x, y) { return biomeOf(elevation(x, y), moisture(x, y)); }

    // ---- Chunk rendering -------------------------------------------------

    const chunkCache = new Map();
    let chunkDpr = 1;

    function chunkKey(cx, cy) { return cx + ',' + cy; }

    function renderChunk(cx, cy) {
      const size = CHUNK * chunkDpr;
      const canvas = global.document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.scale(chunkDpr, chunkDpr);

      const ox = cx * CHUNK;
      const oy = cy * CHUNK;
      const N = CELLS + 2; // one-cell margin for slope shading
      const elev = new Float32Array(N * N);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          elev[j * N + i] = elevation(ox + (i - 1) * CELL + CELL / 2, oy + (j - 1) * CELL + CELL / 2);
        }
      }

      // Moisture varies slowly, so sample it once per 4x4 block of cells.
      const MB = 4;
      const MN = CELLS / MB;
      const moist = new Float32Array(MN * MN);
      for (let j = 0; j < MN; j++) {
        for (let i = 0; i < MN; i++) {
          moist[j * MN + i] = moisture(ox + (i + 0.5) * MB * CELL, oy + (j + 0.5) * MB * CELL);
        }
      }

      const decor = [];
      for (let j = 0; j < CELLS; j++) {
        for (let i = 0; i < CELLS; i++) {
          const e = elev[(j + 1) * N + (i + 1)];
          const wx = ox + i * CELL;
          const wy = oy + j * CELL;
          const m = moist[((j / MB) | 0) * MN + ((i / MB) | 0)];
          const b = biomeOf(e, m);
          const rgb = BIOME_RGB[b];

          // Slope shading with light from the top-left.
          const eL = elev[(j + 1) * N + i];
          const eR = elev[(j + 1) * N + (i + 2)];
          const eU = elev[j * N + (i + 1)];
          const eD = elev[(j + 2) * N + (i + 1)];
          let light = 1 + ((eL - eR) + (eU - eD)) * (b >= BIOME.HILLS ? 26 : 9);
          // Subtle per-cell texture so flat areas are not a solid colour.
          light += (Noise.hash(wx, wy, seed + 5) - 0.5) * 0.04;
          if (b <= BIOME.WATER) light += (e - 0.2) * 0.8; // lighter near shore
          light = clamp(light, 0.55, 1.45);

          const r = clamp(rgb[0] * light, 0, 255) | 0;
          const g = clamp(rgb[1] * light, 0, 255) | 0;
          const bl = clamp(rgb[2] * light, 0, 255) | 0;
          ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + bl + ')';
          ctx.fillRect(i * CELL, j * CELL, CELL, CELL);

          const h = Noise.hash(wx, wy, seed + 77);
          const cx0 = i * CELL + CELL / 2;
          const cy0 = j * CELL + CELL / 2;
          if (b === BIOME.FOREST && h < 0.13) decor.push({ t: 'tree', x: cx0, y: cy0, s: 2.2 + h * 14 });
          else if (b === BIOME.GRASS && h < 0.012) decor.push({ t: 'tree', x: cx0, y: cy0, s: 2 + h * 100 });
          else if (b === BIOME.GRASS && h > 0.996) decor.push({ t: 'house', x: i * CELL - 1, y: j * CELL - 1, h: h });
          else if (b === BIOME.DESERT && h < 0.015) decor.push({ t: 'cactus', x: cx0, y: cy0 });
          else if ((b === BIOME.DEEP_WATER || b === BIOME.WATER) && h < 0.02) decor.push({ t: 'wave', x: i * CELL, y: cy0 });
          else if (b === BIOME.MOUNTAIN && h < 0.04) decor.push({ t: 'rock', x: cx0, y: cy0, h: h });
          else if (b === BIOME.SNOW && h < 0.05) decor.push({ t: 'snowrock', x: cx0, y: cy0 });
        }
      }

      for (const d of decor) {
        switch (d.t) {
          case 'tree':
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath(); ctx.arc(d.x + 1.5, d.y + 1.5, d.s, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#2d6b2f';
            ctx.beginPath(); ctx.arc(d.x, d.y, d.s, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4f9a48';
            ctx.beginPath(); ctx.arc(d.x - d.s * 0.3, d.y - d.s * 0.3, d.s * 0.45, 0, Math.PI * 2); ctx.fill();
            break;
          case 'house':
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(d.x + 1, d.y + 1, 6, 6);
            ctx.fillStyle = d.h > 0.992 ? '#c8463c' : '#d9793a';
            ctx.fillRect(d.x, d.y, 6, 6);
            ctx.fillStyle = '#f3e7cf';
            ctx.fillRect(d.x + 1, d.y + 1, 4, 2);
            break;
          case 'cactus':
            ctx.fillStyle = '#4c8a3a';
            ctx.fillRect(d.x - 1, d.y - 3, 2, 6);
            ctx.fillRect(d.x - 3, d.y - 1, 2, 2);
            ctx.fillRect(d.x + 1, d.y - 2, 2, 2);
            break;
          case 'wave':
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(d.x + 1, d.y); ctx.lineTo(d.x + 6, d.y); ctx.stroke();
            break;
          case 'rock':
            ctx.fillStyle = d.h < 0.07 ? '#5b5651' : '#8d8781';
            ctx.beginPath(); ctx.arc(d.x, d.y, 2.5, 0, Math.PI * 2); ctx.fill();
            break;
          case 'snowrock':
            ctx.fillStyle = '#b8bec8';
            ctx.beginPath(); ctx.arc(d.x, d.y, 2, 0, Math.PI * 2); ctx.fill();
            break;
        }
      }
      return canvas;
    }

    function getChunk(cx, cy) {
      const key = chunkKey(cx, cy);
      let c = chunkCache.get(key);
      if (!c) {
        c = { canvas: renderChunk(cx, cy), cx, cy, last: 0 };
        chunkCache.set(key, c);
      }
      return c;
    }

    // Drop chunks that have not been used recently.
    function pruneChunks(frame) {
      if (chunkCache.size < 120) return;
      for (const [key, c] of chunkCache) {
        if (frame - c.last > 60) chunkCache.delete(key);
      }
    }

    function setDpr(dpr) {
      if (dpr !== chunkDpr) {
        chunkDpr = dpr;
        chunkCache.clear();
      }
    }

    // Flat colour used while a chunk is still being generated.
    function placeholderColor(cx, cy) {
      const x = cx * CHUNK + CHUNK / 2;
      const y = cy * CHUNK + CHUNK / 2;
      const rgb = BIOME_RGB[biomeOf(elevation(x, y), moisture(x, y))];
      return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    }

    // Draw every chunk intersecting the circle of `radius` around (x, y).
    // At most `budget` new chunks are generated per call, nearest first,
    // so a burst of new terrain never stalls a frame; the rest get a flat
    // placeholder until they are rendered on a later frame.
    function draw(ctx, x, y, radius, frame, budget) {
      if (budget == null) budget = 2;
      const c0x = Math.floor((x - radius) / CHUNK);
      const c1x = Math.floor((x + radius) / CHUNK);
      const c0y = Math.floor((y - radius) / CHUNK);
      const c1y = Math.floor((y + radius) / CHUNK);
      const missing = [];
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const c = chunkCache.get(chunkKey(cx, cy));
          if (c) {
            c.last = frame;
            ctx.drawImage(c.canvas, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
          } else {
            const dx = (cx + 0.5) * CHUNK - x;
            const dy = (cy + 0.5) * CHUNK - y;
            missing.push({ cx, cy, d: dx * dx + dy * dy });
          }
        }
      }
      if (missing.length) {
        missing.sort((a, b) => a.d - b.d);
        for (let i = 0; i < missing.length; i++) {
          const m = missing[i];
          if (i < budget) {
            const c = getChunk(m.cx, m.cy);
            c.last = frame;
            ctx.drawImage(c.canvas, m.cx * CHUNK, m.cy * CHUNK, CHUNK, CHUNK);
          } else {
            ctx.fillStyle = placeholderColor(m.cx, m.cy);
            ctx.fillRect(m.cx * CHUNK, m.cy * CHUNK, CHUNK, CHUNK);
          }
        }
      }
      pruneChunks(frame);
    }

    // Generate everything within `radius` up front (used at spawn).
    function prewarm(x, y, radius) {
      const c0x = Math.floor((x - radius) / CHUNK);
      const c1x = Math.floor((x + radius) / CHUNK);
      const c0y = Math.floor((y - radius) / CHUNK);
      const c1y = Math.floor((y + radius) / CHUNK);
      for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) getChunk(cx, cy);
    }

    // ---- Pickups ---------------------------------------------------------
    // Fuel cans sit on the ground (fly low to grab them); score rings float
    // at a fixed altitude band. Both are placed deterministically per chunk.

    function pickupsIn(cx, cy) {
      const out = [];
      const hf = Noise.hash(cx, cy, seed + 1234);
      if (hf < 0.5) {
        const px = cx * CHUNK + 24 + Noise.hash(cx, cy, seed + 1) * (CHUNK - 48);
        const py = cy * CHUNK + 24 + Noise.hash(cx, cy, seed + 2) * (CHUNK - 48);
        const ground = groundAt(px, py);
        if (ground < 30) out.push({ kind: 'fuel', id: 'f' + cx + ',' + cy, x: px, y: py, alt: ground });
      }
      const hr = Noise.hash(cx, cy, seed + 5678);
      if (hr < 0.42) {
        const px = cx * CHUNK + 24 + Noise.hash(cx, cy, seed + 3) * (CHUNK - 48);
        const py = cy * CHUNK + 24 + Noise.hash(cx, cy, seed + 4) * (CHUNK - 48);
        const ground = groundAt(px, py);
        const alt = Math.max(ground + 25, 45 + Noise.hash(cx, cy, seed + 6) * 50);
        if (alt < MAX_ALT - 10) out.push({ kind: 'ring', id: 'r' + cx + ',' + cy, x: px, y: py, alt });
      }
      return out;
    }

    function pickupsNear(x, y, radius) {
      const out = [];
      const c0x = Math.floor((x - radius) / CHUNK);
      const c1x = Math.floor((x + radius) / CHUNK);
      const c0y = Math.floor((y - radius) / CHUNK);
      const c1y = Math.floor((y + radius) / CHUNK);
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          for (const p of pickupsIn(cx, cy)) out.push(p);
        }
      }
      return out;
    }

    // Find a flat, low spot near the origin to start from.
    function findSpawn() {
      for (let r = 0; r < 60; r++) {
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const x = Math.cos(ang) * r * 120;
          const y = Math.sin(ang) * r * 120;
          if (groundAt(x, y) === 0 && biomeAt(x, y) >= BIOME.BEACH) {
            let ok = true;
            for (let dy = -80; dy <= 80 && ok; dy += 40) {
              for (let dx = -80; dx <= 80; dx += 40) {
                if (groundAt(x + dx, y + dy) > 0) { ok = false; break; }
              }
            }
            if (ok) return { x, y };
          }
        }
      }
      return { x: 0, y: 0 };
    }

    return {
      seed, elevation, moisture, biomeAt, groundAt, groundFromElevation,
      draw, prewarm, setDpr, pickupsIn, pickupsNear, findSpawn,
      chunkCount: () => chunkCache.size,
    };
  }

  global.Terrain = { makeWorld, CHUNK, CELL, MAX_ALT, BIOME, BIOME_NAME, BIOME_RGB };
})(typeof window !== 'undefined' ? window : globalThis);

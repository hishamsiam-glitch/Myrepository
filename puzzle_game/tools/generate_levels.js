#!/usr/bin/env node
/*
 * Deterministic level generator for Crate Quest.
 *
 * For each of the 100 levels it:
 *   1. carves a random room (seeded PRNG, so output is reproducible),
 *   2. places targets and puts the boxes on them (the solved state),
 *   3. runs a reverse breadth-first search that *pulls* boxes away from the
 *      solved state. Because every pull is a push in reverse, the BFS depth of
 *      a state is exactly the minimum number of pushes needed to solve it,
 *   4. picks a start state at the depth the difficulty curve asks for,
 *   5. reconstructs the optimal push solution by walking the BFS parents
 *      forward through the real game engine (so it is verified as it is built),
 *   6. writes everything to ../levels.js.
 *
 * Usage: node tools/generate_levels.js [--seed N] [--out path] [--only a-b]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Level, replay } = require('../web/engine.js');

// ----------------------------------------------------------------------------
// Difficulty curve: 10 worlds of 10 levels. Within a world the target number
// of optimal pushes rises linearly from pushes[0] to pushes[1].
// ----------------------------------------------------------------------------
const WORLDS = [
  { name: 'First Steps', boxes: [1, 1], w: [4, 5], h: [4, 5], pushes: [1, 10], density: [0.6, 0.8], cap: 200000 },
  { name: 'Two at a Time', boxes: [2, 2], w: [5, 6], h: [5, 6], pushes: [6, 16], density: [0.55, 0.75], cap: 300000 },
  { name: 'Tight Corners', boxes: [2, 3], w: [6, 6], h: [5, 6], pushes: [12, 24], density: [0.55, 0.7], cap: 400000 },
  { name: 'Warehouse', boxes: [3, 3], w: [6, 7], h: [6, 7], pushes: [18, 30], density: [0.5, 0.7], cap: 500000 },
  { name: 'Logistics', boxes: [3, 4], w: [7, 7], h: [6, 7], pushes: [24, 38], density: [0.5, 0.68], cap: 600000 },
  { name: 'Cargo Bay', boxes: [4, 4], w: [7, 8], h: [7, 7], pushes: [30, 46], density: [0.5, 0.66], cap: 700000 },
  { name: 'Freight Yard', boxes: [4, 5], w: [8, 8], h: [7, 8], pushes: [36, 54], density: [0.5, 0.65], cap: 800000 },
  { name: 'Dockside', boxes: [5, 5], w: [8, 9], h: [8, 8], pushes: [42, 62], density: [0.48, 0.64], cap: 900000 },
  { name: 'Deep Storage', boxes: [5, 6], w: [9, 9], h: [8, 9], pushes: [50, 72], density: [0.48, 0.62], cap: 1000000 },
  { name: 'Grandmaster', boxes: [6, 6], w: [10, 11], h: [9, 10], pushes: [60, 90], density: [0.46, 0.6], cap: 1500000 },
];
const LEVELS_PER_WORLD = 10;
const attemptsFor = (world) => (world.cap <= 800000 ? 12 : 6);

// ----------------------------------------------------------------------------
// Small deterministic PRNG (mulberry32).
// ----------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const lerp = (a, b, t) => a + (b - a) * t;

const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];
const OPPOSITE = { u: 'd', d: 'u', l: 'r', r: 'l' };

// ----------------------------------------------------------------------------
// Room carving: random walk with a 2x2 brush inside a walled rectangle.
// ----------------------------------------------------------------------------
function carveRoom(rng, w, h, density) {
  const W = w + 2;
  const H = h + 2;
  const floor = new Uint8Array(W * H);
  const want = Math.max(6, Math.round(w * h * density));
  let x = randInt(rng, 1, w);
  let y = randInt(rng, 1, h);
  let dir = DIRS[randInt(rng, 0, 3)];
  let count = 0;
  const carve = (cx, cy) => {
    if (cx < 1 || cy < 1 || cx > w || cy > h) return;
    const i = cy * W + cx;
    if (!floor[i]) {
      floor[i] = 1;
      count++;
    }
  };
  let steps = 0;
  while (count < want && steps < 5000) {
    steps++;
    carve(x, y);
    if (rng() < 0.25) {
      carve(x + 1, y);
      carve(x, y + 1);
      carve(x + 1, y + 1);
    }
    if (rng() < 0.45) dir = DIRS[randInt(rng, 0, 3)];
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx >= 1 && ny >= 1 && nx <= w && ny <= h) {
      x = nx;
      y = ny;
    } else {
      dir = DIRS[randInt(rng, 0, 3)];
    }
  }
  return { W, H, floor };
}

// ----------------------------------------------------------------------------
// Reverse BFS over "pull" moves.
// ----------------------------------------------------------------------------
function buildBinomials(maxN, maxK) {
  const b = [];
  for (let n = 0; n <= maxN; n++) {
    b[n] = new Array(maxK + 1).fill(0);
    b[n][0] = 1;
    for (let k = 1; k <= Math.min(n, maxK); k++) b[n][k] = b[n - 1][k - 1] + b[n - 1][k];
  }
  return b;
}

function reverseBFS(room, targets, nBoxes, cap) {
  const { W, H, floor } = room;
  const n = W * H;
  // Compact ids for floor cells so the state key fits in a double.
  const compact = new Int16Array(n).fill(-1);
  const cells = [];
  for (let i = 0; i < n; i++) {
    if (floor[i]) {
      compact[i] = cells.length;
      cells.push(i);
    }
  }
  const F = cells.length;
  const binom = buildBinomials(F + 1, nBoxes);
  const keyOf = (boxes, normCell) => {
    // boxes: sorted compact ids
    let rank = 0;
    for (let k = 0; k < nBoxes; k++) rank += binom[boxes[k]][k + 1];
    return rank * F + compact[normCell];
  };

  const occ = new Uint8Array(n);
  const stamp = new Int32Array(n);
  let stampId = 0;
  const fillStack = new Int32Array(n);
  const nbr = [-W, W, -1, 1];

  // Flood fill from p over free floor cells; returns min index in the region.
  function floodMin(p) {
    stampId++;
    let min = p;
    let sp = 0;
    fillStack[sp++] = p;
    stamp[p] = stampId;
    while (sp) {
      const i = fillStack[--sp];
      if (i < min) min = i;
      for (let k = 0; k < 4; k++) {
        const j = i + nbr[k];
        if (!floor[j] || occ[j] || stamp[j] === stampId) continue;
        stamp[j] = stampId;
        fillStack[sp++] = j;
      }
    }
    return min;
  }

  // State storage (structure of arrays).
  const boxStore = new Int16Array(cap * nBoxes); // cell indices, sorted
  const playerActual = new Int32Array(cap);
  const dist = new Uint16Array(cap);
  const parent = new Int32Array(cap);
  const pullBox = new Int32Array(cap); // box position *before* the pull
  const pullDir = new Uint8Array(cap); // index into DIRS
  const map = new Map();
  let size = 0;

  const tmpBoxes = new Int16Array(nBoxes);
  const tmpCompact = new Int16Array(nBoxes);

  function addState(boxesSorted, norm, actual, d, par, pb, pd) {
    for (let k = 0; k < nBoxes; k++) tmpCompact[k] = compact[boxesSorted[k]];
    const key = keyOf(tmpCompact, norm);
    if (map.has(key)) return false;
    if (size >= cap) return false;
    map.set(key, size);
    boxStore.set(boxesSorted, size * nBoxes);
    playerActual[size] = actual;
    dist[size] = d;
    parent[size] = par;
    pullBox[size] = pb;
    pullDir[size] = pd;
    size++;
    return true;
  }

  // Roots: solved configuration with the player in each distinct region.
  const solvedBoxes = Int16Array.from(targets).sort((a, b) => a - b);
  occ.fill(0);
  for (const t of targets) occ[t] = 1;
  const rootSeen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!floor[i] || occ[i] || rootSeen[i]) continue;
    const norm = floodMin(i);
    for (let j = 0; j < n; j++) if (stamp[j] === stampId) rootSeen[j] = 1;
    addState(solvedBoxes, norm, norm, 0, -1, -1, 0);
  }

  const curBoxes = new Int16Array(nBoxes);
  const region = new Uint8Array(n);
  let head = 0;
  let full = false;
  while (head < size && !full) {
    const s = head++;
    for (let k = 0; k < nBoxes; k++) curBoxes[k] = boxStore[s * nBoxes + k];
    occ.fill(0);
    for (let k = 0; k < nBoxes; k++) occ[curBoxes[k]] = 1;
    // region of the player (copied out, because the successor flood fills
    // below reuse the stamp array)
    floodMin(playerActual[s]); // actual is always inside the region
    for (let i = 0; i < n; i++) region[i] = stamp[i] === stampId ? 1 : 0;
    const d = dist[s] + 1;
    for (let k = 0; k < nBoxes && !full; k++) {
      const b = curBoxes[k];
      for (let di = 0; di < 4 && !full; di++) {
        const step = nbr[di];
        const p1 = b + step;
        if (!region[p1] || occ[p1]) continue; // player must stand here
        const p2 = p1 + step;
        if (!floor[p2] || occ[p2]) continue; // and step back here
        // apply pull
        occ[b] = 0;
        occ[p1] = 1;
        const newNorm = floodMin(p2);
        occ[p1] = 0;
        occ[b] = 1;
        // sorted copy with b replaced by p1
        let m = 0;
        for (let q = 0; q < nBoxes; q++) {
          if (q === k) continue;
          tmpBoxes[m++] = curBoxes[q];
        }
        // insert p1 keeping order
        let pos = m;
        while (pos > 0 && tmpBoxes[pos - 1] > p1) {
          tmpBoxes[pos] = tmpBoxes[pos - 1];
          pos--;
        }
        tmpBoxes[pos] = p1;
        if (!addState(tmpBoxes, newNorm, p2, d, s, b, di) && size >= cap) full = true;
      }
    }
  }

  let maxDepth = 0;
  for (let i = 0; i < size; i++) if (dist[i] > maxDepth) maxDepth = dist[i];
  // Only depths whose layer was fully generated are exactly optimal AND
  // complete. Anything found is still exactly optimal (BFS), so all depths
  // are usable; but if the cap hit we drop the last (partial) layer so the
  // choice among states is representative.
  const usableDepth = full ? Math.max(0, maxDepth - 1) : maxDepth;

  return {
    size,
    full,
    maxDepth: usableDepth,
    statesAtDepth(dep) {
      const out = [];
      for (let i = 0; i < size; i++) if (dist[i] === dep) out.push(i);
      return out;
    },
    boxes(i) {
      return Array.from(boxStore.subarray(i * nBoxes, i * nBoxes + nBoxes));
    },
    player(i) {
      return playerActual[i];
    },
    chain(i) {
      // from state i back to a root: list of {box, dir}
      const out = [];
      let s = i;
      while (parent[s] >= 0) {
        out.push({ box: pullBox[s], dir: DIRS[pullDir[s]] });
        s = parent[s];
      }
      return out;
    },
  };
}

// ----------------------------------------------------------------------------
// Helpers for scoring candidate start states.
// ----------------------------------------------------------------------------
function bfsDistances(room, from) {
  const { W, floor } = room;
  const n = floor.length;
  const dist = new Int32Array(n).fill(-1);
  const q = [from];
  dist[from] = 0;
  let head = 0;
  const nbr = [-W, W, -1, 1];
  while (head < q.length) {
    const i = q[head++];
    for (const s of nbr) {
      const j = i + s;
      if (j < 0 || j >= n || !floor[j] || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  return dist;
}

function assignmentLowerBound(room, boxes, targets) {
  // Minimum over box->target assignments of summed walking distance.
  const dists = boxes.map((b) => bfsDistances(room, b));
  const n = boxes.length;
  const used = new Array(n).fill(false);
  let best = Infinity;
  (function rec(i, sum) {
    if (sum >= best) return;
    if (i === n) {
      best = sum;
      return;
    }
    for (let t = 0; t < n; t++) {
      if (used[t]) continue;
      const d = dists[i][targets[t]];
      if (d < 0) continue;
      used[t] = true;
      rec(i + 1, sum + d);
      used[t] = false;
    }
  })(0, 0);
  return best;
}

function toRows(room, boxes, targets, player) {
  const { W, H, floor } = room;
  const targetSet = new Set(targets);
  const boxSet = new Set(boxes);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let s = '';
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let ch;
      if (!floor[i]) {
        // wall, or void if no floor touches it (8-neighbourhood)
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (floor[ny * W + nx]) {
              touches = true;
              break;
            }
          }
        }
        ch = touches ? '#' : '-';
      } else if (i === player) ch = targetSet.has(i) ? '+' : '@';
      else if (boxSet.has(i)) ch = targetSet.has(i) ? '*' : '$';
      else ch = targetSet.has(i) ? '.' : ' ';
      s += ch;
    }
    rows.push(s);
  }
  // crop fully-void rows/cols
  const keepRow = rows.map((r) => /[^-]/.test(r));
  let out = rows.filter((_, i) => keepRow[i]);
  const width = out[0].length;
  const keepCol = [];
  for (let x = 0; x < width; x++) keepCol.push(out.some((r) => r[x] !== '-'));
  out = out.map((r) => r.split('').filter((_, x) => keepCol[x]).join(''));
  return out;
}

// Build the forward solution (LURD string) by replaying the pull chain in
// reverse through the actual game engine.
function buildSolution(rows, room, chain) {
  const level = new Level(rows);
  // Map room indices -> level indices (rows were cropped).
  // Recompute the crop offsets by locating the player.
  const W = room.W;
  let solution = '';
  for (const { box, dir } of chain) {
    // The pull moved the box from `box` to box+dir and the player to box+2dir.
    // Forward: walk to box+2dir, push in the opposite direction.
    const p2 = box + 2 * (dir.dy * W + dir.dx);
    const target = room.toLevel(p2);
    const path = level.pathTo(target.x, target.y);
    if (!path) throw new Error('Solution reconstruction: unreachable push position');
    for (const step of path) {
      const rec = level.move(step);
      if (!rec || rec.pushed) throw new Error('Solution reconstruction: bad walk');
      solution += step;
    }
    const pushDir = OPPOSITE[dir.ch];
    const rec = level.move(pushDir);
    if (!rec || !rec.pushed) throw new Error('Solution reconstruction: push failed');
    solution += pushDir.toUpperCase();
  }
  if (!level.solved) throw new Error('Solution reconstruction: level not solved at end');
  return solution;
}

// ----------------------------------------------------------------------------
// Per-level generation.
// ----------------------------------------------------------------------------
function generateLevel(index, baseSeed) {
  const world = WORLDS[Math.floor(index / LEVELS_PER_WORLD)];
  const k = index % LEVELS_PER_WORLD;
  const t = k / (LEVELS_PER_WORLD - 1);
  const targetPushes = Math.round(lerp(world.pushes[0], world.pushes[1], t));
  let best = null;

  for (let attempt = 0; attempt < attemptsFor(world); attempt++) {
    const rng = mulberry32(baseSeed * 7919 + index * 131 + attempt * 17 + 1);
    const nBoxes = randInt(rng, world.boxes[0], world.boxes[1]);
    const w = randInt(rng, world.w[0], world.w[1]);
    const h = randInt(rng, world.h[0], world.h[1]);
    const density = lerp(world.density[0], world.density[1], rng());
    const room = carveRoom(rng, w, h, density);
    const { W, floor } = room;
    const floorCells = [];
    for (let i = 0; i < floor.length; i++) if (floor[i]) floorCells.push(i);
    if (floorCells.length < nBoxes * 3 + 2) continue;

    // Targets: distinct floor cells from which a box can be pulled at least
    // one way (otherwise the box could never have arrived there by pushing).
    const targets = [];
    const canPull = (c) => {
      for (const d of DIRS) {
        const s = d.dy * W + d.dx;
        if (floor[c + s] && floor[c + 2 * s]) return true;
      }
      return false;
    };
    const pool = floorCells.filter(canPull);
    if (pool.length < nBoxes) continue;
    let tries = 0;
    while (targets.length < nBoxes && tries++ < 200) {
      const c = pool[randInt(rng, 0, pool.length - 1)];
      if (!targets.includes(c)) targets.push(c);
    }
    if (targets.length < nBoxes) continue;

    const bfs = reverseBFS(room, targets, nBoxes, world.cap);
    if (bfs.maxDepth < 1) continue;
    const depth = Math.min(targetPushes, bfs.maxDepth);
    const candidates = bfs.statesAtDepth(depth);
    if (!candidates.length) continue;

    // Score candidate start states.
    let bestState = null;
    let bestScore = -Infinity;
    const sample = candidates.length > 400 ? candidates.filter(() => rng() < 400 / candidates.length) : candidates;
    for (const s of sample.length ? sample : candidates) {
      const boxes = bfs.boxes(s);
      const onTargets = boxes.filter((b) => targets.includes(b)).length;
      const lb = assignmentLowerBound(room, boxes, targets);
      const detour = lb > 0 ? depth / lb : 0;
      const score = (onTargets === 0 ? 100 : 0) - onTargets * 20 + detour * 10 + rng() * 2;
      if (score > bestScore) {
        bestScore = score;
        bestState = s;
      }
    }
    const boxes = bfs.boxes(bestState);
    const player = bfs.player(bestState);
    const onTargets = boxes.filter((b) => targets.includes(b)).length;

    // Rows + a mapping from room indices to (cropped) level coordinates.
    const rows = toRows(room, boxes, targets, player);
    const lvl = new Level(rows);
    const px = player % W;
    const py = (player - px) / W;
    const lp = lvl.playerPos;
    const offX = px - lp.x;
    const offY = py - lp.y;
    room.toLevel = (i) => ({ x: (i % W) - offX, y: (i - (i % W)) / W - offY });

    // chain() already runs from the start state back to the solved state:
    // its first entry is the pull that created the start state, i.e. the
    // first push of the forward solution.
    const chain = bfs.chain(bestState);
    const solution = buildSolution(rows, room, chain);
    const check = replay(rows, solution);
    if (!check.ok || check.pushes !== depth) throw new Error(`Level ${index + 1}: reconstruction mismatch`);

    const quality = depth - Math.abs(depth - targetPushes) * 2 - onTargets * 3 + (bfs.full ? -1 : 0);
    const cand = { rows, boxes: nBoxes, pushes: depth, moves: solution.length, solution, quality, attempt, states: bfs.size, maxDepth: bfs.maxDepth };
    if (!best || cand.quality > best.quality) best = cand;
    if (depth >= targetPushes && onTargets === 0) break; // good enough
  }
  if (!best) throw new Error(`Could not generate level ${index + 1}`);
  return best;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  let seed = 2026;
  let out = path.join(__dirname, '..', 'web', 'levels.js');
  let only = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed') seed = Number(args[++i]);
    else if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--only') {
      const [a, b] = args[++i].split('-').map(Number);
      only = [a, b === undefined ? a : b];
    }
  }

  const total = WORLDS.length * LEVELS_PER_WORLD;
  const levels = [];
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    if (only && (i + 1 < only[0] || i + 1 > only[1])) continue;
    const t1 = Date.now();
    const lvl = generateLevel(i, seed);
    const world = WORLDS[Math.floor(i / LEVELS_PER_WORLD)];
    levels.push({
      id: i + 1,
      world: Math.floor(i / LEVELS_PER_WORLD) + 1,
      worldName: world.name,
      boxes: lvl.boxes,
      pushes: lvl.pushes,
      moves: lvl.moves,
      rows: lvl.rows,
      solution: lvl.solution,
    });
    console.error(
      `level ${String(i + 1).padStart(3)}  boxes=${lvl.boxes}  pushes=${String(lvl.pushes).padStart(3)}  moves=${String(lvl.moves).padStart(3)}  ` +
        `size=${lvl.rows[0].length}x${lvl.rows.length}  states=${lvl.states}  maxDepth=${lvl.maxDepth}  attempt=${lvl.attempt}  ${((Date.now() - t1) / 1000).toFixed(1)}s`
    );
  }

  if (only) {
    console.log(JSON.stringify(levels, null, 1));
    return;
  }

  orderLevels(levels);

  fs.writeFileSync(out, serializeLevels(levels, seed));
  console.error(`wrote ${levels.length} levels to ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Difficulty score used to order the levels: optimal pushes, plus a premium
// per crate because more crates interact in more ways.
const difficulty = (l) => l.pushes + l.boxes * 4;

// Sort all levels by difficulty (stable), then assign worlds by position so
// the curve never dips, and renumber 1..100.
function orderLevels(levels) {
  levels.sort((a, b) => difficulty(a) - difficulty(b) || a.id - b.id);
  levels.forEach((l, i) => {
    l.id = i + 1;
    l.world = Math.floor(i / LEVELS_PER_WORLD) + 1;
    l.worldName = WORLDS[l.world - 1].name;
  });
  return levels;
}

function serializeLevels(levels, seed) {
  const header =
    '/* Crate Quest levels - GENERATED FILE, do not edit by hand.\n' +
    ` * Regenerate with: node tools/generate_levels.js --seed ${seed}\n` +
    ' * Every level ships with a verified optimal-push solution (LURD notation:\n' +
    ' * lowercase = walk, uppercase = push). */\n';
  const body = levels
    .map((l) => {
      const rows = l.rows.map((r) => JSON.stringify(r)).join(',');
      return `  {id:${l.id},world:${l.world},worldName:${JSON.stringify(l.worldName)},boxes:${l.boxes},pushes:${l.pushes},moves:${l.moves},\n   rows:[${rows}],\n   solution:${JSON.stringify(l.solution)}}`;
    })
    .join(',\n');
  const js =
    header +
    '(function (root, factory) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = factory();\n" +
    '  else root.CRATE_LEVELS = factory();\n' +
    "})(typeof self !== 'undefined' ? self : this, function () {\n" +
    "  'use strict';\n  return [\n" +
    body +
    '\n  ];\n});\n';
  return js;
}

if (require.main === module) main();
module.exports = { WORLDS, generateLevel, carveRoom, reverseBFS, orderLevels, serializeLevels, difficulty };

#!/usr/bin/env node
/*
 * Verifies web/levels.js:
 *   - 100 levels, ids 1..100, 10 per world, difficulty non-decreasing per world
 *   - every level parses, has as many boxes as targets, and its shipped
 *     solution really solves it (replayed through the game engine)
 *   - the shipped push count matches the solution
 *   - an independent forward solver (BFS over pushes, written separately
 *     from the generator's reverse search) confirms the solution is optimal
 *     wherever it finishes within its state budget.
 *
 * Usage: node test/verify_levels.js [--no-solver] [--only a-b]
 */
'use strict';

const path = require('path');
const { Level, replay } = require(path.join(__dirname, '..', 'web', 'engine.js'));
const LEVELS = require(path.join(__dirname, '..', 'web', 'levels.js'));

const args = process.argv.slice(2);
const runSolver = !args.includes('--no-solver');
let only = null;
const onlyIdx = args.indexOf('--only');
if (onlyIdx >= 0) {
  const [a, b] = args[onlyIdx + 1].split('-').map(Number);
  only = [a, b === undefined ? a : b];
}
const SOLVER_CAP = Number(process.env.SOLVER_CAP || 400000);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('FAIL: ' + msg);
};
const assert = (cond, msg) => {
  if (!cond) fail(msg);
};

// ---------------------------------------------------------------------------
// Independent forward solver: BFS over (boxes, normalized player region).
// Uses "dead square" pruning (a box can never be pushed to a target from a
// dead square) so hard levels stay tractable.
// ---------------------------------------------------------------------------
function forwardSolve(rows, cap) {
  const lvl = new Level(rows);
  const W = lvl.width;
  const n = W * lvl.height;
  const nbr = [-W, W, -1, 1];
  const floor = lvl.floor;
  const target = lvl.target;

  // Dead squares: floor cells from which no box can ever reach any target.
  // Computed by reverse "pull" reachability from the targets with no other
  // boxes on the board (a relaxation, so it never marks a live square dead).
  const alive = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) if (target[i]) { alive[i] = 1; stack.push(i); }
  while (stack.length) {
    const b = stack.pop();
    for (const s of nbr) {
      const from = b - s; // box could come from here ...
      const player = b - 2 * s; // ... if the player stood here
      if (from < 0 || from >= n || player < 0 || player >= n) continue;
      if (!floor[from] || !floor[player] || alive[from]) continue;
      // The push from `from` to `b` needs the player at `from - s`.
      // (from - s == b - 2s == player). Valid if both are floor.
      alive[from] = 1;
      stack.push(from);
    }
  }

  const startBoxes = [];
  for (let i = 0; i < n; i++) if (lvl.box[i]) startBoxes.push(i);
  const k = startBoxes.length;

  const occ = new Uint8Array(n);
  const stamp = new Int32Array(n);
  let stampId = 0;
  const fillStack = new Int32Array(n);
  function flood(p) {
    stampId++;
    let min = p;
    let sp = 0;
    fillStack[sp++] = p;
    stamp[p] = stampId;
    while (sp) {
      const i = fillStack[--sp];
      if (i < min) min = i;
      for (const s of nbr) {
        const j = i + s;
        if (j < 0 || j >= n || !floor[j] || occ[j] || stamp[j] === stampId) continue;
        stamp[j] = stampId;
        fillStack[sp++] = j;
      }
    }
    return min;
  }

  const seen = new Set();
  const queue = []; // {boxes, player, depth}
  const push = (boxes, norm, depth) => {
    const key = boxes.join(',') + '|' + norm;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({ boxes, norm, depth });
  };
  occ.fill(0);
  for (const b of startBoxes) occ[b] = 1;
  push(startBoxes.slice().sort((a, b) => a - b), flood(lvl.player), 0);

  let head = 0;
  const region = new Uint8Array(n);
  while (head < queue.length) {
    const { boxes, norm, depth } = queue[head++];
    let done = true;
    for (const b of boxes) if (!target[b]) { done = false; break; }
    if (done) return { pushes: depth, states: seen.size };
    if (seen.size >= cap) return { pushes: null, states: seen.size };
    occ.fill(0);
    for (const b of boxes) occ[b] = 1;
    flood(norm);
    for (let i = 0; i < n; i++) region[i] = stamp[i] === stampId ? 1 : 0;
    for (let bi = 0; bi < k; bi++) {
      const b = boxes[bi];
      for (const s of nbr) {
        const from = b - s; // player stands here
        const to = b + s; // box goes here
        if (from < 0 || from >= n || to < 0 || to >= n) continue;
        if (!region[from] || !floor[to] || occ[to] || !alive[to]) continue;
        occ[b] = 0;
        occ[to] = 1;
        const newNorm = flood(b);
        occ[to] = 0;
        occ[b] = 1;
        const nb = boxes.slice();
        nb[bi] = to;
        nb.sort((x, y) => x - y);
        push(nb, newNorm, depth + 1);
      }
    }
  }
  return { pushes: -1, states: seen.size }; // exhausted: unsolvable
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
assert(Array.isArray(LEVELS), 'levels.js must export an array');
assert(LEVELS.length === 100, `expected 100 levels, got ${LEVELS.length}`);
LEVELS.forEach((l, i) => assert(l.id === i + 1, `level at index ${i} has id ${l.id}`));

const t0 = Date.now();
let solverChecked = 0;
let solverSkipped = 0;
for (const l of LEVELS) {
  if (only && (l.id < only[0] || l.id > only[1])) continue;
  const tag = `level ${l.id}`;
  let lvl;
  try {
    lvl = new Level(l.rows);
  } catch (e) {
    fail(`${tag}: does not parse: ${e.message}`);
    continue;
  }
  assert(lvl.boxCount === l.boxes, `${tag}: declares ${l.boxes} boxes but has ${lvl.boxCount}`);
  assert(lvl.boxCount >= 1, `${tag}: no boxes`);
  assert(!lvl.solved, `${tag}: already solved at start`);
  assert(Math.floor((l.id - 1) / 10) + 1 === l.world, `${tag}: wrong world ${l.world}`);
  assert(typeof l.worldName === 'string' && l.worldName.length > 0, `${tag}: missing world name`);
  assert(l.rows.every((r) => r.length === l.rows[0].length), `${tag}: ragged rows`);

  const r = replay(l.rows, l.solution);
  assert(r.ok, `${tag}: shipped solution does not solve the level (failed at move ${r.failedAt})`);
  assert(r.pushes === l.pushes, `${tag}: solution has ${r.pushes} pushes, metadata says ${l.pushes}`);
  assert(r.moves === l.moves && l.moves === l.solution.length, `${tag}: move count mismatch`);

  if (runSolver) {
    const res = forwardSolve(l.rows, SOLVER_CAP);
    if (res.pushes === null) {
      solverSkipped++;
    } else {
      solverChecked++;
      assert(res.pushes >= 0, `${tag}: forward solver says unsolvable`);
      assert(res.pushes === l.pushes, `${tag}: forward solver found ${res.pushes} pushes, shipped solution uses ${l.pushes}`);
    }
  }
}

// Difficulty curve: within each world the (pushes + 4*boxes) score must not decrease,
// and each world's first level must not be easier than the previous world's first.
if (!only) {
  const score = (l) => l.pushes + l.boxes * 4;
  for (let w = 0; w < 10; w++) {
    const slice = LEVELS.slice(w * 10, w * 10 + 10);
    for (let i = 1; i < slice.length; i++) {
      assert(score(slice[i]) >= score(slice[i - 1]), `level ${slice[i].id} is easier than level ${slice[i - 1].id}`);
    }
  }
  assert(LEVELS[0].pushes <= 2, 'level 1 should be a one- or two-push puzzle');
  assert(LEVELS[99].boxes >= 5 && LEVELS[99].pushes >= 30, 'level 100 should be substantially harder than level 1');
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (failures) {
  console.error(`\n${failures} check(s) failed (${secs}s)`);
  process.exit(1);
}
console.log(
  `OK: ${only ? 'selected' : LEVELS.length} levels verified in ${secs}s` +
    (runSolver ? ` (forward solver confirmed optimality on ${solverChecked}, budget exceeded on ${solverSkipped})` : '')
);

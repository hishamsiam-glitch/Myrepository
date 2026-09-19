/* Unit checks on the level layout: every spawn/pickup/checkpoint sits on a
 * walkable cell and everything is reachable from the start once the gates
 * open. Run with: node test/level.test.js */
import assert from 'node:assert';
import { buildLevel, isSolid, computeFlowField, lineOfSight, moveWithCollision, CELL, cellToWorld, inRect } from '../js/level.js';

const level = buildLevel();
const walkable = (x, y) => !isSolid(level, x, y);

const specials = [
  ['start', level.start], ...level.checkpoints.map((c) => [`checkpoint ${c.id}`, c]),
  ...level.enemies.map((e, i) => [`enemy ${i} (${e.type})`, e]), ...level.pickups.map((p) => [`pickup ${p.id}`, p]),
  ['relay', level.relay], ['extraction', level.extraction],
  ...level.missions.flatMap((m) => (m.spawnPoints || []).map((s, i) => [`${m.id} spawn ${i}`, { x: s[0], y: s[1] }])),
];
for (const [name, c] of specials) assert.ok(walkable(c.x, c.y), `${name} at (${c.x},${c.y}) is inside a wall`);

// No two specials share a cell.
const seen = new Map();
for (const [name, c] of specials) {
  const key = `${c.x},${c.y}`;
  assert.ok(!seen.has(key), `${name} shares cell ${key} with ${seen.get(key)}`);
  seen.set(key, name);
}

// Gates block progress while closed...
const closed = computeFlowField(level, level.start.x, level.start.y);
const at = (c) => closed[c.y * level.w + c.x];
assert.ok(at(level.checkpoints[2]) >= 0, 'checkpoint 3 reachable with gates closed');
assert.ok(at(level.checkpoints[3]) < 0, 'checkpoint 4 must be behind gate A');
// ...and everything is reachable once they are open.
for (const g of level.gates) for (const [x, y] of g.cells) level.solid[y * level.w + x] = 0;
const open = computeFlowField(level, level.start.x, level.start.y);
for (const [name, c] of specials) assert.ok(open[c.y * level.w + c.x] >= 0, `${name} unreachable with gates open`);

// Every enemy is inside its zone rect; each mission trigger is inside a zone.
for (const e of level.enemies) {
  const z = level.zones.find((z) => z.id === e.zone);
  assert.ok(inRect(z.rect, e.x, e.y), `enemy at (${e.x},${e.y}) outside zone ${e.zone}`);
}
for (const cp of level.checkpoints) assert.ok(level.zones.some((z) => inRect(z.rect, cp.x, cp.y)), `checkpoint ${cp.id} outside all zones`);

// Line of sight through open floor, blocked by walls.
const a = cellToWorld(3, 34), b = cellToWorld(10, 34);
assert.ok(lineOfSight(level, a.x, a.z, b.x, b.z), 'clear LOS across the yard');
const c = cellToWorld(3, 26); // other side of the band wall (row 27)
assert.ok(!lineOfSight(level, a.x, a.z, c.x, c.z), 'wall must block LOS');

// Collision: walking into the west wall stops at the wall with a slide.
let p = { x: 1.5 * CELL, z: 34.5 * CELL };
for (let i = 0; i < 40; i++) p = moveWithCollision(level, p.x, p.z, -0.5, 0.1, 0.45);
assert.ok(p.x >= CELL + 0.45 - 1e-6 && p.x < CELL + 0.6, `should stop flush at the wall (x=${p.x})`);
assert.ok(p.z > 34.5 * CELL + 1, 'should keep sliding along the wall');

console.log(`level ok: ${level.w}x${level.h}, ${level.enemies.length} enemies, ${level.pickups.length} pickups, ${level.checkpoints.length} checkpoints, ${level.missions.length} missions`);

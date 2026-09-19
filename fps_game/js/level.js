/* Level definition and grid helpers. Pure data + maths (no THREE), so it can
 * be unit-tested in Node.
 *
 * The map is a grid of CELL x CELL metre cells; solid cells are walls. The
 * layout is four horizontal "bands" of two rooms each, connected in a snake
 * so the player sweeps left-to-right, up, right-to-left, up, ... to the
 * extraction pad in the top-left. Each room is a zone with its own enemies,
 * a checkpoint at its entrance, and in some rooms a mission that must be
 * completed to open the gate to the next room.
 *
 * Grid coordinates: x = column (world x), y = row (world z). World position
 * of a cell centre is ((x + 0.5) * CELL, (y + 0.5) * CELL). */

export const CELL = 4;
export const WALL_H = 4;
export const W = 48;
export const H = 37;

export function cellToWorld(cx, cy) {
  return { x: (cx + 0.5) * CELL, z: (cy + 0.5) * CELL };
}

export function worldToCell(x, z) {
  return { cx: Math.floor(x / CELL), cy: Math.floor(z / CELL) };
}

export function buildLevel() {
  const solid = new Uint8Array(W * H);
  solid.fill(1);
  const set = (x, y, v) => { solid[y * W + x] = v; };
  const carve = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, 0); };
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, 1); };

  // Bands (each 8 cells tall, 46 wide).
  carve(1, 28, 46, 35); // band 4: rooms 1 (left) and 2 (right) - start
  carve(1, 19, 46, 26); // band 3: rooms 3 (right) and 4 (left)
  carve(1, 10, 46, 17); // band 2: rooms 5 (left) and 6 (right)
  carve(1, 1, 46, 8);   // band 1: rooms 7 (right) and 8 (left) - extraction

  // Dividing walls between the two rooms of each band.
  fill(23, 28, 23, 35); carve(23, 31, 23, 32); // room 1 -> 2: open doorway
  fill(23, 19, 23, 26);                         // room 3 -> 4: gate A
  fill(23, 10, 23, 17);                         // room 5 -> 6: gate B
  fill(23, 1, 23, 8);   carve(23, 4, 23, 5);    // room 7 -> 8: open doorway

  // Connectors between bands (through the wall rows).
  carve(44, 27, 45, 27); // room 2 -> room 3 (right end)
  carve(2, 18, 3, 18);   // room 4 -> room 5 (left end)
  carve(44, 9, 45, 9);   // room 6 -> room 7 (right end)

  // Cover blocks inside the rooms.
  const blocks = [
    // room 1
    [6, 30, 7, 31], [12, 33, 13, 33], [16, 29, 17, 29], [10, 29, 10, 29],
    // room 2
    [28, 30, 29, 30], [34, 33, 35, 34], [40, 29, 40, 30], [37, 29, 37, 29], [31, 34, 31, 35],
    // room 3 (hangar)
    [28, 21, 29, 22], [34, 24, 35, 25], [38, 20, 39, 21], [31, 25, 32, 25], [41, 23, 41, 23],
    // room 4
    [18, 24, 19, 25], [12, 20, 13, 21], [8, 23, 9, 24], [4, 20, 4, 21], [15, 22, 15, 22],
    // room 5 (storage)
    [7, 12, 8, 13], [12, 15, 13, 16], [17, 11, 18, 12], [4, 16, 4, 16], [20, 14, 20, 15], [10, 10, 10, 10],
    // room 6 (drone alley)
    [27, 15, 28, 16], [32, 11, 33, 12], [37, 14, 38, 15], [42, 11, 42, 12], [35, 17, 35, 17],
    // room 7
    [40, 3, 41, 4], [34, 6, 35, 7], [29, 2, 30, 3], [44, 6, 44, 6],
    // room 8 (extraction pad)
    [16, 2, 17, 3], [11, 6, 12, 7], [7, 2, 8, 2], [14, 5, 14, 5],
  ];
  for (const b of blocks) fill(b[0], b[1], b[2], b[3]);

  // Gates: solid until their mission is completed.
  const gates = [
    { id: 'A', cells: [[23, 22], [23, 23]], mission: 'hangar' },
    { id: 'B', cells: [[23, 13], [23, 14]], mission: 'cores' },
  ];

  // Zones: [x0, y0, x1, y1] inclusive cell rectangles.
  const zones = [
    { id: 1, name: 'Perimeter Yard', rect: [1, 28, 22, 35] },
    { id: 2, name: 'Loading Bay', rect: [24, 28, 46, 35] },
    { id: 3, name: 'Hangar', rect: [24, 19, 46, 26] },
    { id: 4, name: 'Barracks', rect: [1, 19, 22, 26] },
    { id: 5, name: 'Storage Vault', rect: [1, 10, 22, 17] },
    { id: 6, name: 'Drone Alley', rect: [24, 10, 46, 17] },
    { id: 7, name: 'Reactor Hall', rect: [24, 1, 46, 8] },
    { id: 8, name: 'Extraction Pad', rect: [1, 1, 22, 8] },
  ];

  const start = { x: 3, y: 34, yaw: -Math.PI / 2 }; // facing +x (east) into the yard

  const checkpoints = [
    { id: 1, x: 18, y: 31 },
    { id: 2, x: 27, y: 32 },
    { id: 3, x: 44, y: 24 },
    { id: 4, x: 20, y: 22 },
    { id: 5, x: 3, y: 15 },
    { id: 6, x: 26, y: 13 },
    { id: 7, x: 25, y: 5 },
  ];

  // Enemies: type, cell, zone. They spawn when the player first enters the
  // zone (unless the zone was already cleared at the last checkpoint).
  const enemies = [
    { type: 'crawler', x: 12, y: 30, zone: 1 }, { type: 'crawler', x: 19, y: 34, zone: 1 },
    { type: 'drone', x: 33, y: 30, zone: 2 }, { type: 'drone', x: 42, y: 34, zone: 2 }, { type: 'drone', x: 38, y: 31, zone: 2 },
    { type: 'crawler', x: 30, y: 33, zone: 2 }, { type: 'crawler', x: 44, y: 30, zone: 2 },
    { type: 'drone', x: 36, y: 22, zone: 3 }, { type: 'drone', x: 30, y: 20, zone: 3 }, { type: 'drone', x: 26, y: 25, zone: 3 }, { type: 'drone', x: 33, y: 23, zone: 3 },
    { type: 'crawler', x: 40, y: 25, zone: 3 }, { type: 'crawler', x: 27, y: 21, zone: 3 },
    { type: 'drone', x: 14, y: 25, zone: 4 }, { type: 'drone', x: 6, y: 22, zone: 4 }, { type: 'drone', x: 10, y: 20, zone: 4 }, { type: 'heavy', x: 3, y: 24, zone: 4 },
    { type: 'crawler', x: 9, y: 15, zone: 5 }, { type: 'crawler', x: 15, y: 11, zone: 5 }, { type: 'crawler', x: 19, y: 16, zone: 5 }, { type: 'crawler', x: 6, y: 11, zone: 5 },
    { type: 'drone', x: 14, y: 13, zone: 5 }, { type: 'drone', x: 21, y: 11, zone: 5 },
    { type: 'drone', x: 30, y: 13, zone: 6 }, { type: 'drone', x: 35, y: 15, zone: 6 }, { type: 'drone', x: 40, y: 12, zone: 6 }, { type: 'drone', x: 44, y: 16, zone: 6 }, { type: 'drone', x: 38, y: 11, zone: 6 },
    { type: 'heavy', x: 37, y: 4, zone: 7 }, { type: 'heavy', x: 31, y: 6, zone: 7 }, { type: 'drone', x: 42, y: 2, zone: 7 }, { type: 'drone', x: 27, y: 7, zone: 7 },
  ];

  // Pickups. 'core' items belong to the storage mission.
  const pickups = [
    { id: 'p1', kind: 'ammo', x: 8, y: 34 }, { id: 'p2', kind: 'health', x: 14, y: 29 },
    { id: 'p3', kind: 'ammo', x: 26, y: 29 }, { id: 'p4', kind: 'ammo', x: 39, y: 34 }, { id: 'p5', kind: 'health', x: 45, y: 33 },
    { id: 'p6', kind: 'ammo', x: 37, y: 26 }, { id: 'p7', kind: 'health', x: 25, y: 20 }, { id: 'p8', kind: 'ammo', x: 43, y: 20 },
    { id: 'p9', kind: 'ammo', x: 21, y: 26 }, { id: 'p10', kind: 'health', x: 11, y: 24 }, { id: 'p11', kind: 'ammo', x: 2, y: 20 },
    { id: 'c1', kind: 'core', x: 10, y: 16 }, { id: 'c2', kind: 'core', x: 21, y: 10 }, { id: 'c3', kind: 'core', x: 14, y: 12 },
    { id: 'p12', kind: 'ammo', x: 5, y: 11 }, { id: 'p13', kind: 'health', x: 17, y: 17 },
    { id: 'p14', kind: 'ammo', x: 25, y: 17 }, { id: 'p15', kind: 'health', x: 34, y: 10 }, { id: 'p16', kind: 'ammo', x: 45, y: 11 },
    { id: 'p17', kind: 'health', x: 36, y: 2 }, { id: 'p18', kind: 'ammo', x: 28, y: 2 }, { id: 'p19', kind: 'ammo', x: 43, y: 8 },
    { id: 'p20', kind: 'health', x: 19, y: 7 }, { id: 'p21', kind: 'ammo', x: 9, y: 4 },
  ];

  const relay = { x: 27, y: 4 };
  const extraction = { x: 3, y: 4 };

  // Missions. `trigger` is a cell rectangle; entering it starts the mission
  // unless it is already completed.
  const missions = [
    {
      id: 'hangar', type: 'eliminate', zone: 3,
      title: 'Clear the hangar',
      brief: 'Destroy every hostile in the hangar to unlock the gate.',
      trigger: [24, 19, 46, 26], reward: 500,
    },
    {
      id: 'cores', type: 'collect', zone: 5, item: 'core', count: 3, timeLimit: 90,
      title: 'Recover the data cores',
      brief: 'Grab all 3 data cores in the vault before the purge timer runs out. The gate opens once you have them.',
      trigger: [1, 10, 22, 17], reward: 750,
    },
    {
      id: 'relay', type: 'reach', target: relay, timeLimit: 75,
      title: 'Race to the relay',
      brief: 'The relay in the reactor hall goes dark in 75 seconds. Reach it through drone alley.',
      trigger: [29, 10, 46, 17], reward: 750,
    },
    {
      id: 'holdout', type: 'survive', duration: 45, waveEvery: 9,
      title: 'Hold the extraction pad',
      brief: 'Survive the counter-attack for 45 seconds until the extraction beacon comes online.',
      trigger: [1, 1, 18, 8], reward: 1000,
      spawnPoints: [[21, 2], [21, 7], [2, 1], [2, 8], [13, 1]],
    },
  ];

  return { w: W, h: H, solid, gates, zones, start, checkpoints, enemies, pickups, relay, extraction, missions };
}

export function isSolid(level, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) return true;
  return level.solid[cy * level.w + cx] === 1;
}

export function inRect(rect, cx, cy) {
  return cx >= rect[0] && cy >= rect[1] && cx <= rect[2] && cy <= rect[3];
}

/* Move a circle of radius r from (x, z) by (dx, dz), sliding along walls.
 * Axis-separated so the player can slide along a wall they walk into. */
export function moveWithCollision(level, x, z, dx, dz, r) {
  let nx = x + dx;
  if (!circleHitsWall(level, nx, z, r)) x = nx; else x = pushOutX(level, x, z, dx, r);
  let nz = z + dz;
  if (!circleHitsWall(level, x, nz, r)) z = nz; else z = pushOutZ(level, x, z, dz, r);
  return { x, z };
}

function pushOutX(level, x, z, dx, r) {
  // Snap flush against the wall in the direction of travel.
  const edge = dx > 0 ? Math.floor((x + r + dx) / CELL) * CELL - r - 0.001
                      : Math.ceil((x - r + dx) / CELL) * CELL + r + 0.001;
  return circleHitsWall(level, edge, z, r) ? x : edge;
}

function pushOutZ(level, x, z, dz, r) {
  const edge = dz > 0 ? Math.floor((z + r + dz) / CELL) * CELL - r - 0.001
                      : Math.ceil((z - r + dz) / CELL) * CELL + r + 0.001;
  return circleHitsWall(level, x, edge, r) ? z : edge;
}

export function circleHitsWall(level, x, z, r) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const y0 = Math.floor((z - r) / CELL), y1 = Math.floor((z + r) / CELL);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!isSolid(level, cx, cy)) continue;
      // Closest point on the cell's box to the circle centre.
      const px = Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL));
      const pz = Math.max(cy * CELL, Math.min(z, (cy + 1) * CELL));
      const ddx = x - px, ddz = z - pz;
      if (ddx * ddx + ddz * ddz < r * r) return true;
    }
  }
  return false;
}

/* Grid raycast (DDA) from world (x0,z0) towards (x1,z1). Returns true if
 * the segment is unobstructed by solid cells. */
export function lineOfSight(level, x0, z0, x1, z1) {
  let cx = Math.floor(x0 / CELL), cy = Math.floor(z0 / CELL);
  const ex = Math.floor(x1 / CELL), ey = Math.floor(z1 / CELL);
  const dx = x1 - x0, dz = z1 - z0;
  const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaY = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tMaxX = dx !== 0 ? (((dx > 0 ? (cx + 1) * CELL : cx * CELL) - x0) / dx) : Infinity;
  let tMaxY = dz !== 0 ? (((dz > 0 ? (cy + 1) * CELL : cy * CELL) - z0) / dz) : Infinity;
  if (isSolid(level, cx, cy)) return false;
  for (let i = 0; i < 400; i++) {
    if (cx === ex && cy === ey) return true;
    if (tMaxX < tMaxY) { tMaxX += tDeltaX; cx += stepX; } else { tMaxY += tDeltaY; cy += stepY; }
    if (isSolid(level, cx, cy)) return false;
    if (tMaxX > 1 && tMaxY > 1) return true;
  }
  return true;
}

/* Distance along a ray from (x0,z0) in direction (dx,dz) (unit) to the
 * first wall, capped at maxDist. */
export function rayWallDistance(level, x0, z0, dx, dz, maxDist) {
  let cx = Math.floor(x0 / CELL), cy = Math.floor(z0 / CELL);
  const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaY = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tMaxX = dx !== 0 ? (((dx > 0 ? (cx + 1) * CELL : cx * CELL) - x0) / dx) : Infinity;
  let tMaxY = dz !== 0 ? (((dz > 0 ? (cy + 1) * CELL : cy * CELL) - z0) / dz) : Infinity;
  if (isSolid(level, cx, cy)) return 0;
  for (let i = 0; i < 400; i++) {
    let t;
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; } else { t = tMaxY; tMaxY += tDeltaY; cy += stepY; }
    if (t > maxDist) return maxDist;
    if (isSolid(level, cx, cy)) return t;
  }
  return maxDist;
}

/* Breadth-first distance field from a target cell over walkable cells.
 * Enemies descend it to reach the player without any per-enemy pathfinding. */
export function computeFlowField(level, tx, ty, out) {
  const n = level.w * level.h;
  const dist = out || new Int16Array(n);
  dist.fill(-1);
  if (isSolid(level, tx, ty)) return dist;
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const startIdx = ty * level.w + tx;
  dist[startIdx] = 0;
  queue[tail++] = startIdx;
  const w = level.w;
  while (head < tail) {
    const idx = queue[head++];
    const cx = idx % w, cy = (idx - cx) / w;
    const d = dist[idx] + 1;
    // 4-neighbourhood only: diagonal steps are decided at move time.
    if (!isSolid(level, cx + 1, cy) && dist[idx + 1] < 0) { dist[idx + 1] = d; queue[tail++] = idx + 1; }
    if (!isSolid(level, cx - 1, cy) && dist[idx - 1] < 0) { dist[idx - 1] = d; queue[tail++] = idx - 1; }
    if (!isSolid(level, cx, cy + 1) && dist[idx + w] < 0) { dist[idx + w] = d; queue[tail++] = idx + w; }
    if (!isSolid(level, cx, cy - 1) && dist[idx - w] < 0) { dist[idx - w] = d; queue[tail++] = idx - w; }
  }
  return dist;
}

/* Pick the neighbouring cell (8-way, no corner cutting) with the lowest
 * flow distance. Returns null when the target is unreachable. */
export function flowStep(level, dist, cx, cy) {
  const w = level.w;
  const here = dist[cy * w + cx];
  if (here < 0) return null;
  let best = null, bestD = here;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = cx + ox, ny = cy + oy;
      if (isSolid(level, nx, ny)) continue;
      if (ox && oy && (isSolid(level, cx + ox, cy) || isSolid(level, cx, cy + oy))) continue;
      const d = dist[ny * w + nx];
      if (d >= 0 && d < bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
  }
  return best;
}

// Level table for Space Invaders 3D.
//
// All 100 levels are generated from a handful of curves so the game ramps
// smoothly: more rows/columns, faster formations, denser enemy fire, fewer
// shields, tougher invader types, and a boss saucer every 10th level.
// Every 10 levels is a "sector" with its own name and colour palette, and
// the point multiplier equals the sector number (1x .. 10x).

export const MAX_LEVEL = 100;

export const SECTORS = [
  { name: 'OUTER RIM',      hue: 200, invaders: ['#7df9ff', '#57ff9a', '#ffd166'] },
  { name: 'ASTEROID BELT',  hue: 30,  invaders: ['#ffb347', '#ff7f50', '#ffe680'] },
  { name: 'ION NEBULA',     hue: 280, invaders: ['#c77dff', '#ff6ec7', '#9bf6ff'] },
  { name: 'DARK MATTER',    hue: 240, invaders: ['#8ecae6', '#219ebc', '#ffb703'] },
  { name: 'PLASMA STORM',   hue: 340, invaders: ['#ff5d8f', '#ff9e00', '#fdfcdc'] },
  { name: 'CRYSTAL VOID',   hue: 170, invaders: ['#80ffdb', '#48bfe3', '#e0aaff'] },
  { name: 'RED GIANT',      hue: 5,   invaders: ['#ff4d4d', '#ff9f1c', '#ffe066'] },
  { name: 'EVENT HORIZON',  hue: 260, invaders: ['#b8b8ff', '#9381ff', '#f8f7ff'] },
  { name: 'HIVE WORLDS',    hue: 90,  invaders: ['#b5e48c', '#76c893', '#f9c74f'] },
  { name: 'MOTHERSHIP',     hue: 320, invaders: ['#ff70a6', '#ff9770', '#ffd670'] },
];

// Points per invader type before the sector multiplier is applied.
export const POINTS = { A: 30, B: 20, C: 10, D: 40, E: 60 };
export const UFO_POINTS = [50, 100, 150, 300];
export const BOSS_POINTS = 1000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function sectorOf(level) {
  return clamp(Math.floor((level - 1) / 10), 0, SECTORS.length - 1);
}

// Which invader type sits in row r (0 = top) of a formation with `rows` rows.
function rowType(r, rows, tier) {
  if (r === 0) {
    if (tier >= 7) return 'E';   // phantom: 3 hits
    if (tier >= 3) return 'D';   // armoured: 2 hits
    return 'A';
  }
  if (r === rows - 1 || r === rows - 2) return 'C';
  if (r === 1 && rows >= 5) return 'A';
  return 'B';
}

export function levelConfig(n) {
  n = clamp(Math.round(n), 1, MAX_LEVEL);
  const tier = sectorOf(n);          // 0..9
  const sector = SECTORS[tier];
  const boss = n % 10 === 0;

  const rows = boss ? Math.min(2, 1 + Math.floor(tier / 3)) : clamp(3 + Math.floor((n - 1) / 10), 3, 6);
  const cols = boss ? 6 : clamp(6 + Math.floor((n - 1) / 15), 6, 9);

  const rowTypes = [];
  for (let r = 0; r < rows; r++) rowTypes.push(boss ? (r === 0 ? 'B' : 'C') : rowType(r, rows, tier));

  return {
    level: n,
    tier,
    multiplier: tier + 1,
    sector: sector.name,
    hue: sector.hue,
    colors: sector.invaders,
    boss,
    rows,
    cols,
    rowTypes,
    // Formation horizontal speed in world units per second (before rage bonus).
    speed: 1.4 + n * 0.06,
    // How far the formation drops each time it touches a side.
    stepDown: 0.55 + n * 0.012,
    // Average seconds between enemy shots.
    fireInterval: Math.max(0.14, 1.15 - n * 0.0095),
    maxEnemyBullets: 1 + Math.floor(n / 12),
    bulletSpeed: 7 + n * 0.09,
    shields: n <= 40 ? 4 : n <= 70 ? 3 : n <= 90 ? 2 : 1,
    // Mystery saucer cadence (seconds between crossings, min..max).
    ufoInterval: [Math.max(8, 16 - n * 0.06), Math.max(14, 28 - n * 0.1)],
    ufoSpeed: 6 + n * 0.05,
    bossHp: boss ? 20 + (tier + 1) * 12 : 0,
    bossFireInterval: boss ? Math.max(0.35, 1.5 - tier * 0.11) : 0,
    bossSpeed: boss ? 3 + tier * 0.5 : 0,
    clearBonus: n * 100,
  };
}

export function allLevels() {
  const out = [];
  for (let i = 1; i <= MAX_LEVEL; i++) out.push(levelConfig(i));
  return out;
}

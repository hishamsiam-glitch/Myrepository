// Space Invaders 3D - main game module.
//
// Three.js scene + arcade state machine. See README.md for the controls and
// levels.js for how the 100 levels are generated.

import * as THREE from './vendor/three.module.js';
import { levelConfig, MAX_LEVEL, POINTS, UFO_POINTS, BOSS_POINTS } from './levels.js';
import * as Scores from './scores.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

// ---------------------------------------------------------------------------
// World constants
// ---------------------------------------------------------------------------
const PLAY_HALF_WIDTH = 10;       // playfield edge; the ship can reach ±9
const PLAYER_X_LIMIT = 9;
const PLAYER_Z = 10;
const PLAYER_Z_MIN = 8.6;
const PLAYER_Z_MAX = 11.6;
const SHIELD_Z = 6.2;
const FORMATION_START_Z = -15;
const INVASION_Z = 7.4;           // formation reaching this depth = invaded
const COL_SPACING = 1.7;
const ROW_SPACING = 1.45;
const INVADER_HP = { A: 1, B: 1, C: 1, D: 2, E: 3 };
const PLAYER_SPEED = 13;          // units / s at full tilt
const PLAYER_DEPTH_SPEED = 5;
const PLAYER_BULLET_SPEED = 30;
const PLAYER_FIRE_COOLDOWN = 0.22;
const EXTRA_LIFE_FIRST = 20000;
const EXTRA_LIFE_EVERY = 50000;
const START_LIVES = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Voxel invader sprites (classic silhouettes), extruded into 3D slabs
// ---------------------------------------------------------------------------
const PATTERNS = {
  A: [ // squid
    '...XX...',
    '..XXXX..',
    '.XXXXXX.',
    'XX.XX.XX',
    'XXXXXXXX',
    '..X..X..',
    '.X.XX.X.',
    'X.X..X.X',
  ],
  B: [ // crab
    '..X.....X..',
    '...X...X...',
    '..XXXXXXX..',
    '.XX.XXX.XX.',
    'XXXXXXXXXXX',
    'X.XXXXXXX.X',
    'X.X.....X.X',
    '...XX.XX...',
  ],
  C: [ // octopus
    '....XXXX....',
    '.XXXXXXXXXX.',
    'XXXXXXXXXXXX',
    'XXX..XX..XXX',
    'XXXXXXXXXXXX',
    '...XX..XX...',
    '..XX.XX.XX..',
    'XX........XX',
  ],
  D: [ // armoured dreadnought
    'X..XXXXXX..X',
    'XX.XXXXXX.XX',
    'XXXXXXXXXXXX',
    'XXX.XXXX.XXX',
    'XXXXXXXXXXXX',
    '.XXXXXXXXXX.',
    '..XX.XX.XX..',
    '.X........X.',
  ],
  E: [ // phantom
    '....X..X....',
    '...XXXXXX...',
    '..XXXXXXXX..',
    '.XX.XXXX.XX.',
    'XXXXXXXXXXXX',
    'X.XXXXXXXX.X',
    'X.X.X..X.X.X',
    '...X....X...',
  ],
};

// Merge a list of axis-aligned boxes into a single non-indexed geometry so
// each invader is one draw call.
function mergeBoxes(boxes) {
  const positions = [];
  const normals = [];
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      positions.push(p[i] + b.x, p[i + 1] + b.y, p[i + 2] + b.z);
      normals.push(n[i], n[i + 1], n[i + 2]);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.computeBoundingSphere();
  return geo;
}

function voxelGeometry(pattern, size, height) {
  const rows = pattern.length;
  const cols = pattern[0].length;
  const boxes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pattern[r][c] !== 'X') continue;
      boxes.push({ w: size, h: height, d: size, x: (c - (cols - 1) / 2) * size, y: 0, z: (r - (rows - 1) / 2) * size });
    }
  }
  return mergeBoxes(boxes);
}

const INVADER_GEO = {};
for (const k of Object.keys(PATTERNS)) INVADER_GEO[k] = voxelGeometry(PATTERNS[k], 0.125, 0.34);
const INVADER_TILT = 0.55;   // lift the far edge so the slabs face the camera

const PLAYER_GEO = mergeBoxes([
  { w: 0.55, h: 0.4, d: 1.7, x: 0, y: 0, z: 0 },
  { w: 2.4, h: 0.14, d: 0.8, x: 0, y: -0.06, z: 0.35 },
  { w: 0.36, h: 0.3, d: 0.5, x: 0, y: 0.3, z: -0.15 },
  { w: 0.3, h: 0.3, d: 0.6, x: 0.8, y: 0.05, z: 0.55 },
  { w: 0.3, h: 0.3, d: 0.6, x: -0.8, y: 0.05, z: 0.55 },
  { w: 0.12, h: 0.12, d: 0.7, x: 0, y: 0.1, z: -1.05 },
]);
const PLAYER_BULLET_GEO = new THREE.BoxGeometry(0.14, 0.14, 1.0);
const ENEMY_BULLET_GEO = new THREE.BoxGeometry(0.18, 0.18, 0.7);
const SHIELD_CUBE = 0.42;
const SHIELD_GEO = new THREE.BoxGeometry(SHIELD_CUBE, SHIELD_CUBE, SHIELD_CUBE);

// ---------------------------------------------------------------------------
// Particles (one InstancedMesh for every explosion)
// ---------------------------------------------------------------------------
class Particles {
  constructor(scene, n = 360) {
    this.n = n;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.mesh.frustumCulled = false;
    this.p = [];
    this.dummy = new THREE.Object3D();
    this.cursor = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) {
      this.p.push({ life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, rx: 0, ry: 0 });
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, new THREE.Color(0xffffff));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this._c = new THREE.Color();
  }

  burst(x, y, z, color, count = 18, speed = 7, size = 1) {
    this._c.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const q = this.p[i];
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(-1, 1));
      const s = speed * rand(0.25, 1);
      q.x = x; q.y = y; q.z = z;
      q.vx = Math.sin(ph) * Math.cos(th) * s;
      q.vy = Math.abs(Math.cos(ph)) * s * 0.8 + 1;
      q.vz = Math.sin(ph) * Math.sin(th) * s;
      q.maxLife = q.life = rand(0.5, 1.0);
      q.size = size * rand(0.5, 1.4);
      q.rx = rand(0, 6); q.ry = rand(0, 6);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const q = this.p[i];
      if (q.life <= 0) continue;
      any = true;
      q.life -= dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.vy -= 6 * dt;
      q.rx += dt * 4; q.ry += dt * 3;
      const s = q.life <= 0 ? 0 : q.size * clamp(q.life / q.maxLife, 0, 1);
      this.dummy.position.set(q.x, q.y, q.z);
      this.dummy.rotation.set(q.rx, q.ry, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Formation of invaders
// ---------------------------------------------------------------------------
class Formation {
  constructor(game, cfg, materials) {
    this.game = game;
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.invaders = [];
    this.dir = 1;
    this.offsetX = 0;
    this.offsetZ = 0;
    this.hopT = 1;
    this.marchAccum = 0;
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        const type = cfg.rowTypes[r];
        const mesh = new THREE.Mesh(INVADER_GEO[type], materials[type]);
        const inv = {
          mesh, type, row: r, col: c,
          hp: INVADER_HP[type],
          localX: (c - (cfg.cols - 1) / 2) * COL_SPACING,
          localZ: FORMATION_START_Z + r * ROW_SPACING,
          alive: true,
          phase: Math.random() * Math.PI * 2,
          flash: 0,
        };
        mesh.position.set(inv.localX, 0, inv.localZ);
        mesh.rotation.x = INVADER_TILT;
        this.group.add(mesh);
        this.invaders.push(inv);
      }
    }
    this.total = this.invaders.length;
    this.alive = this.total;
    game.scene.add(this.group);
    this.place(0);
  }

  worldX(inv) { return inv.localX + this.offsetX; }
  worldZ(inv) { return inv.localZ + this.offsetZ; }

  place(t) {
    const hop = this.hopT < 0.28 ? 0.35 * Math.sin((this.hopT / 0.28) * Math.PI) : 0;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const m = inv.mesh;
      m.position.set(inv.localX + this.offsetX, hop + 0.06 * Math.sin(t * 3 + inv.phase), inv.localZ + this.offsetZ);
      m.rotation.y = 0.1 * Math.sin(t * 2 + inv.phase);
      m.rotation.x = INVADER_TILT + hop * 0.5;
      if (inv.flash > 0) {
        const s = 1 + inv.flash * 0.6;
        m.scale.set(s, s, s);
      } else if (m.scale.x !== 1) {
        m.scale.set(1, 1, 1);
      }
    }
  }

  update(dt, t, frozen) {
    this.hopT += dt;
    for (const inv of this.invaders) if (inv.flash > 0) inv.flash = Math.max(0, inv.flash - dt * 6);
    if (!frozen && this.alive > 0) {
      const frac = this.alive / this.total;
      const rage = 1 + 2.4 * (1 - frac);
      const speed = Math.min(this.cfg.speed * rage, 17);
      let minLX = Infinity, maxLX = -Infinity;
      for (const inv of this.invaders) {
        if (!inv.alive) continue;
        if (inv.localX < minLX) minLX = inv.localX;
        if (inv.localX > maxLX) maxLX = inv.localX;
      }
      this.offsetX += this.dir * speed * dt;
      const limit = PLAY_HALF_WIDTH - 0.9;
      if (this.dir > 0 && maxLX + this.offsetX > limit) {
        this.offsetX = limit - maxLX;
        this.dir = -1;
        this.offsetZ += this.cfg.stepDown;
        this.hopT = 0;
      } else if (this.dir < 0 && minLX + this.offsetX < -limit) {
        this.offsetX = -limit - minLX;
        this.dir = 1;
        this.offsetZ += this.cfg.stepDown;
        this.hopT = 0;
      }
      this.marchAccum += speed * dt;
      if (this.marchAccum > 2.4) {
        this.marchAccum = 0;
        this.hopT = 0;
        this.game.sfx.march();
      }
    }
    this.place(t);
  }

  frontZ() {
    let z = -Infinity;
    for (const inv of this.invaders) if (inv.alive) z = Math.max(z, inv.localZ);
    return z + this.offsetZ;
  }

  // Lowest living invader in each column (the ones allowed to shoot).
  shooters() {
    const byCol = new Map();
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const cur = byCol.get(inv.col);
      if (!cur || inv.row > cur.row) byCol.set(inv.col, inv);
    }
    return [...byCol.values()];
  }

  // Returns true when the invader is destroyed.
  damage(inv, amount = 1) {
    inv.hp -= amount;
    if (inv.hp > 0) { inv.flash = 1; return false; }
    inv.alive = false;
    this.group.remove(inv.mesh);
    this.alive--;
    return true;
  }

  dispose() {
    this.game.scene.remove(this.group);
  }
}

// ---------------------------------------------------------------------------
// Shields: 4 blocks of cubes in one InstancedMesh
// ---------------------------------------------------------------------------
class Shields {
  constructor(game, count) {
    this.game = game;
    this.cubes = [];
    const cols = 6, rows = 3;
    const per = cols * rows;
    this.mesh = new THREE.InstancedMesh(SHIELD_GEO, new THREE.MeshLambertMaterial({ color: 0x3df26a, emissive: 0x0f5a24 }), Math.max(1, count * per));
    this.mesh.frustumCulled = false;
    this.dummy = new THREE.Object3D();
    const spread = count > 1 ? 14 / (count - 1) : 0;
    let i = 0;
    for (let s = 0; s < count; s++) {
      const cx = count > 1 ? -7 + s * spread : 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Notch out the middle of the back row like the classic arcade shape.
          if (r === rows - 1 && (c === 2 || c === 3)) continue;
          const x = cx + (c - (cols - 1) / 2) * SHIELD_CUBE;
          const z = SHIELD_Z + (r - (rows - 1) / 2) * SHIELD_CUBE;
          this.cubes.push({ x, z, alive: true, idx: i });
          this.dummy.position.set(x, 0, z);
          this.dummy.scale.setScalar(1);
          this.dummy.updateMatrix();
          this.mesh.setMatrixAt(i, this.dummy.matrix);
          i++;
        }
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    game.scene.add(this.mesh);
  }

  // Destroys the first cube overlapping (x, z); returns it or null.
  hitAt(x, z, radius = 0.3) {
    for (const c of this.cubes) {
      if (!c.alive) continue;
      if (Math.abs(c.x - x) < SHIELD_CUBE / 2 + radius && Math.abs(c.z - z) < SHIELD_CUBE / 2 + radius) {
        this.kill(c);
        return c;
      }
    }
    return null;
  }

  kill(c) {
    c.alive = false;
    this.dummy.position.set(c.x, 0, c.z);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(c.idx, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// Boss saucer (every 10th level)
// ---------------------------------------------------------------------------
class Boss {
  constructor(game, cfg, color) {
    this.game = game;
    this.cfg = cfg;
    this.hp = cfg.bossHp;
    this.maxHp = cfg.bossHp;
    this.dead = false;
    this.t = Math.random() * 10;
    this.fireTimer = 1.2;
    this.flash = 0;
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 0.7, 24), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 }));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x88aaff, emissiveIntensity: 0.4, transparent: true, opacity: 0.85 }));
    dome.position.y = 0.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.16, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff2266 }));
    ring.rotation.x = Math.PI / 2;
    this.ring = ring;
    this.group.add(body, dome, ring);
    this.group.position.set(0, 0.6, -11);
    game.scene.add(this.group);
    this.x = 0; this.z = -11;
  }

  update(dt, frozen) {
    if (this.dead) return;
    this.t += dt;
    if (!frozen) {
      const progress = 1 - this.hp / this.maxHp;
      this.x = Math.sin(this.t * (0.35 + this.cfg.bossSpeed * 0.08)) * 6.5;
      this.z = -11 + Math.sin(this.t * 0.6) * 1.5 + progress * 2.5;
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = this.cfg.bossFireInterval * rand(0.7, 1.2);
        const n = 3 + Math.floor(this.cfg.tier / 3);
        for (let i = 0; i < n; i++) {
          const spread = ((i / (n - 1)) - 0.5) * 6;
          this.game.spawnEnemyBullet(this.x + spread * 0.35, this.z + 1.5, spread, this.cfg.bulletSpeed * 0.9);
        }
        this.game.sfx.enemyShoot();
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    this.group.position.set(this.x, 0.6 + Math.sin(this.t * 2) * 0.2, this.z);
    this.group.rotation.y += dt * 0.8;
    this.ring.material.color.setHSL(0.95, 1, 0.5 + this.flash * 0.4);
  }

  damage(amount = 1) {
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) { this.dead = true; this.game.scene.remove(this.group); return true; }
    return false;
  }

  dispose() { this.game.scene.remove(this.group); }
}

// ---------------------------------------------------------------------------
// Mystery saucer
// ---------------------------------------------------------------------------
class Ufo {
  constructor(game, speed) {
    this.game = game;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.x = -this.dir * 16;
    this.z = -18;
    this.speed = speed;
    this.dead = false;
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 0.35, 16), new THREE.MeshLambertMaterial({ color: 0xff3366, emissive: 0xff3366, emissiveIntensity: 0.5 }));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffe680, emissiveIntensity: 0.5 }));
    dome.position.y = 0.15;
    this.group.add(body, dome);
    this.group.position.set(this.x, 0.8, this.z);
    game.scene.add(this.group);
    game.sfx.ufoStart();
  }
  update(dt) {
    this.x += this.dir * this.speed * dt;
    this.group.position.x = this.x;
    this.group.rotation.y += dt * 3;
    if (Math.abs(this.x) > 17) this.remove();
  }
  remove() {
    if (this.dead) return;
    this.dead = true;
    this.game.scene.remove(this.group);
    this.game.sfx.ufoStop();
  }
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = Scores.getSettings();
    this.input = new Input(this.settings);
    this.sfx = new Sfx();
    this.sfx.enabled = this.settings.sound;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020109);
    this.scene.fog = new THREE.Fog(0x020109, 40, 80);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    this.camBase = new THREE.Vector3(0, 12, 25);
    this.camTarget = new THREE.Vector3(0, 0, -1.5);
    this.shake = 0;

    this.hemi = new THREE.HemisphereLight(0x8ab4ff, 0x1a0a2e, 0.9);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.1);
    this.sun.position.set(6, 14, 8);
    this.scene.add(this.hemi, this.sun, new THREE.AmbientLight(0x404060, 0.5));

    this.grid = new THREE.GridHelper(120, 60, 0x22114f, 0x22114f);
    this.grid.position.y = -3;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.35;
    this.scene.add(this.grid);

    this.stars = this._makeStars();
    this.scene.add(this.stars);

    this.particles = new Particles(this.scene);

    // Player
    this.playerMat = new THREE.MeshLambertMaterial({ color: 0x5ff5ff, emissive: 0x0b6f8a, emissiveIntensity: 0.6 });
    this.player = new THREE.Mesh(PLAYER_GEO, this.playerMat);
    this.player.position.set(0, 0, PLAYER_Z);
    this.flame = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.7), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
    this.flame.position.set(0, 0, 1.2);
    this.player.add(this.flame);
    this.scene.add(this.player);

    this.playerBulletMat = new THREE.MeshBasicMaterial({ color: 0xaaffff });
    this.enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });

    this.state = 'title';
    this.attract = true;
    this.formation = null;
    this.shields = null;
    this.boss = null;
    this.ufo = null;
    this.playerBullets = [];
    this.enemyBullets = [];
    this.time = 0;
    this.stateTimer = 0;

    this._ui();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    if (screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', () => { this._resize(); this.input.calibrate(); });
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });

    this.input.attachTouch(this.dom.touch);
    this._startAttract();
    this.showScreen('title');
    this._last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---- scene helpers ---------------------------------------------------

  _makeStars() {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-60, 60);
      pos[i * 3 + 1] = rand(-30, 6);
      pos[i * 3 + 2] = rand(-80, 25);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.9 });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const t = clamp((1.25 - aspect) / 0.75, 0, 1);   // 0 = landscape, 1 = portrait
    this.camBase.set(0, 12 + 9 * t, 25 - 4 * t);
    this.camTarget.set(0, 0, -1.5 - 0.5 * t);
    const dist = this.camBase.distanceTo(new THREE.Vector3(0, 0, PLAYER_Z));
    const hHalf = Math.atan((PLAY_HALF_WIDTH + 0.6) / dist);
    const vHalf = Math.atan(Math.tan(hHalf) / aspect);
    this.camera.fov = clamp(THREE.MathUtils.radToDeg(vHalf * 2), 46, 100);
    this.camera.updateProjectionMatrix();
  }

  _applySector(cfg) {
    const hue = cfg.hue / 360;
    // Colours are linear here and the renderer outputs sRGB, so keep the
    // lightness tiny to get a genuinely dark sky.
    this.scene.background.setHSL(hue, 0.55, 0.007);
    this.scene.fog.color.copy(this.scene.background);
    this.hemi.color.setHSL(hue, 0.5, 0.7);
    this.grid.material.color.setHSL(hue, 0.8, 0.3);
    if (this.materials) for (const m of Object.values(this.materials)) m.dispose();
    this.materials = {};
    const c = cfg.colors;
    const pick = { A: c[0], B: c[1], C: c[2], D: c[0], E: c[1] };
    for (const k of Object.keys(pick)) {
      const col = new THREE.Color(pick[k]);
      this.materials[k] = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 });
    }
  }

  // ---- entity management ------------------------------------------------

  _clearEntities() {
    if (this.formation) { this.formation.dispose(); this.formation = null; }
    if (this.shields) { this.shields.dispose(); this.shields = null; }
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    if (this.ufo) { this.ufo.remove(); this.ufo = null; }
    for (const b of this.playerBullets) this.scene.remove(b.mesh);
    for (const b of this.enemyBullets) this.scene.remove(b.mesh);
    this.playerBullets = [];
    this.enemyBullets = [];
  }

  _startAttract() {
    this.attract = true;
    this._clearEntities();
    const cfg = levelConfig(1 + Math.floor(Math.random() * 30));
    this.cfg = cfg;
    this._applySector(cfg);
    this.formation = new Formation(this, cfg, this.materials);
    this.formation.offsetZ = 4;
    this.player.visible = false;
  }

  spawnPlayerBullet() {
    const mesh = new THREE.Mesh(PLAYER_BULLET_GEO, this.playerBulletMat);
    mesh.position.set(this.player.position.x, 0.1, this.player.position.z - 1.2);
    this.scene.add(mesh);
    this.playerBullets.push({ mesh, x: mesh.position.x, z: mesh.position.z });
    this.sfx.shoot();
  }

  spawnEnemyBullet(x, z, vx = 0, speed = 8) {
    const mesh = new THREE.Mesh(ENEMY_BULLET_GEO, this.enemyBulletMat);
    mesh.position.set(x, 0.1, z);
    this.scene.add(mesh);
    this.enemyBullets.push({ mesh, x, z, vx, vz: speed, spin: rand(0, 6) });
  }

  // ---- game flow --------------------------------------------------------

  startGame(level = 1) {
    this.attract = false;
    this.score = 0;
    this.lives = START_LIVES;
    this.kills = 0;
    this.startLevel = level;
    this.nextExtraLife = EXTRA_LIFE_FIRST;
    this.gameStart = performance.now();
    this.level = level;
    this.hiScore = Scores.getTopScore();
    this.player.visible = true;
    this.player.position.set(0, 0, PLAYER_Z);
    this.invuln = 0;
    this.hideScreens();
    this.loadLevel(level);
    this.sfx.coin();
  }

  loadLevel(n) {
    this._clearEntities();
    this.level = n;
    const cfg = levelConfig(n);
    this.cfg = cfg;
    this._applySector(cfg);
    this.formation = new Formation(this, cfg, this.materials);
    this.shields = cfg.shields > 0 ? new Shields(this, cfg.shields) : null;
    this.boss = cfg.boss ? new Boss(this, cfg, cfg.colors[0]) : null;
    this.ufo = null;
    this.ufoTimer = rand(cfg.ufoInterval[0], cfg.ufoInterval[1]);
    this.enemyFireTimer = 1.5;
    this.fireCooldown = 0;
    this.player.position.x = clamp(this.player.position.x, -PLAYER_X_LIMIT, PLAYER_X_LIMIT);
    this.player.visible = true;
    this.invuln = 1.5;
    this.state = 'intro';
    this.stateTimer = 2.3;
    this.banner(cfg.boss ? `BOSS  ${String(n).padStart(3, '0')}` : `LEVEL ${String(n).padStart(3, '0')}`, `${cfg.sector}  ·  x${cfg.multiplier} POINTS`);
    Scores.setBestLevel(n);
    this.updateHud(true);
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'intro') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.sfx.ufoStop();
    this.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState || 'playing';
    this.hideScreens();
    this.input.clearEdges();
    if (this.ufo) this.sfx.ufoStart();
    this._last = performance.now();
  }

  quitToTitle() {
    if (!this.attract && this.state !== 'title' && this.score > 0) this._recordGame('QUIT');
    this.sfx.ufoStop();
    this._startAttract();
    this.state = 'title';
    this.showScreen('title');
  }

  addScore(pts, worldPos) {
    this.score += pts;
    if (this.score > this.hiScore) this.hiScore = this.score;
    if (this.score >= this.nextExtraLife) {
      this.lives++;
      this.nextExtraLife += EXTRA_LIFE_EVERY;
      this.sfx.extraLife();
      this.banner('EXTRA LIFE', '', 1.2);
    }
    if (worldPos) this.popup(worldPos, `+${pts}`);
  }

  onPlayerHit() {
    if (this.invuln > 0 || this.state !== 'playing') return;
    this.state = 'dying';
    this.stateTimer = 1.6;
    this.particles.burst(this.player.position.x, 0.2, this.player.position.z, 0x5ff5ff, 40, 9, 1.3);
    this.particles.burst(this.player.position.x, 0.2, this.player.position.z, 0xffa040, 20, 6, 1);
    this.player.visible = false;
    this.shake = 0.6;
    this.sfx.playerDie();
    for (const b of this.enemyBullets) this.scene.remove(b.mesh);
    this.enemyBullets = [];
  }

  onInvaded() {
    if (this.attract) { this._startAttract(); return; }
    if (this.state !== 'playing' && this.state !== 'intro') return;
    this.lives = 0;
    this.state = 'gameover';
    this.stateTimer = 3;
    this.player.visible = false;
    this.particles.burst(this.player.position.x, 0.2, this.player.position.z, 0xff4444, 40, 9, 1.3);
    this.sfx.ufoStop();
    this.sfx.gameOver();
    this.banner('INVADED', 'GAME OVER');
  }

  _recordGame(result) {
    const seconds = Math.round((performance.now() - this.gameStart) / 1000);
    Scores.logGame({ score: this.score, level: this.level, kills: this.kills, seconds, result, control: this.input.controlName });
  }

  _endGame(result) {
    this._recordGame(result);
    this.sfx.ufoStop();
    const rank = Scores.qualifyingRank(this.score);
    this.finalScore = this.score;
    this.finalLevel = this.level;
    this._startAttract();
    if (rank) this.showNameEntry(rank);
    else { this.state = 'title'; this.showScores(); }
  }

  // ---- main loop --------------------------------------------------------

  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;
    if (this.state === 'paused') { this._render(0); return; }
    this.time += dt;
    this.input.update(dt);
    this.update(dt);
    this._render(dt);
  }

  update(dt) {
    const t = this.time;
    const cfg = this.cfg;
    const s = this.state;

    // Background drift
    this.grid.position.z = (this.grid.position.z + dt * 2.2) % 2;
    const sp = this.stars.geometry.attributes.position;
    for (let i = 2; i < sp.array.length; i += 3) {
      sp.array[i] += dt * 2.5;
      if (sp.array[i] > 25) sp.array[i] -= 105;
    }
    sp.needsUpdate = true;
    this.particles.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);

    if (this.attract) {
      if (this.formation) this.formation.update(dt, t, false);
      if (this.formation && this.formation.frontZ() >= INVASION_Z) this.onInvaded();
      return;
    }

    // Timed states
    if (s === 'intro') {
      this.stateTimer -= dt;
      this.formation.update(dt, t, true);
      if (this.boss) this.boss.update(dt, true);
      this._updatePlayer(dt, false);
      if (this.stateTimer <= 0) { this.state = 'playing'; this.input.clearEdges(); }
      return;
    }
    if (s === 'dying') {
      this.stateTimer -= dt;
      this.formation.update(dt, t, true);
      if (this.boss) this.boss.update(dt, true);
      if (this.ufo) this._updateUfo(dt);
      if (this.stateTimer <= 0) {
        this.lives--;
        if (this.lives < 0) {
          this.state = 'gameover';
          this.stateTimer = 3;
          this.sfx.gameOver();
          this.banner('GAME OVER', `FINAL SCORE ${Scores.formatScore(this.score)}`);
        } else {
          this.player.position.x = 0;
          this.player.position.z = PLAYER_Z;
          this.player.visible = true;
          this.invuln = 2.2;
          this.state = 'playing';
          this.input.clearEdges();
        }
        this.updateHud(true);
      }
      return;
    }
    if (s === 'gameover') {
      this.stateTimer -= dt;
      if (this.formation) this.formation.update(dt, t, true);
      if (this.stateTimer <= 0) this._endGame('GAME OVER');
      return;
    }
    if (s === 'clear') {
      this.stateTimer -= dt;
      this._updatePlayer(dt, false);
      this._updateBullets(dt);
      if (this.stateTimer <= 0) {
        if (this.level >= MAX_LEVEL) {
          this.state = 'victory';
          this.stateTimer = 4;
          this.banner('GALAXY SAVED', `ALL ${MAX_LEVEL} LEVELS CLEARED`);
          this.sfx.levelClear();
          this.player.visible = false;
          this.particles.burst(0, 1, 0, 0xffe066, 120, 12, 1.5);
        } else {
          this.loadLevel(this.level + 1);
        }
      }
      return;
    }
    if (s === 'victory') {
      this.stateTimer -= dt;
      if (Math.random() < dt * 3) this.particles.burst(rand(-8, 8), 1, rand(-10, 8), [0xffe066, 0x5ff5ff, 0xff70a6][Math.floor(rand(0, 3))], 30, 8, 1.2);
      if (this.stateTimer <= 0) this._endGame('VICTORY');
      return;
    }
    if (s !== 'playing') return;

    // ---- playing ----
    if (this.input.consumePause()) { this.pause(); return; }

    this._updatePlayer(dt, true);
    this.formation.update(dt, t, false);
    if (this.boss) this.boss.update(dt, false);

    // Enemy fire
    this.enemyFireTimer -= dt;
    if (this.enemyFireTimer <= 0) {
      this.enemyFireTimer = cfg.fireInterval * rand(0.6, 1.4);
      if (this.enemyBullets.length < cfg.maxEnemyBullets) {
        const shooters = this.formation.shooters();
        if (shooters.length) {
          const inv = shooters[Math.floor(Math.random() * shooters.length)];
          // Later sectors aim a little toward the player.
          const aim = cfg.tier >= 4 && Math.random() < 0.35 ? clamp((this.player.position.x - this.formation.worldX(inv)) * 0.25, -3, 3) : 0;
          this.spawnEnemyBullet(this.formation.worldX(inv), this.formation.worldZ(inv) + 0.8, aim, cfg.bulletSpeed);
          this.sfx.enemyShoot();
        }
      }
    }

    // UFO
    if (!cfg.boss) {
      if (this.ufo) this._updateUfo(dt);
      else {
        this.ufoTimer -= dt;
        if (this.ufoTimer <= 0 && this.formation.alive > 3) {
          this.ufo = new Ufo(this, cfg.ufoSpeed);
          this.ufoTimer = rand(cfg.ufoInterval[0], cfg.ufoInterval[1]);
        }
      }
    }

    this._updateBullets(dt);

    // Invaders grind through shields as they pass
    if (this.shields) {
      const fz = this.formation.frontZ();
      if (fz > SHIELD_Z - 1.2) {
        for (const inv of this.formation.invaders) {
          if (!inv.alive) continue;
          const z = this.formation.worldZ(inv);
          if (z < SHIELD_Z - 1.2) continue;
          const x = this.formation.worldX(inv);
          let c;
          while ((c = this.shields.hitAt(x, z, 0.6))) this.particles.burst(c.x, 0, c.z, 0x3df26a, 3, 3, 0.6);
        }
      }
    }

    // Invasion
    if (this.formation.frontZ() >= INVASION_Z) { this.onInvaded(); return; }

    // Level clear
    if (this.formation.alive === 0 && (!this.boss || this.boss.dead)) {
      this.state = 'clear';
      this.stateTimer = 2.4;
      const bonus = cfg.clearBonus + this.lives * 50 * cfg.multiplier;
      this.addScore(bonus);
      if (this.ufo) { this.ufo.remove(); this.ufo = null; }
      this.sfx.levelClear();
      this.banner(cfg.boss ? 'BOSS DESTROYED' : 'SECTOR CLEAR', `BONUS +${bonus}`);
      this.updateHud(true);
    }

    this.updateHud(false);
  }

  _updatePlayer(dt, canFire) {
    if (this.invuln > 0) this.invuln -= dt;
    const p = this.player.position;
    const tilt = this.input.tilt;
    p.x = clamp(p.x + tilt * PLAYER_SPEED * dt, -PLAYER_X_LIMIT, PLAYER_X_LIMIT);
    p.z = clamp(p.z - this.input.depth * PLAYER_DEPTH_SPEED * dt, PLAYER_Z_MIN, PLAYER_Z_MAX);
    this.player.rotation.z = -tilt * 0.45;
    this.player.rotation.x = this.input.depth * 0.15;
    this.flame.scale.y = 0.7 + Math.random() * 0.6;
    this.flame.scale.z = 0.8 + Math.random() * 0.5;
    this.player.visible = this.state !== 'dying' && this.state !== 'gameover' && this.state !== 'victory' && (this.invuln <= 0 || Math.floor(this.time * 12) % 2 === 0);

    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    const tapped = this.input.consumeFire();
    if (!canFire) return;
    const wantsFire = tapped || (this.settings.autofire && this.input.fireHeld);
    if (wantsFire && this.fireCooldown <= 0 && this.playerBullets.length < (this.cfg.boss ? 3 : 2)) {
      this.spawnPlayerBullet();
      this.fireCooldown = PLAYER_FIRE_COOLDOWN;
    }
  }

  _updateUfo(dt) {
    this.ufo.update(dt);
    if (this.ufo.dead) this.ufo = null;
  }

  _updateBullets(dt) {
    const cfg = this.cfg;
    // Player bullets
    for (let i = this.playerBullets.length - 1; i >= 0; i--) {
      const b = this.playerBullets[i];
      b.z -= PLAYER_BULLET_SPEED * dt;
      b.mesh.position.z = b.z;
      let hit = false;

      if (this.shields && b.z < SHIELD_Z + 1 && b.z > SHIELD_Z - 1) {
        const c = this.shields.hitAt(b.x, b.z, 0.08);
        if (c) { hit = true; this.particles.burst(c.x, 0, c.z, 0x3df26a, 4, 3, 0.6); this.sfx.shieldHit(); }
      }
      if (!hit && this.formation) {
        const f = this.formation;
        for (const inv of f.invaders) {
          if (!inv.alive) continue;
          const ix = f.worldX(inv), iz = f.worldZ(inv);
          if (Math.abs(ix - b.x) < 0.8 && Math.abs(iz - b.z) < 0.7) {
            hit = true;
            if (f.damage(inv)) {
              this.kills++;
              this.addScore(POINTS[inv.type] * cfg.multiplier, { x: ix, y: 0.3, z: iz });
              this.particles.burst(ix, 0.2, iz, inv.mesh.material.color.getHex(), 16, 6, 0.9);
              this.sfx.hit();
            } else {
              this.particles.burst(ix, 0.2, iz, 0xffffff, 4, 3, 0.5);
              this.sfx.armourHit();
            }
            break;
          }
        }
      }
      if (!hit && this.boss && !this.boss.dead) {
        if (Math.abs(this.boss.x - b.x) < 3 && Math.abs(this.boss.z - b.z) < 1.8) {
          hit = true;
          this.particles.burst(b.x, 0.5, b.z, 0xffffff, 5, 3, 0.6);
          if (this.boss.damage(1)) {
            this.kills++;
            this.addScore(BOSS_POINTS * cfg.multiplier, { x: this.boss.x, y: 1, z: this.boss.z });
            this.particles.burst(this.boss.x, 0.6, this.boss.z, cfg.colors[0], 90, 12, 1.6);
            this.particles.burst(this.boss.x, 0.6, this.boss.z, 0xffffff, 40, 8, 1.2);
            this.shake = 0.8;
            this.sfx.bossDie();
          } else {
            this.sfx.bossHit();
          }
        }
      }
      if (!hit && this.ufo && Math.abs(this.ufo.x - b.x) < 1.3 && Math.abs(this.ufo.z - b.z) < 0.9) {
        hit = true;
        const pts = UFO_POINTS[Math.floor(Math.random() * UFO_POINTS.length)] * cfg.multiplier;
        this.kills++;
        this.addScore(pts, { x: this.ufo.x, y: 1, z: this.ufo.z });
        this.particles.burst(this.ufo.x, 0.8, this.ufo.z, 0xff3366, 30, 8, 1.1);
        this.ufo.remove();
        this.ufo = null;
        this.sfx.hit();
      }
      if (hit || b.z < -24) {
        this.scene.remove(b.mesh);
        this.playerBullets.splice(i, 1);
      }
    }

    // Enemy bullets
    const p = this.player.position;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.z += b.vz * dt;
      b.x += b.vx * dt;
      b.mesh.position.set(b.x, 0.1, b.z);
      b.mesh.rotation.z += dt * 12;
      let hit = false;
      if (this.shields && b.z > SHIELD_Z - 1 && b.z < SHIELD_Z + 1) {
        const c = this.shields.hitAt(b.x, b.z, 0.1);
        if (c) { hit = true; this.particles.burst(c.x, 0, c.z, 0x3df26a, 4, 3, 0.6); this.sfx.shieldHit(); }
      }
      if (!hit && this.state === 'playing' && this.invuln <= 0 && Math.abs(b.x - p.x) < 0.9 && Math.abs(b.z - p.z) < 0.8) {
        hit = true;
        this.scene.remove(b.mesh);
        this.enemyBullets.splice(i, 1);
        this.onPlayerHit();
        return;
      }
      if (hit || b.z > 15 || Math.abs(b.x) > 14) {
        this.scene.remove(b.mesh);
        this.enemyBullets.splice(i, 1);
      }
    }
  }

  _render(dt) {
    const px = this.attract ? 0 : this.player.position.x;
    const cam = this.camera;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.8 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.8 : 0;
    cam.position.set(this.camBase.x + px * 0.18 + sx, this.camBase.y + sy, this.camBase.z);
    cam.lookAt(this.camTarget.x + px * 0.1, this.camTarget.y, this.camTarget.z);
    this.renderer.render(this.scene, cam);
  }

  // ---- DOM / UI ---------------------------------------------------------

  _ui() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      touch: $('touch'),
      hud: $('hud'),
      score: $('hud-score'), hi: $('hud-hi'), level: $('hud-level'), lives: $('hud-lives'),
      bossBar: $('boss-bar'), bossFill: $('boss-fill'),
      btnCalib: $('btn-calib'),
      banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      popups: $('popups'),
      screens: Array.from(document.querySelectorAll('.screen')),
      titleHi: $('title-hi'),
      btnContinue: $('btn-continue'),
      sensorStatus: $('sensor-status'),
      btnSensors: $('btn-sensors'),
      hsBody: $('hs-body'),
      logBody: $('log-body'),
      logStats: $('log-stats'),
      nameRank: $('name-rank'), nameScore: $('name-score'),
      letters: [$('nl0'), $('nl1'), $('nl2')],
      setSound: $('set-sound'), setAuto: $('set-autofire'), setInvert: $('set-invert'), setFb: $('set-fb'), setSens: $('set-sens'), sensVal: $('sens-val'),
      levelTable: $('level-table'),
    };
    this._hudCache = {};
    this._bannerTimer = 0;
    this.nameLetters = [0, 0, 0];
    this.nameSlot = 0;

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      this.sfx.unlock();
      this.action(el.dataset.action, el);
    });
    // Unlock audio on the first touch on the play surface too.
    this.dom.touch.addEventListener('pointerdown', () => this.sfx.unlock(), { once: false });

    window.addEventListener('keydown', (e) => {
      if (this.state === 'nameentry') this._nameKey(e);
      else if (this.state === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); this.sfx.unlock(); this.startGame(1); }
      else if (this.state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) this.resume();
      else if ((this.state === 'scores' || this.state === 'log' || this.state === 'help' || this.state === 'settings') && (e.code === 'Escape' || e.code === 'Enter')) this.quitToTitle();
    });

    this.dom.setSens.addEventListener('input', () => {
      this.settings.sensitivity = Number(this.dom.setSens.value);
      this.dom.sensVal.textContent = this.settings.sensitivity;
      Scores.saveSettings(this.settings);
    });

    if (!this.input.sensorsSupported) {
      this.dom.btnSensors.textContent = 'TILT NOT SUPPORTED HERE';
      this.dom.btnSensors.classList.add('disabled');
    }
  }

  action(name, el) {
    switch (name) {
      case 'start': this.startGame(1); break;
      case 'continue': this.startGame(Scores.getBestLevel()); break;
      case 'scores': this.showScores(); break;
      case 'log': this.showLog(); break;
      case 'settings': this.showSettings(); break;
      case 'help': this.showHelp(); break;
      case 'back': this.quitToTitle(); break;
      case 'sensors': this.enableSensors(); break;
      case 'fullscreen': this.goFullscreen(); break;
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'calibrate': {
        const ok = this.input.calibrate();
        this.toast(ok ? 'TILT CENTRE SET' : 'NO TILT DATA YET');
        break;
      }
      case 'quit': this.quitToTitle(); break;
      case 'clear-log':
        if (confirm('Erase the high-score table and score log?')) { Scores.clearAllScores(); this.showLog(); }
        break;
      case 'toggle': this._toggleSetting(el.dataset.key, el); break;
      case 'letter': this._nameStep(Number(el.dataset.idx), Number(el.dataset.dir)); break;
      case 'name-ok': this._nameSubmit(); break;
      case 'levels': this.showLevels(); break;
      default: break;
    }
  }

  async enableSensors() {
    this.dom.sensorStatus.textContent = 'REQUESTING SENSOR ACCESS…';
    const ok = await this.input.enableSensors();
    if (ok) {
      this.input.calibrate();
      this.dom.sensorStatus.textContent = 'TILT CONTROLS ON  ·  HOLD THE PHONE FLAT AND CALIBRATE ANY TIME';
      this.dom.btnSensors.textContent = 'TILT CONTROLS: ON';
      this.dom.btnCalib.classList.remove('hidden');
    } else {
      this.dom.sensorStatus.textContent = this.input.sensorsSupported
        ? 'NO SENSOR DATA (DENIED OR NOT A PHONE). USING TOUCH DRAG / KEYS.'
        : 'THIS DEVICE HAS NO ORIENTATION SENSOR. USING TOUCH DRAG / KEYS.';
    }
  }

  goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try { req.call(el).catch(() => {}); } catch (e) { /* ignore */ }
    }
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(() => {});
  }

  showScreen(name) {
    for (const s of this.dom.screens) s.classList.toggle('hidden', s.dataset.screen !== name);
    this.dom.hud.classList.toggle('hidden', name !== null && name !== 'pause');
    this.dom.touch.classList.toggle('hidden', name !== null);
    if (name === 'title') {
      this.dom.titleHi.textContent = Scores.formatScore(Scores.getTopScore());
      const best = Scores.getBestLevel();
      this.dom.btnContinue.classList.toggle('hidden', best <= 1);
      this.dom.btnContinue.textContent = `CONTINUE  ·  LEVEL ${String(best).padStart(3, '0')}`;
    }
  }

  hideScreens() {
    this.showScreen(null);
  }

  showScores(highlightIndex = -1) {
    this.state = 'scores';
    const hs = Scores.getHighScores();
    this.dom.hsBody.innerHTML = hs.map((e, i) =>
      `<tr class="${i === highlightIndex ? 'me' : ''}"><td>${String(i + 1).padStart(2, ' ')}</td><td>${e.name}</td><td class="num">${Scores.formatScore(e.score)}</td><td class="num">${String(e.level).padStart(3, '0')}</td><td class="dim">${e.date ? Scores.formatDate(e.date).slice(0, 10) : '—'}</td></tr>`
    ).join('');
    this.showScreen('scores');
  }

  showLog() {
    this.state = 'log';
    const log = Scores.getScoreLog();
    if (log.length === 0) {
      this.dom.logBody.innerHTML = '<tr><td colspan="7" class="dim">NO GAMES PLAYED YET</td></tr>';
      this.dom.logStats.textContent = '';
    } else {
      this.dom.logBody.innerHTML = log.map((e, i) =>
        `<tr><td>${String(log.length - i).padStart(3, ' ')}</td><td class="dim">${Scores.formatDate(e.date)}</td><td class="num">${Scores.formatScore(e.score)}</td><td class="num">${String(e.level).padStart(3, '0')}</td><td class="num">${e.kills}</td><td class="num">${Scores.formatDuration(e.seconds)}</td><td class="dim">${e.result}${e.control ? ' · ' + e.control : ''}</td></tr>`
      ).join('');
      const best = log.reduce((m, e) => Math.max(m, e.score), 0);
      const bestLevel = log.reduce((m, e) => Math.max(m, e.level), 0);
      const totalKills = log.reduce((m, e) => m + e.kills, 0);
      const wins = log.filter((e) => e.result === 'VICTORY').length;
      this.dom.logStats.textContent = `GAMES ${log.length}  ·  BEST ${Scores.formatScore(best)}  ·  DEEPEST LEVEL ${bestLevel}  ·  INVADERS DESTROYED ${totalKills}  ·  GALAXIES SAVED ${wins}`;
    }
    this.showScreen('log');
  }

  showSettings() {
    this.state = 'settings';
    this._syncSettingsUi();
    this.showScreen('settings');
  }

  showHelp() {
    this.state = 'help';
    this.showScreen('help');
  }

  showLevels() {
    this.state = 'help';
    if (!this.dom.levelTable.dataset.filled) {
      const rows = [];
      for (let n = 1; n <= MAX_LEVEL; n++) {
        const c = levelConfig(n);
        rows.push(`<tr class="${c.boss ? 'boss' : ''}"><td>${String(n).padStart(3, '0')}</td><td>${c.sector}</td><td class="num">x${c.multiplier}</td><td>${c.boss ? 'BOSS ' + c.bossHp + ' HP' : c.rows + '×' + c.cols}</td><td class="num">${c.speed.toFixed(1)}</td><td class="num">${c.shields}</td></tr>`);
      }
      this.dom.levelTable.innerHTML = rows.join('');
      this.dom.levelTable.dataset.filled = '1';
    }
    this.showScreen('levels');
  }

  _syncSettingsUi() {
    const s = this.settings;
    const set = (el, on) => { el.textContent = on ? 'ON' : 'OFF'; el.classList.toggle('on', on); };
    set(this.dom.setSound, s.sound);
    set(this.dom.setAuto, s.autofire);
    set(this.dom.setInvert, s.invert);
    set(this.dom.setFb, s.forwardBack);
    this.dom.setSens.value = s.sensitivity;
    this.dom.sensVal.textContent = s.sensitivity;
  }

  _toggleSetting(key) {
    this.settings[key] = !this.settings[key];
    if (key === 'sound') this.sfx.enabled = this.settings.sound;
    Scores.saveSettings(this.settings);
    this._syncSettingsUi();
    this.sfx.blip();
  }

  // ---- name entry ------------------------------------------------------

  showNameEntry(rank) {
    this.state = 'nameentry';
    this.nameLetters = [0, 0, 0];
    this.nameSlot = 0;
    this.dom.nameRank.textContent = `RANK ${rank}  ·  LEVEL ${String(this.finalLevel).padStart(3, '0')}`;
    this.dom.nameScore.textContent = Scores.formatScore(this.finalScore);
    this._nameRender();
    this.showScreen('name');
    this.sfx.coin();
  }

  _nameRender() {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    this.dom.letters.forEach((el, i) => {
      el.textContent = alpha[this.nameLetters[i]];
      el.classList.toggle('active', i === this.nameSlot);
    });
  }

  _nameStep(idx, dir) {
    const n = 36;
    this.nameSlot = idx;
    this.nameLetters[idx] = (this.nameLetters[idx] + dir + n) % n;
    this._nameRender();
    this.sfx.blip();
  }

  _nameKey(e) {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const k = e.key.toUpperCase();
    if (alpha.includes(k) && k.length === 1) {
      this.nameLetters[this.nameSlot] = alpha.indexOf(k);
      this.nameSlot = Math.min(2, this.nameSlot + 1);
      this._nameRender();
      this.sfx.blip();
    } else if (e.code === 'ArrowUp') this._nameStep(this.nameSlot, 1);
    else if (e.code === 'ArrowDown') this._nameStep(this.nameSlot, -1);
    else if (e.code === 'ArrowLeft') { this.nameSlot = Math.max(0, this.nameSlot - 1); this._nameRender(); }
    else if (e.code === 'ArrowRight') { this.nameSlot = Math.min(2, this.nameSlot + 1); this._nameRender(); }
    else if (e.code === 'Backspace') { this.nameSlot = Math.max(0, this.nameSlot - 1); this._nameRender(); }
    else if (e.code === 'Enter') this._nameSubmit();
  }

  _nameSubmit() {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const name = this.nameLetters.map((i) => alpha[i]).join('');
    const table = Scores.addHighScore({ name, score: this.finalScore, level: this.finalLevel });
    const idx = table.findIndex((e) => e.name === name && e.score === this.finalScore);
    this.sfx.coin();
    this.showScores(idx);
  }

  // ---- HUD ----------------------------------------------------------------

  updateHud(force) {
    const c = this._hudCache;
    const set = (key, el, val) => { if (force || c[key] !== val) { c[key] = val; el.textContent = val; } };
    set('score', this.dom.score, Scores.formatScore(this.score));
    set('hi', this.dom.hi, Scores.formatScore(this.hiScore));
    set('level', this.dom.level, `LV ${String(this.level).padStart(3, '0')}  x${this.cfg.multiplier}`);
    const lives = Math.max(0, this.lives);
    if (force || c.lives !== lives) {
      c.lives = lives;
      this.dom.lives.textContent = lives > 5 ? `▲ ×${lives}` : '▲'.repeat(lives);
    }
    const bossOn = !!(this.boss && !this.boss.dead);
    if (force || c.bossOn !== bossOn) { c.bossOn = bossOn; this.dom.bossBar.classList.toggle('hidden', !bossOn); }
    if (bossOn) {
      const pct = Math.round((this.boss.hp / this.boss.maxHp) * 100);
      if (force || c.bossPct !== pct) { c.bossPct = pct; this.dom.bossFill.style.width = pct + '%'; }
    }
  }

  banner(title, sub = '', seconds = 2.2) {
    this.dom.bannerTitle.textContent = title;
    this.dom.bannerSub.textContent = sub;
    this.dom.banner.classList.remove('hidden');
    this.dom.banner.classList.remove('show');
    void this.dom.banner.offsetWidth;   // restart the CSS animation
    this.dom.banner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.dom.banner.classList.add('hidden'), seconds * 1000);
  }

  toast(text) { this.banner(text, '', 1.1); }

  popup(worldPos, text) {
    const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(this.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    this.dom.popups.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }
}

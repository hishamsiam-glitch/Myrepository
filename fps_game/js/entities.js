/* Enemies, projectiles, pickups, checkpoints, gates, particles and the
 * player's weapon: everything that is a THREE object with behaviour. */

import * as THREE from './lib/three.min.js';
import { CELL, WALL_H, worldToCell, flowStep, moveWithCollision, cellToWorld } from './level.js';

export const ENEMY_DEFS = {
  drone: { hp: 30, speed: 3.6, radius: 0.5, height: 1.0, centerY: 1.6, score: 100, range: 20, interval: 1.7, projSpeed: 13, dmg: 10, name: 'Drone' },
  crawler: { hp: 20, speed: 5.4, radius: 0.5, height: 0.7, centerY: 0.4, score: 75, melee: 12, meleeRange: 1.5, meleeInterval: 0.9, name: 'Crawler' },
  heavy: { hp: 120, speed: 2.1, radius: 0.8, height: 2.0, centerY: 1.05, score: 300, range: 24, interval: 2.6, burst: 3, projSpeed: 12, dmg: 8, name: 'Heavy' },
};

const mat = (color, emissive = 0x000000, intensity = 1) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: intensity });

const GEO = {
  octa: new THREE.OctahedronGeometry(0.45, 0),
  ring: new THREE.TorusGeometry(0.6, 0.06, 6, 20),
  eye: new THREE.SphereGeometry(0.12, 8, 8),
  crawlerBody: new THREE.BoxGeometry(0.9, 0.45, 1.1),
  leg: new THREE.BoxGeometry(0.16, 0.3, 0.16),
  heavyBody: new THREE.BoxGeometry(1.4, 1.9, 1.2),
  heavyHead: new THREE.BoxGeometry(0.9, 0.5, 0.9),
  cannon: new THREE.CylinderGeometry(0.14, 0.18, 1.0, 8),
  bolt: new THREE.SphereGeometry(0.13, 6, 6),
  pickupBox: new THREE.BoxGeometry(0.5, 0.5, 0.5),
  cross1: new THREE.BoxGeometry(0.6, 0.2, 0.2),
  cross2: new THREE.BoxGeometry(0.2, 0.6, 0.2),
  core: new THREE.OctahedronGeometry(0.4, 0),
  cpRing: new THREE.TorusGeometry(1.4, 0.09, 8, 32),
  cpPillar: new THREE.CylinderGeometry(1.2, 1.2, 3.2, 20, 1, true),
  gate: new THREE.BoxGeometry(CELL, WALL_H, CELL),
};

function buildEnemyMesh(type) {
  const g = new THREE.Group();
  const mats = [];
  if (type === 'drone') {
    const body = new THREE.Mesh(GEO.octa, mat(0x9fb0c4, 0x203040, 1));
    body.scale.set(1, 0.8, 1.2);
    const ring = new THREE.Mesh(GEO.ring, mat(0x4a5666, 0x113344, 1));
    ring.rotation.x = Math.PI / 2;
    const eye = new THREE.Mesh(GEO.eye, mat(0xff2020, 0xff2020, 1.5));
    eye.position.set(0, 0.05, 0.42);
    g.add(body, ring, eye);
    mats.push(body.material, ring.material);
  } else if (type === 'crawler') {
    const body = new THREE.Mesh(GEO.crawlerBody, mat(0x6f8a3d, 0x1a2a10, 1));
    body.position.y = 0.42;
    g.add(body);
    mats.push(body.material);
    for (const [x, z] of [[-0.42, 0.35], [0.42, 0.35], [-0.42, -0.35], [0.42, -0.35]]) {
      const leg = new THREE.Mesh(GEO.leg, mat(0x3f4f2a));
      leg.position.set(x, 0.15, z);
      g.add(leg);
      mats.push(leg.material);
    }
    for (const x of [-0.22, 0.22]) {
      const eye = new THREE.Mesh(GEO.eye, mat(0xffa020, 0xffa020, 1.5));
      eye.scale.setScalar(0.8);
      eye.position.set(x, 0.55, 0.56);
      g.add(eye);
    }
  } else {
    const body = new THREE.Mesh(GEO.heavyBody, mat(0x8a3f3f, 0x2a0a0a, 1));
    body.position.y = 1.0;
    const head = new THREE.Mesh(GEO.heavyHead, mat(0x5a2a2a));
    head.position.y = 2.15;
    const slit = new THREE.Mesh(GEO.eye, mat(0xff3030, 0xff3030, 1.5));
    slit.scale.set(2.6, 0.5, 1);
    slit.position.set(0, 2.15, 0.46);
    const cannon = new THREE.Mesh(GEO.cannon, mat(0x333333));
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(0.55, 1.3, 0.9);
    g.add(body, head, slit, cannon);
    mats.push(body.material, head.material);
  }
  return { group: g, mats };
}

export class Enemy {
  constructor(type, x, z, zone) {
    this.type = type;
    this.def = ENEMY_DEFS[type];
    this.zone = zone;
    this.x = x;
    this.z = z;
    this.y = this.def.centerY;
    this.hp = this.def.hp;
    this.alive = true;
    this.aware = false;
    this.cooldown = 1 + Math.random();
    this.burstLeft = 0;
    this.flash = 0;
    this.deathT = 0;
    this.removed = false;
    this.phase = Math.random() * Math.PI * 2;
    const m = buildEnemyMesh(type);
    this.mesh = m.group;
    this.mats = m.mats;
    this.baseEmissive = this.mats.map((mm) => mm.emissive.getHex());
    this.mesh.position.set(x, type === 'drone' ? this.y : 0, z);
    this.mesh.frustumCulled = false;
  }

  get radius() { return this.def.radius; }
  get centerY() { return this.type === 'drone' ? this.y : this.def.centerY; }
  get height() { return this.def.height; }

  hit(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.aware = true;
    this.flash = 0.09;
    for (const m of this.mats) m.emissive.setHex(0xffffff);
    if (this.hp <= 0) {
      this.alive = false;
      this.deathT = 0;
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    const def = this.def;
    if (!this.alive) {
      this.deathT += dt;
      const k = Math.max(0, 1 - this.deathT / 0.45);
      this.mesh.scale.setScalar(Math.max(0.001, k));
      this.mesh.rotation.z += dt * 6;
      if (this.deathT > 0.45) this.removed = true;
      return;
    }
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) this.mats.forEach((m, i) => m.emissive.setHex(this.baseEmissive[i]));
    }
    const p = ctx.player;
    const dx = p.x - this.x, dz = p.z - this.z;
    const dist = Math.hypot(dx, dz);
    const los = dist < 45 && ctx.lineOfSight(this.x, this.z, p.x, p.z);
    if (!this.aware && (los && dist < 30 || dist < 5)) this.aware = true;

    this.phase += dt;
    if (this.type === 'drone') this.y = def.centerY + Math.sin(this.phase * 3) * 0.15;

    if (this.aware && !this.frozen) {
      // --- movement -------------------------------------------------
      let mx = 0, mz = 0;
      const toward = () => {
        const c = worldToCell(this.x, this.z);
        const step = ctx.flow ? flowStep(ctx.level, ctx.flow, c.cx, c.cy) : null;
        const pc = worldToCell(p.x, p.z);
        if (step && !(step.x === pc.cx && step.y === pc.cy) && !(c.cx === pc.cx && c.cy === pc.cy)) {
          const t = cellToWorld(step.x, step.y);
          const tx = t.x - this.x, tz = t.z - this.z;
          const l = Math.hypot(tx, tz) || 1;
          return [tx / l, tz / l];
        }
        const l = dist || 1;
        return [dx / l, dz / l];
      };
      if (this.type === 'crawler') {
        if (dist > def.meleeRange * 0.8) [mx, mz] = toward();
      } else if (this.type === 'drone') {
        if (!los || dist > 12) [mx, mz] = toward();
        else if (dist < 6) { mx = -dx / dist; mz = -dz / dist; }
        else { // orbit
          const s = Math.sin(this.phase * 0.7) > 0 ? 1 : -1;
          mx = -dz / dist * s; mz = dx / dist * s;
        }
      } else { // heavy
        if (!los || dist > 10) [mx, mz] = toward();
      }
      // separation from other enemies
      for (const o of ctx.enemies) {
        if (o === this || !o.alive) continue;
        const ox = this.x - o.x, oz = this.z - o.z;
        const d = Math.hypot(ox, oz);
        const min = this.radius + o.radius + 0.3;
        if (d > 0.001 && d < min) { mx += ox / d * (min - d) * 2; mz += oz / d * (min - d) * 2; }
      }
      // keep out of the player's body
      if (dist < this.radius + 0.6 && dist > 0.001) { mx -= dx / dist; mz -= dz / dist; }
      const l = Math.hypot(mx, mz);
      if (l > 0.01) {
        const sp = def.speed * dt / Math.max(1, l);
        const r = moveWithCollision(ctx.level, this.x, this.z, mx * sp, mz * sp, this.radius);
        this.x = r.x; this.z = r.z;
      }

      // --- attacks --------------------------------------------------
      this.cooldown -= dt;
      if (this.type === 'crawler') {
        if (dist < def.meleeRange && this.cooldown <= 0) {
          ctx.meleePlayer(def.melee, this);
          this.cooldown = def.meleeInterval;
        }
      } else if (los && dist < def.range && this.cooldown <= 0) {
        this._shoot(ctx, p, dist);
        if (def.burst) {
          // Fire `burst` shots 0.16 s apart, then wait the full interval.
          this.burstLeft = this.burstLeft > 0 ? this.burstLeft - 1 : def.burst - 1;
          this.cooldown = this.burstLeft > 0 ? 0.16 : def.interval;
        } else {
          this.cooldown = def.interval * (0.8 + Math.random() * 0.4);
        }
      }
    }

    // Drones are built around their body centre; ground units around their feet.
    const baseY = this.type === 'drone' ? this.y : this.type === 'crawler' ? Math.abs(Math.sin(this.phase * 8)) * 0.05 : 0;
    this.mesh.position.set(this.x, baseY, this.z);
    if (dist > 0.01) this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  _shoot(ctx, p, dist) {
    const def = this.def;
    const muzzleY = this.type === 'heavy' ? 1.3 : this.y;
    const spread = 0.05 + dist * 0.004;
    const tx = p.x - this.x + (Math.random() - 0.5) * spread * dist;
    const ty = 1.4 - muzzleY + (Math.random() - 0.5) * spread * dist * 0.5;
    const tz = p.z - this.z + (Math.random() - 0.5) * spread * dist;
    const l = Math.hypot(tx, ty, tz) || 1;
    ctx.fireProjectile(this.x, muzzleY, this.z, tx / l, ty / l, tz / l, def.projSpeed, def.dmg, this.type === 'heavy' ? 0xff7a30 : 0xff3060);
  }
}

export class Projectile {
  constructor(x, y, z, dx, dy, dz, speed, dmg, color) {
    this.x = x; this.y = y; this.z = z;
    this.vx = dx * speed; this.vy = dy * speed; this.vz = dz * speed;
    this.dmg = dmg;
    this.life = 4;
    this.dead = false;
    this.mesh = new THREE.Mesh(GEO.bolt, new THREE.MeshBasicMaterial({ color }));
    this.mesh.position.set(x, y, z);
  }

  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.life -= dt;
    this.mesh.position.set(this.x, this.y, this.z);
    if (this.life <= 0 || this.y < 0 || this.y > WALL_H + 1) this.dead = true;
  }
}

export function makePickupMesh(kind) {
  let m;
  if (kind === 'ammo') m = new THREE.Mesh(GEO.pickupBox, mat(0xffc14f, 0xa06a10, 1));
  else if (kind === 'health') {
    m = new THREE.Group();
    m.add(new THREE.Mesh(GEO.cross1, mat(0x5cff8a, 0x1a7a3a, 1)), new THREE.Mesh(GEO.cross2, mat(0x5cff8a, 0x1a7a3a, 1)));
  } else {
    m = new THREE.Mesh(GEO.core, new THREE.MeshLambertMaterial({ color: 0x4fe3ff, emissive: 0x2090b0, emissiveIntensity: 1.2 }));
  }
  return m;
}

export function makeCheckpointMesh() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(GEO.cpRing, new THREE.MeshBasicMaterial({ color: 0x4fe3ff }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  const pillar = new THREE.Mesh(GEO.cpPillar, new THREE.MeshBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
  pillar.position.y = 1.6;
  g.add(ring, pillar);
  g.setActive = (on) => {
    const c = on ? 0x5cff8a : 0x4fe3ff;
    ring.material.color.setHex(c);
    pillar.material.color.setHex(c);
  };
  return g;
}

export function makeBeaconMesh(color) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(GEO.cpRing, new THREE.MeshBasicMaterial({ color }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  const pillar = new THREE.Mesh(GEO.cpPillar, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
  pillar.position.y = 1.6;
  pillar.scale.y = 2.2;
  g.add(ring, pillar);
  g.setColor = (c) => { ring.material.color.setHex(c); pillar.material.color.setHex(c); };
  return g;
}

export function makeGateMesh(cells) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0x7a5a2a, emissive: 0xff8a20, emissiveIntensity: 0.35 });
  for (const [cx, cy] of cells) {
    const b = new THREE.Mesh(GEO.gate, m);
    const w = cellToWorld(cx, cy);
    b.position.set(w.x, WALL_H / 2, w.z);
    g.add(b);
  }
  g.material = m;
  return g;
}

export function makeWeapon() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.55), mat(0x2a3444));
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.12), mat(0x1a222e));
  grip.position.set(0, -0.15, 0.15);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.45, 8), mat(0x555e6a));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.45);
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: 0x4fe3ff }));
  core.position.set(0.07, 0.02, -0.1);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
  flash.position.set(0, 0.03, -0.72);
  flash.visible = false;
  g.add(body, grip, barrel, core, flash);
  g.flash = flash;
  g.position.set(0.3, -0.27, -0.55);
  g.rotation.y = -0.06;
  return g;
}

/* Fixed-size pool of point particles for sparks and debris. */
export class Particles {
  constructor(scene, max = 400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -100;
  }

  burst(x, y, z, color, count = 12, speed = 4) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      this.vel[i * 3 + 1] = Math.cos(ph) * s + 1;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.life[i] = 0.4 + Math.random() * 0.4;
    }
    this.colAttr.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -100; continue; }
      this.vel[i * 3 + 1] -= 9 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
    }
    this.posAttr.needsUpdate = true;
  }
}

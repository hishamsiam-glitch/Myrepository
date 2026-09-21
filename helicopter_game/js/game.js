/* Skyline Heli - main game: physics, camera, rendering, HUD and screens. */
(function (global) {
  'use strict';

  const doc = global.document;
  const Terrain = global.Terrain;
  const Heli = global.Heli;

  const MAX_SPEED = 260;      // world px / s
  const TURN_RATE = 1.7;      // rad / s at full tilt
  const CLIMB_RATE = 45;      // altitude units / s
  const START_ALT = 40;
  const MAX_ALT = Terrain.MAX_ALT;
  const FUEL_CAN = 35;
  const PX_PER_KM = 4000;     // 1 world px = 0.25 m

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function $(id) { return doc.getElementById(id); }

  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const input = global.createInput(canvas, {});
  const audio = global.createAudio();

  let W = 0;
  let H = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    W = global.innerWidth;
    H = global.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    if (game.world) game.world.setDpr(dpr);
  }

  const game = {
    phase: 'menu', // menu | playing | paused | crashed | over
    world: null,
    seed: 0,
    heli: null,
    collected: new Set(),
    particles: [],
    stats: null,
    frame: 0,
    time: 0,
    crashTimer: 0,
    shake: 0,
    warnTimer: 0,
    idleTimer: 0,
    lastHud: 0,
    best: 0,
  };

  try { game.best = parseInt(global.localStorage.getItem('heli.best') || '0', 10) || 0; } catch (e) { game.best = 0; }

  function newHeli(spawn) {
    return {
      x: spawn.x, y: spawn.y, heading: 0, speed: 0, throttle: 0,
      alt: START_ALT, vAlt: 0, fuel: 100, rotor: 0, engine: true,
      bank: 0, pitch: 0,
    };
  }

  function start() {
    const params = new URLSearchParams(global.location.search);
    const forced = parseInt(params.get('seed') || '', 10);
    game.seed = Number.isFinite(forced) ? forced : (Date.now() % 1000000);
    game.world = Terrain.makeWorld(game.seed);
    game.world.setDpr(dpr);
    game.heli = newHeli(game.world.findSpawn());
    game.world.prewarm(game.heli.x, game.heli.y, Math.hypot(W, H) / 2 + 40);
    game.collected = new Set();
    game.particles = [];
    game.stats = { distance: 0, fuelCans: 0, rings: 0, score: 0, reason: '' };
    game.time = 0;
    game.crashTimer = 0;
    game.shake = 0;
    game.idleTimer = 0;
    game.phase = 'playing';
    input.calibrate();
    $('start').classList.add('hidden');
    $('over').classList.add('hidden');
    $('paused').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('hint').classList.remove('hidden');
    lastTime = performance.now();
  }

  function gameOver(reason) {
    game.phase = 'over';
    game.stats.reason = reason;
    if (game.stats.score > game.best) {
      game.best = game.stats.score;
      try { global.localStorage.setItem('heli.best', String(game.best)); } catch (e) { /* ignore */ }
    }
    $('over-reason').textContent = reason;
    $('over-score').textContent = game.stats.score;
    $('over-dist').textContent = (game.stats.distance / PX_PER_KM).toFixed(2) + ' km';
    $('over-fuel').textContent = game.stats.fuelCans;
    $('over-rings').textContent = game.stats.rings;
    $('over-best').textContent = game.best;
    $('over').classList.remove('hidden');
    $('hint').classList.add('hidden');
  }

  function crash() {
    if (game.phase !== 'playing') return;
    game.phase = 'crashed';
    game.crashTimer = 1.5;
    game.shake = 1;
    audio.crash();
    if (global.navigator.vibrate) { try { global.navigator.vibrate([120, 40, 200]); } catch (e) { /* ignore */ } }
    const cx = W / 2;
    const cy = H * 0.64;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 220;
      game.particles.push({
        x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.6 + Math.random() * 0.9, age: 0,
        r: 2 + Math.random() * 5,
        color: Math.random() < 0.5 ? '#ff9b2e' : (Math.random() < 0.5 ? '#ff4b1f' : '#555'),
      });
    }
  }

  function pause() {
    if (game.phase !== 'playing') return;
    game.phase = 'paused';
    $('paused').classList.remove('hidden');
    audio.setRotor(0, 0);
  }

  function resume() {
    if (game.phase !== 'paused') return;
    game.phase = 'playing';
    $('paused').classList.add('hidden');
    lastTime = performance.now();
  }

  // ---- Simulation -------------------------------------------------------

  function update(dt) {
    const h = game.heli;
    const st = input.state;
    input.update(dt);
    game.time += dt;

    if (game.phase === 'crashed') {
      game.crashTimer -= dt;
      game.shake = Math.max(0, game.shake - dt * 0.8);
      if (game.crashTimer <= 0) gameOver('Crashed into the terrain');
      updateParticles(dt);
      return;
    }
    if (game.phase !== 'playing') return;

    // Throttle spools up while a finger is held.
    const throttleIn = h.engine ? st.throttle : 0;
    h.throttle += (throttleIn - h.throttle) * (1 - Math.exp(-dt * 2.5));
    const targetSpeed = h.throttle * MAX_SPEED;
    h.speed += (targetSpeed - h.speed) * (1 - Math.exp(-dt * 1.1));

    // Steering: roll tilt turns the helicopter; a moving helicopter turns
    // a little faster than a hovering one.
    const turn = st.steer * TURN_RATE * (0.55 + 0.45 * h.speed / MAX_SPEED);
    h.heading += turn * dt;

    // Altitude: pitch tilt climbs or descends.
    let climbIn = h.engine ? st.climb : -0.6;
    h.vAlt += (climbIn * CLIMB_RATE - h.vAlt) * (1 - Math.exp(-dt * 3));
    h.alt = clamp(h.alt + h.vAlt * dt, 0, MAX_ALT);

    // Move.
    const dx = Math.sin(h.heading) * h.speed * dt;
    const dy = -Math.cos(h.heading) * h.speed * dt;
    h.x += dx;
    h.y += dy;
    game.stats.distance += Math.hypot(dx, dy);

    // Visual tilt follows the inputs.
    h.bank += (st.steer - h.bank) * (1 - Math.exp(-dt * 6));
    h.pitch += (st.climb - h.pitch) * (1 - Math.exp(-dt * 6));
    h.rotor += dt * (18 + h.throttle * 22);

    // Fuel.
    if (h.engine) {
      h.fuel -= dt * (0.25 + h.throttle * 1.05 + Math.max(0, st.climb) * 0.45);
      if (h.fuel <= 0) {
        h.fuel = 0;
        h.engine = false;
      }
    }

    // Terrain collision: sample under the body and just ahead of it.
    const world = game.world;
    let ground = world.groundAt(h.x, h.y);
    ground = Math.max(ground, world.groundAt(h.x + Math.sin(h.heading) * 10, h.y - Math.cos(h.heading) * 10));
    ground = Math.max(ground, world.groundAt(h.x - Math.sin(h.heading) * 8, h.y + Math.cos(h.heading) * 8));
    h.ground = ground;
    if (ground > 0 && h.alt < ground + 4) {
      crash();
      return;
    }
    if (h.alt <= 0 && !h.engine) {
      gameOver(h.speed < 90 ? 'Landed with dry tanks' : 'Ran out of fuel and hit the ground');
      return;
    }
    if (h.alt <= 0 && h.speed > 140) {
      crash();
      return;
    }

    // Terrain proximity warning.
    const margin = h.alt - ground;
    h.warning = ground > 0 && margin < 14;
    if (h.warning) {
      game.warnTimer -= dt;
      if (game.warnTimer <= 0) { audio.warning(); game.warnTimer = 0.45; }
    }

    // Pickups.
    for (const p of world.pickupsNear(h.x, h.y, 64)) {
      if (game.collected.has(p.id)) continue;
      const d = Math.hypot(p.x - h.x, p.y - h.y);
      if (p.kind === 'fuel' && d < 26 && h.alt < p.alt + 30) {
        game.collected.add(p.id);
        h.fuel = Math.min(100, h.fuel + FUEL_CAN);
        if (!h.engine && h.fuel > 0) h.engine = true;
        game.stats.fuelCans++;
        audio.pickup();
        burst(p, '#ffd166');
      } else if (p.kind === 'ring' && d < 30 && Math.abs(h.alt - p.alt) < 14) {
        game.collected.add(p.id);
        game.stats.rings++;
        audio.ring();
        burst(p, '#ffe36e');
      }
    }

    game.stats.score = Math.floor(game.stats.distance / 40) + game.stats.fuelCans * 50 + game.stats.rings * 100;

    // "Hold to fly" hint while idle.
    if (st.throttle > 0) game.idleTimer = 0; else game.idleTimer += dt;
    $('hint').classList.toggle('hidden', !(game.idleTimer > 1.5 && h.engine));

    audio.setRotor(h.engine ? Math.max(0.3, h.throttle) : 0, h.speed / MAX_SPEED);
    updateParticles(dt);
  }

  function burst(p, color) {
    // Particles live in screen space; convert from the pickup's world position.
    const s = worldToScreen(p.x, p.y);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 120;
      game.particles.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, age: 0, r: 2 + Math.random() * 2, color });
    }
  }

  function updateParticles(dt) {
    const ps = game.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
  }

  function worldToScreen(wx, wy) {
    const h = game.heli;
    const cx = W / 2;
    const cy = H * 0.64;
    const rx = wx - h.x;
    const ry = wy - h.y;
    const c = Math.cos(-h.heading);
    const s = Math.sin(-h.heading);
    return { x: cx + rx * c - ry * s, y: cy + rx * s + ry * c };
  }

  // ---- Rendering --------------------------------------------------------

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game.world) {
      ctx.fillStyle = '#1b2a3a';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const h = game.heli;
    const cx = W / 2;
    const cy = H * 0.64;
    const shakeX = (Math.random() - 0.5) * game.shake * 18;
    const shakeY = (Math.random() - 0.5) * game.shake * 18;

    ctx.save();
    ctx.translate(cx + shakeX, cy + shakeY);
    ctx.rotate(-h.heading);
    ctx.translate(-h.x, -h.y);
    const radius = Math.hypot(W, H) / 2 + 40;
    game.world.draw(ctx, h.x, h.y, radius, game.frame, 2);
    drawPickups(radius);
    ctx.restore();

    // High-altitude haze.
    const haze = clamp((h.alt - 60) / 120, 0, 0.28);
    if (haze > 0) {
      ctx.fillStyle = 'rgba(210,225,240,' + haze.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (game.phase !== 'over') {
      const altScale = 1 + h.alt * 0.0025;
      if (game.phase !== 'crashed') {
        // The shadow is cast from the height above the ground beneath, so it
        // closes in on the helicopter as terrain rises: a clearance cue.
        const clr = Math.max(0, h.alt - (h.ground || 0));
        Heli.drawShadow(ctx, cx + clr * 0.35 + shakeX, cy + clr * 0.45 + shakeY, h.rotor, 1 - clr / 500, 0.4 - clr / 500);
        Heli.drawHelicopter(ctx, cx + shakeX, cy + shakeY, h.bank, h.pitch, h.rotor, altScale);
      }
    }

    for (const p of game.particles) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.5 + t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPickups(radius) {
    const h = game.heli;
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5);
    for (const p of game.world.pickupsNear(h.x, h.y, radius)) {
      if (game.collected.has(p.id)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(h.heading); // local axes now match the screen
      if (p.kind === 'fuel') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(3, 4, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,80,' + (0.35 + pulse * 0.4).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 18 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#e63946';
        roundRect(ctx, -7, -8, 14, 16, 3);
        ctx.fill();
        ctx.fillStyle = '#b8222e';
        ctx.fillRect(-3, -11, 6, 3);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('F', 0, 1);
      } else {
        const diff = p.alt - h.alt;
        const near = Math.abs(diff) < 14;
        const sc = 1 + p.alt * 0.0025;
        // Ground shadow, offset like the helicopter's.
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.alt * 0.35, p.alt * 0.45, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.scale(sc, sc);
        ctx.strokeStyle = near ? '#ffffff' : '#f4c430';
        ctx.lineWidth = near ? 5 : 4;
        ctx.globalAlpha = near ? 1 : 0.8;
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = near ? '#ffffff' : '#ffe9a3';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(near ? 'OK' : (diff > 0 ? '▲' : '▼') + Math.abs(Math.round(diff)), 0, 0);
      }
      ctx.restore();
    }
  }

  function roundRect(c, x, y, w, hh, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + hh - r);
    c.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
    c.lineTo(x + r, y + hh);
    c.quadraticCurveTo(x, y + hh, x, y + hh - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  // ---- HUD --------------------------------------------------------------

  const hud = {
    score: $('score'), dist: $('dist'), fuelBar: $('fuel-bar'), fuelText: $('fuel-text'),
    altMarker: $('alt-marker'), altGround: $('alt-ground'), altText: $('alt-text'),
    speed: $('speed'), biome: $('biome'), warn: $('warn'), tiltDot: $('tilt-dot'),
    sensorNote: $('sensor-note'),
  };

  function updateHud(now) {
    const h = game.heli;
    const st = input.state;
    hud.tiltDot.style.transform = 'translate(' + (st.steer * 18).toFixed(1) + 'px,' + (-st.climb * 18).toFixed(1) + 'px)';
    hud.altMarker.style.bottom = (h.alt / MAX_ALT * 100).toFixed(1) + '%';
    hud.altGround.style.height = ((h.ground || 0) / MAX_ALT * 100).toFixed(1) + '%';
    hud.altMarker.classList.toggle('danger', !!h.warning);
    if (now - game.lastHud < 100) return;
    game.lastHud = now;
    hud.score.textContent = game.stats.score;
    hud.dist.textContent = (game.stats.distance / PX_PER_KM).toFixed(2) + ' km';
    hud.fuelBar.style.width = h.fuel.toFixed(1) + '%';
    hud.fuelBar.classList.toggle('low', h.fuel < 25);
    hud.fuelText.textContent = h.engine ? Math.round(h.fuel) + '%' : 'EMPTY';
    hud.altText.textContent = Math.round(h.alt);
    hud.speed.textContent = Math.round(h.speed * 0.9) + ' km/h';
    hud.biome.textContent = Terrain.BIOME_NAME[game.world.biomeAt(h.x, h.y)];
    let warn = '';
    if (!h.engine) warn = 'OUT OF FUEL';
    else if (h.warning) warn = 'TERRAIN! PULL UP';
    else if (h.fuel < 20) warn = 'LOW FUEL';
    hud.warn.textContent = warn;
    hud.warn.classList.toggle('hidden', !warn);
    hud.sensorNote.textContent = st.sensors
      ? (st.sensorsStale ? 'Tilt sensor paused' : '')
      : (st.mode === 'keyboard' ? 'Keyboard: arrows / WASD, space = fly' : 'No tilt sensor: drag to steer');
  }

  // ---- Main loop --------------------------------------------------------

  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    game.frame++;
    if (game.world) {
      update(dt);
      render();
      if (game.phase === 'playing' || game.phase === 'crashed') updateHud(now);
    } else {
      render();
    }
    global.requestAnimationFrame(frame);
  }

  // ---- Wiring -----------------------------------------------------------

  function applyOptions() {
    const sens = parseInt($('opt-sens').value, 10);
    input.setOptions({
      invertPitch: $('opt-invert').checked,
      steerRange: 32 - sens * 2,   // slider 1..10 -> 30..12 degrees
      climbRange: 26 - sens * 1.6,
    });
    try {
      global.localStorage.setItem('heli.opts', JSON.stringify({ invert: $('opt-invert').checked, sens }));
    } catch (e) { /* ignore */ }
  }

  function loadOptions() {
    try {
      const o = JSON.parse(global.localStorage.getItem('heli.opts') || 'null');
      if (o) {
        $('opt-invert').checked = !!o.invert;
        $('opt-sens').value = o.sens || 5;
      }
    } catch (e) { /* ignore */ }
    applyOptions();
  }

  async function onStart() {
    applyOptions();
    audio.resume();
    const ok = await input.requestSensors();
    if (!ok) $('sensor-note').textContent = 'Tilt permission denied: drag to steer';
    start();
    try {
      if (global.screen.orientation && global.screen.orientation.lock) {
        global.screen.orientation.lock('portrait').catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  $('btn-start').addEventListener('click', onStart);
  $('btn-restart').addEventListener('click', () => { audio.resume(); start(); });
  $('btn-resume').addEventListener('click', resume);
  $('btn-calib').addEventListener('click', (e) => { e.stopPropagation(); input.calibrate(); flash('Neutral tilt reset'); });
  $('btn-pause').addEventListener('click', (e) => { e.stopPropagation(); if (game.phase === 'playing') pause(); else resume(); });
  $('btn-sound').addEventListener('click', (e) => {
    e.stopPropagation();
    audio.setMuted(!audio.isMuted());
    $('btn-sound').textContent = audio.isMuted() ? '🔇' : '🔊';
  });
  $('opt-invert').addEventListener('change', applyOptions);
  $('opt-sens').addEventListener('input', applyOptions);
  $('best').textContent = game.best;

  function flash(msg) {
    const el = $('flash');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(flash.t);
    flash.t = setTimeout(() => el.classList.add('hidden'), 1200);
  }

  doc.addEventListener('visibilitychange', () => { if (doc.hidden) pause(); });
  global.addEventListener('resize', resize);
  global.addEventListener('orientationchange', () => setTimeout(resize, 200));
  global.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (game.phase === 'menu')) onStart();
    else if (e.key === 'Enter' && game.phase === 'over') start();
    else if ((e.key === 'p' || e.key === 'Escape') && game.phase === 'playing') pause();
    else if ((e.key === 'p' || e.key === 'Escape') && game.phase === 'paused') resume();
    else if (e.key === 'c' && game.phase === 'playing') input.calibrate();
  });

  resize();
  loadOptions();
  global.requestAnimationFrame(frame);

  // Debug / test hooks.
  global.HeliGame = {
    game, input, audio, start, pause, resume,
    get phase() { return game.phase; },
    get heli() { return game.heli; },
    get stats() { return game.stats; },
    get world() { return game.world; },
  };
})(window);

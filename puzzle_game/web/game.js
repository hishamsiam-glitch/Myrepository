/* Crate Quest - rendering, input and game flow. Depends on engine.js and levels.js. */
(function () {
  'use strict';

  const { Level } = window.CrateEngine;
  const LEVELS = window.CRATE_LEVELS;
  const STORAGE_KEY = 'crateQuest.v1';
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  const progress = loadProgress();

  function loadProgress() {
    const fallback = { solved: {}, current: 1, sound: true };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object' || typeof p.solved !== 'object') return fallback;
      return { solved: p.solved || {}, current: p.current || 1, sound: p.sound !== false };
    } catch (e) {
      return fallback;
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      /* storage unavailable (private mode etc.) - the game still works */
    }
  }

  const isUnlocked = (id) => id === 1 || !!progress.solved[id - 1];
  const solvedCount = () => Object.keys(progress.solved).length;

  // ---------------------------------------------------------------------------
  // Tiny synthesized sound effects (no audio files needed)
  // ---------------------------------------------------------------------------
  const audio = {
    ctx: null,
    ensure() {
      if (!progress.sound) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, type, gain, when) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime + (when || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    play(kind) {
      switch (kind) {
        case 'push': this.tone(180, 0.08, 'triangle', 0.06); break;
        case 'target': this.tone(660, 0.12, 'sine', 0.07); this.tone(990, 0.16, 'sine', 0.05, 0.06); break;
        case 'bump': this.tone(90, 0.06, 'square', 0.03); break;
        case 'undo': this.tone(300, 0.05, 'triangle', 0.03); break;
        case 'win':
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.08, i * 0.09));
          break;
        default: break;
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Palette
  // ---------------------------------------------------------------------------
  const C = {
    floorA: '#e9dfc8',
    floorB: '#e1d4b6',
    floorLine: 'rgba(120, 90, 50, 0.12)',
    wallSide: '#26334d',
    wallTop: '#3f5279',
    wallEdge: '#5d739f',
    target: '#f59e0b',
    targetGlow: 'rgba(245, 158, 11, 0.22)',
    box: '#cf8a3e',
    boxDark: '#8f561d',
    boxLight: '#e7a65a',
    boxDone: '#7fc97a',
    boxDoneDark: '#3f7d3a',
    boxDoneLight: '#a4dd9d',
    player: '#38bdf8',
    playerDark: '#0e7cb0',
    shadow: 'rgba(30, 20, 10, 0.25)',
  };

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  let level = null; // CrateEngine.Level
  let def = null; // level definition from levels.js
  let tile = 48;
  let dpr = 1;
  let facing = 'd';
  let anim = null; // current move animation
  let bump = null; // blocked-move wiggle
  let queue = []; // pending directions
  let particles = [];
  let rafPending = false;
  let solutionPlaying = false;
  let solutionAssistedMarked = false;
  let lastFrame = 0;
  let winPending = false;

  const WALK_MS = 105;
  const PUSH_MS = 125;
  const SOLUTION_MS = 190;

  // ---------------------------------------------------------------------------
  // Menu / level select
  // ---------------------------------------------------------------------------
  function renderMenu() {
    const worldsEl = $('worlds');
    worldsEl.innerHTML = '';
    const byWorld = new Map();
    for (const l of LEVELS) {
      if (!byWorld.has(l.world)) byWorld.set(l.world, []);
      byWorld.get(l.world).push(l);
    }
    const difficultyLabel = (w) =>
      ['Super easy', 'Easy', 'Gentle', 'Medium', 'Medium+', 'Tricky', 'Hard', 'Harder', 'Very hard', 'Super hard'][w - 1] || '';
    for (const [world, list] of byWorld) {
      const sec = document.createElement('section');
      sec.className = 'world';
      const head = document.createElement('div');
      head.className = 'world-head';
      const minB = Math.min(...list.map((l) => l.boxes));
      const maxB = Math.max(...list.map((l) => l.boxes));
      const crates = minB === maxB ? `${minB} crate${minB > 1 ? 's' : ''}` : `${minB}&ndash;${maxB} crates`;
      head.innerHTML = `<h2>World ${world} &middot; ${escapeHtml(list[0].worldName)}</h2><span class="difficulty">${difficultyLabel(world)} &middot; ${crates}</span>`;
      sec.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'level-grid';
      for (const l of list) {
        const b = document.createElement('button');
        b.className = 'level-btn';
        b.dataset.level = String(l.id);
        const s = progress.solved[l.id];
        const unlocked = isUnlocked(l.id);
        if (s && !s.assisted) b.classList.add('solved');
        else if (s && s.assisted) b.classList.add('assisted');
        if (!unlocked) b.classList.add('locked');
        if (l.id === progress.current) b.classList.add('current');
        b.disabled = !unlocked;
        b.innerHTML = `<span>${l.id}</span><span class="mark">${s ? (s.assisted ? '&#x2713;' : '&#x2605;') : ''}</span>`;
        b.title = s ? `Best: ${s.moves} moves / ${s.pushes} pushes` : unlocked ? `${l.boxes} crate${l.boxes > 1 ? 's' : ''}` : 'Locked';
        b.addEventListener('click', () => startLevel(l.id));
        grid.appendChild(b);
      }
      sec.appendChild(grid);
      worldsEl.appendChild(sec);
    }
    const n = solvedCount();
    $('progress-fill').style.width = `${(n / LEVELS.length) * 100}%`;
    $('progress-text').textContent = `${n} / ${LEVELS.length}`;
    $('btn-continue').textContent = n === LEVELS.length ? 'Play again' : n === 0 ? 'Start' : `Continue (level ${progress.current})`;
    $('btn-sound').textContent = `Sound: ${progress.sound ? 'on' : 'off'}`;
    $('btn-sound').setAttribute('aria-pressed', String(progress.sound));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function showMenu() {
    stopSolution();
    queue = [];
    particles = [];
    hideOverlays();
    $('screen-game').classList.add('hidden');
    $('screen-menu').classList.remove('hidden');
    renderMenu();
    const cur = document.querySelector('.level-btn.current');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
  }

  function hideOverlays() {
    document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
  }

  // ---------------------------------------------------------------------------
  // Level lifecycle
  // ---------------------------------------------------------------------------
  function startLevel(id) {
    const d = LEVELS.find((l) => l.id === id);
    if (!d || !isUnlocked(id)) return;
    stopSolution();
    def = d;
    level = new Level(d.rows);
    facing = 'd';
    anim = null;
    bump = null;
    queue = [];
    particles = [];
    winPending = false;
    progress.current = id;
    saveProgress();
    hideOverlays();
    $('screen-menu').classList.add('hidden');
    $('screen-game').classList.remove('hidden');
    $('hud-level').textContent = `Level ${d.id}`;
    $('hud-world').textContent = `${d.worldName} · ${d.boxes} crate${d.boxes > 1 ? 's' : ''} · optimal ${d.pushes} pushes`;
    updateHud();
    resize();
    requestFrame();
  }

  function restartLevel() {
    if (!level) return;
    stopSolution();
    level.reset();
    queue = [];
    anim = null;
    bump = null;
    winPending = false;
    updateHud();
    requestFrame();
  }

  function updateHud() {
    if (!level) return;
    $('hud-moves').textContent = String(level.moves);
    $('hud-pushes').textContent = String(level.pushes);
    const s = progress.solved[def.id];
    $('hud-best').textContent = s ? `${s.moves}` : '–';
    $('btn-undo').disabled = level.history.length === 0 || solutionPlaying;
    $('btn-solution').textContent = solutionPlaying ? 'Stop' : 'Solution';
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), ms || 1600);
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------
  function tryMove(dir, opts) {
    if (!level || winPending) return;
    if (anim) {
      if (queue.length < 6) queue.push(dir);
      return;
    }
    facing = dir;
    const rec = level.move(dir);
    if (!rec) {
      audio.play('bump');
      bump = { dir, start: performance.now(), duration: 110 };
      queue = [];
      requestFrame();
      return;
    }
    const from = level.xy(rec.from);
    const to = level.xy(rec.to);
    anim = {
      start: performance.now(),
      duration: opts && opts.duration ? opts.duration : rec.pushed ? PUSH_MS : WALK_MS,
      player: { from, to },
      box: rec.pushed ? { from: level.xy(rec.boxFrom), to: level.xy(rec.boxTo), onTarget: !!level.target[rec.boxTo] } : null,
    };
    if (rec.pushed) audio.play(level.target[rec.boxTo] ? 'target' : 'push');
    updateHud();
    requestFrame();
  }

  function onAnimEnd() {
    anim = null;
    if (level.solved) {
      queue = [];
      winPending = true;
      setTimeout(onSolved, 120);
      return;
    }
    if (queue.length) {
      const next = queue.shift();
      tryMove(next, solutionPlaying ? { duration: SOLUTION_MS } : undefined);
    }
  }

  function undo() {
    if (!level || solutionPlaying || winPending) return;
    queue = [];
    anim = null;
    const rec = level.undo();
    if (!rec) {
      toast('Nothing to undo');
      return;
    }
    audio.play('undo');
    facing = rec.dir;
    updateHud();
    requestFrame();
  }

  function walkTo(x, y) {
    if (!level || solutionPlaying || winPending) return;
    const p = level.playerPos;
    // Tapping a crate next to the player pushes it.
    if (level.hasBox(x, y) && Math.abs(x - p.x) + Math.abs(y - p.y) === 1) {
      tryMove(x > p.x ? 'r' : x < p.x ? 'l' : y > p.y ? 'd' : 'u');
      return;
    }
    const path = level.pathTo(x, y);
    if (!path) {
      if (level.isFloor(x, y)) toast("Can't reach that tile without pushing");
      return;
    }
    queue = path.slice(1);
    if (path.length) tryMove(path[0]);
  }

  // ---------------------------------------------------------------------------
  // Solution playback
  // ---------------------------------------------------------------------------
  function playSolution() {
    if (!level || !def.solution) return;
    hideOverlays();
    level.reset();
    anim = null;
    bump = null;
    winPending = false;
    solutionPlaying = true;
    if (!progress.solved[def.id]) {
      progress.solved[def.id] = { moves: def.moves, pushes: def.pushes, assisted: true };
      solutionAssistedMarked = true;
      saveProgress();
    }
    queue = def.solution.toLowerCase().split('');
    updateHud();
    toast('Playing the optimal solution…', 1500);
    const first = queue.shift();
    tryMove(first, { duration: SOLUTION_MS });
  }

  function stopSolution() {
    if (!solutionPlaying) return;
    solutionPlaying = false;
    queue = [];
    updateHud();
  }

  // ---------------------------------------------------------------------------
  // Win handling
  // ---------------------------------------------------------------------------
  function onSolved() {
    const assisted = solutionPlaying;
    solutionPlaying = false;
    const prev = progress.solved[def.id];
    if (assisted) {
      if (!prev) progress.solved[def.id] = { moves: level.moves, pushes: level.pushes, assisted: true };
    } else if (!prev || prev.assisted || level.moves < prev.moves) {
      progress.solved[def.id] = { moves: level.moves, pushes: level.pushes, assisted: false };
    }
    const next = LEVELS.find((l) => l.id === def.id + 1);
    progress.current = next ? next.id : def.id;
    saveProgress();
    audio.play('win');
    spawnConfetti();

    const badge = $('win-badge');
    badge.classList.toggle('assisted', assisted);
    badge.innerHTML = assisted ? '&#x2713;' : '&#x2605;';
    $('win-title').textContent = assisted ? `Level ${def.id} solved with help` : def.id === LEVELS.length ? 'You beat every level!' : `Level ${def.id} complete!`;
    $('win-stats').textContent = `${level.moves} moves, ${level.pushes} pushes (optimal: ${def.pushes} pushes)`;
    const note = $('win-note');
    if (assisted) note.textContent = 'Solve it yourself later to earn the star.';
    else if (level.pushes === def.pushes) note.textContent = 'Perfect push count!';
    else if (prev && !prev.assisted && level.moves >= prev.moves) note.textContent = `Your best is ${prev.moves} moves.`;
    else note.textContent = prev && !prev.assisted ? 'New best!' : '';
    $('btn-win-next').classList.toggle('hidden', !next);
    setTimeout(() => {
      $('overlay-win').classList.remove('hidden');
      $('btn-win-next').focus();
    }, 350);
    updateHud();
    requestFrame();
  }

  function spawnConfetti() {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const colors = [C.target, C.player, C.boxDone, '#f472b6', '#fde68a'];
    for (let i = 0; i < 90; i++) {
      particles.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.5,
        y: h / 2,
        vx: (Math.random() - 0.5) * 520,
        vy: -Math.random() * 520 - 120,
        size: 4 + Math.random() * 6,
        color: colors[i % colors.length],
        life: 1.2 + Math.random() * 0.6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function resize() {
    if (!level) return;
    const wrap = $('board-wrap');
    const availW = wrap.clientWidth - 24;
    const availH = wrap.clientHeight - 24;
    tile = Math.max(18, Math.min(84, Math.floor(Math.min(availW / level.width, availH / level.height))));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = tile * level.width;
    const cssH = tile * level.height;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    requestFrame();
  }

  function requestFrame() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(frame);
  }

  function frame(now) {
    rafPending = false;
    if (!level) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    draw(now, dt);
    let animating = false;
    if (anim) {
      if (now - anim.start >= anim.duration) onAnimEnd();
      animating = !!anim;
    }
    if (bump && now - bump.start >= bump.duration) bump = null;
    if (bump) animating = true;
    if (particles.length) animating = true;
    if (animating) requestFrame();
    else lastFrame = 0;
  }

  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

  function draw(now, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = level.width;
    const H = level.height;

    // Animated positions
    let pp = level.playerPos;
    let boxFrom = -1;
    let animBox = null;
    if (anim) {
      const t = ease(Math.min(1, (now - anim.start) / anim.duration));
      pp = {
        x: anim.player.from.x + (anim.player.to.x - anim.player.from.x) * t,
        y: anim.player.from.y + (anim.player.to.y - anim.player.from.y) * t,
      };
      if (anim.box) {
        boxFrom = level.index(anim.box.to.x, anim.box.to.y);
        animBox = {
          x: anim.box.from.x + (anim.box.to.x - anim.box.from.x) * t,
          y: anim.box.from.y + (anim.box.to.y - anim.box.from.y) * t,
          onTarget: anim.box.onTarget && t > 0.85,
        };
      }
    } else if (bump) {
      const t = Math.sin(Math.min(1, (now - bump.start) / bump.duration) * Math.PI) * 0.12;
      const d = window.CrateEngine.DIRS[bump.dir];
      pp = { x: pp.x + d.dx * t, y: pp.y + d.dy * t };
    }

    // Floor + targets
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = level.index(x, y);
        if (!level.floor[i]) continue;
        ctx.fillStyle = (x + y) % 2 ? C.floorB : C.floorA;
        ctx.fillRect(x * tile, y * tile, tile, tile);
        ctx.strokeStyle = C.floorLine;
        ctx.lineWidth = 1;
        ctx.strokeRect(x * tile + 0.5, y * tile + 0.5, tile - 1, tile - 1);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = level.index(x, y);
        if (!level.target[i]) continue;
        drawTarget(x, y, now);
      }
    }

    // Walls
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = level.index(x, y);
        if (!level.wall[i] || level.voidCell[i]) continue;
        drawWall(x, y);
      }
    }

    // Boxes
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = level.index(x, y);
        if (!level.box[i] || i === boxFrom) continue;
        drawBox(x, y, !!level.target[i]);
      }
    }
    if (animBox) drawBox(animBox.x, animBox.y, animBox.onTarget);

    drawPlayer(pp.x, pp.y);

    // Confetti
    if (particles.length) {
      const h = canvas.height / dpr;
      for (const p of particles) {
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      particles = particles.filter((p) => p.life > 0 && p.y < h + 40);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawWall(x, y) {
    const px = x * tile;
    const py = y * tile;
    const belowWall = y + 1 < level.height && level.wall[level.index(x, y + 1)] && !level.voidCell[level.index(x, y + 1)];
    const aboveWall = y > 0 && level.wall[level.index(x, y - 1)] && !level.voidCell[level.index(x, y - 1)];
    ctx.fillStyle = C.wallSide;
    ctx.fillRect(px, py, tile, tile);
    const topH = belowWall ? tile : tile * 0.8;
    ctx.fillStyle = C.wallTop;
    ctx.fillRect(px, py, tile, topH);
    if (!aboveWall) {
      ctx.fillStyle = C.wallEdge;
      ctx.fillRect(px, py, tile, Math.max(2, tile * 0.07));
    }
    // subtle brick seam
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(px, py + topH * 0.5, tile, 1);
    ctx.fillRect(px + tile * (y % 2 ? 0.5 : 0.25), py, 1, topH * 0.5);
    ctx.fillRect(px + tile * (y % 2 ? 0.25 : 0.75), py + topH * 0.5, 1, topH * 0.5);
  }

  function drawTarget(x, y, now) {
    const cx = x * tile + tile / 2;
    const cy = y * tile + tile / 2;
    const pulse = 0.5 + 0.5 * Math.sin(now / 500 + x + y);
    ctx.beginPath();
    ctx.arc(cx, cy, tile * (0.3 + pulse * 0.04), 0, Math.PI * 2);
    ctx.fillStyle = C.targetGlow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.24, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, tile * 0.09);
    ctx.strokeStyle = C.target;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = C.target;
    ctx.fill();
  }

  function drawBox(x, y, onTarget) {
    const px = x * tile;
    const py = y * tile;
    const inset = tile * 0.1;
    const s = tile - inset * 2;
    const r = tile * 0.12;
    // shadow
    ctx.fillStyle = C.shadow;
    roundRect(px + inset + tile * 0.04, py + inset + tile * 0.07, s, s, r);
    ctx.fill();
    const fill = onTarget ? C.boxDone : C.box;
    const dark = onTarget ? C.boxDoneDark : C.boxDark;
    const light = onTarget ? C.boxDoneLight : C.boxLight;
    roundRect(px + inset, py + inset, s, s, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(2, tile * 0.07);
    ctx.strokeStyle = dark;
    ctx.stroke();
    // inner frame
    const f = tile * 0.22;
    ctx.lineWidth = Math.max(1.5, tile * 0.045);
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.75;
    ctx.strokeRect(px + f, py + f, tile - f * 2, tile - f * 2);
    // diagonal planks
    ctx.beginPath();
    ctx.moveTo(px + f, py + f);
    ctx.lineTo(px + tile - f, py + tile - f);
    ctx.moveTo(px + tile - f, py + f);
    ctx.lineTo(px + f, py + tile - f);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // highlight
    ctx.strokeStyle = light;
    ctx.lineWidth = Math.max(1, tile * 0.035);
    ctx.beginPath();
    ctx.moveTo(px + inset + r, py + inset + 2);
    ctx.lineTo(px + inset + s - r, py + inset + 2);
    ctx.stroke();
    if (onTarget) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, tile * 0.08);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + tile * 0.34, py + tile * 0.52);
      ctx.lineTo(px + tile * 0.46, py + tile * 0.64);
      ctx.lineTo(px + tile * 0.68, py + tile * 0.38);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  function drawPlayer(x, y) {
    const cx = x * tile + tile / 2;
    const cy = y * tile + tile / 2;
    const r = tile * 0.33;
    const d = window.CrateEngine.DIRS[facing];
    // shadow
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.85, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.shadow;
    ctx.fill();
    // antenna
    ctx.strokeStyle = C.playerDark;
    ctx.lineWidth = Math.max(1.5, tile * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - r - tile * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - r - tile * 0.15, tile * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = C.target;
    ctx.fill();
    // body
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = C.player;
    ctx.fill();
    ctx.lineWidth = Math.max(2, tile * 0.06);
    ctx.strokeStyle = C.playerDark;
    ctx.stroke();
    // eyes (offset toward facing direction)
    const ex = d.dx * r * 0.28;
    const ey = d.dy * r * 0.28;
    const eyeR = r * 0.24;
    for (const side of [-1, 1]) {
      const ox = cx + ex + (d.dy !== 0 ? side * r * 0.4 : 0);
      const oy = cy + ey + (d.dx !== 0 ? side * r * 0.4 : -r * 0.1);
      ctx.beginPath();
      ctx.arc(ox, oy, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ox + d.dx * eyeR * 0.35, oy + d.dy * eyeR * 0.35, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const KEYS = {
    ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r',
    w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r',
  };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const gameVisible = !$('screen-game').classList.contains('hidden');
    const overlayOpen = !!document.querySelector('.overlay:not(.hidden)');
    if (overlayOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleBack();
      } else if (e.key === 'Enter' && !$('overlay-win').classList.contains('hidden')) {
        e.preventDefault();
        nextLevel();
      }
      return;
    }
    if (!gameVisible) return;
    if (KEYS[e.key]) {
      e.preventDefault();
      if (solutionPlaying) return;
      tryMove(KEYS[e.key]);
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
      e.preventDefault();
      undo();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      restartLevel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      showMenu();
    }
  });

  // D-pad: fire on press, repeat while held.
  for (const b of document.querySelectorAll('.dpad-btn')) {
    let timer = null;
    const dir = b.dataset.dir;
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (solutionPlaying) return;
      tryMove(dir);
      stop();
      timer = setInterval(() => tryMove(dir), 160);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Swipe / tap on the board.
  let pointerStart = null;
  canvas.addEventListener('pointerdown', (e) => {
    pointerStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!pointerStart || pointerStart.id !== e.pointerId) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    pointerStart = null;
    if (solutionPlaying) return;
    const dist = Math.hypot(dx, dy);
    if (dist >= 24) {
      tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'd' : 'u');
    } else {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / tile);
      const y = Math.floor((e.clientY - rect.top) / tile);
      walkTo(x, y);
    }
  });
  canvas.addEventListener('pointercancel', () => (pointerStart = null));

  // Buttons
  $('btn-menu').addEventListener('click', showMenu);
  $('btn-undo').addEventListener('click', undo);
  $('btn-restart').addEventListener('click', restartLevel);
  $('btn-solution').addEventListener('click', () => {
    if (solutionPlaying) {
      stopSolution();
      toast('Solution stopped. Undo is disabled until you restart.', 2200);
      $('btn-undo').disabled = true;
      return;
    }
    $('overlay-solution').classList.remove('hidden');
  });
  $('btn-solution-yes').addEventListener('click', playSolution);
  $('btn-solution-no').addEventListener('click', hideOverlays);
  $('btn-win-next').addEventListener('click', nextLevel);
  $('btn-win-replay').addEventListener('click', () => startLevel(def.id));
  $('btn-win-menu').addEventListener('click', showMenu);
  $('btn-continue').addEventListener('click', () => {
    if (solvedCount() === LEVELS.length) startLevel(1);
    else startLevel(isUnlocked(progress.current) ? progress.current : 1);
  });
  $('btn-sound').addEventListener('click', () => {
    progress.sound = !progress.sound;
    saveProgress();
    renderMenu();
    if (progress.sound) audio.play('target');
  });
  $('btn-reset-progress').addEventListener('click', () => $('overlay-reset').classList.remove('hidden'));
  $('btn-reset-no').addEventListener('click', hideOverlays);
  $('btn-reset-yes').addEventListener('click', () => {
    progress.solved = {};
    progress.current = 1;
    saveProgress();
    hideOverlays();
    renderMenu();
  });

  function nextLevel() {
    const next = LEVELS.find((l) => l.id === def.id + 1);
    if (next) startLevel(next.id);
    else showMenu();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 50));

  // Android back button / Escape: returns true if it handled the event.
  function handleBack() {
    if (!$('overlay-win').classList.contains('hidden')) {
      showMenu();
      return true;
    }
    if (document.querySelector('.overlay:not(.hidden)')) {
      hideOverlays();
      return true;
    }
    if (!$('screen-game').classList.contains('hidden')) {
      showMenu();
      return true;
    }
    return false;
  }

  window.CrateQuest = {
    handleBack,
    startLevel,
    showMenu,
    get progress() { return progress; },
    get level() { return level; },
    get definition() { return def; },
    move: (d) => tryMove(d),
    undo,
    restart: restartLevel,
    version: '1.0.0',
  };

  // Boot
  renderMenu();
})();

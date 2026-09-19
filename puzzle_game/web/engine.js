/*
 * Crate Quest - pure game logic (no DOM).
 *
 * Works both in the browser (exposes window.CrateEngine) and in Node
 * (module.exports), so the level generator and the tests share the exact
 * rules the game runs on.
 *
 * Level notation (one string per row, standard Sokoban "XSB" characters):
 *   #  wall          -  void (outside the room, not drawn)
 *   ' ' floor        .  target
 *   $  box           *  box on target
 *   @  player        +  player on target
 *
 * Move notation (standard "LURD"): lowercase = walk, uppercase = push.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CrateEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRS = {
    u: { dx: 0, dy: -1 },
    d: { dx: 0, dy: 1 },
    l: { dx: -1, dy: 0 },
    r: { dx: 1, dy: 0 },
  };

  class Level {
    /**
     * @param {string[]} rows level rows (see notation above)
     */
    constructor(rows) {
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('Level needs at least one row');
      }
      this.height = rows.length;
      this.width = Math.max(...rows.map((r) => r.length));
      const n = this.width * this.height;
      this.wall = new Uint8Array(n); // 1 = wall or void (impassable)
      this.floor = new Uint8Array(n); // 1 = walkable floor (incl. targets)
      this.voidCell = new Uint8Array(n); // 1 = void (not drawn)
      this.target = new Uint8Array(n);
      this.box = new Uint8Array(n);
      this.player = -1;
      this.boxCount = 0;
      this.targetCount = 0;

      for (let y = 0; y < this.height; y++) {
        const row = rows[y];
        for (let x = 0; x < this.width; x++) {
          const ch = x < row.length ? row[x] : '-';
          const i = y * this.width + x;
          switch (ch) {
            case '#':
              this.wall[i] = 1;
              break;
            case '-':
            case '_':
              this.wall[i] = 1;
              this.voidCell[i] = 1;
              break;
            case ' ':
              this.floor[i] = 1;
              break;
            case '.':
              this.floor[i] = 1;
              this.target[i] = 1;
              break;
            case '$':
              this.floor[i] = 1;
              this.box[i] = 1;
              break;
            case '*':
              this.floor[i] = 1;
              this.target[i] = 1;
              this.box[i] = 1;
              break;
            case '@':
              this.floor[i] = 1;
              this.player = i;
              break;
            case '+':
              this.floor[i] = 1;
              this.target[i] = 1;
              this.player = i;
              break;
            default:
              throw new Error(`Unknown level character "${ch}" at ${x},${y}`);
          }
        }
      }
      if (this.player < 0) throw new Error('Level has no player');
      for (let i = 0; i < n; i++) {
        if (this.box[i]) this.boxCount++;
        if (this.target[i]) this.targetCount++;
      }
      if (this.boxCount !== this.targetCount) {
        throw new Error(`Level has ${this.boxCount} boxes but ${this.targetCount} targets`);
      }
      this.initialBox = Uint8Array.from(this.box);
      this.initialPlayer = this.player;
      this.history = [];
      this.moves = 0;
      this.pushes = 0;
    }

    index(x, y) {
      return y * this.width + x;
    }

    xy(i) {
      return { x: i % this.width, y: Math.floor(i / this.width) };
    }

    isWall(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
      return this.wall[this.index(x, y)] === 1;
    }

    isFloor(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
      return this.floor[this.index(x, y)] === 1;
    }

    isTarget(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
      return this.target[this.index(x, y)] === 1;
    }

    hasBox(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
      return this.box[this.index(x, y)] === 1;
    }

    get playerPos() {
      return this.xy(this.player);
    }

    get boxesOnTargets() {
      let c = 0;
      for (let i = 0; i < this.box.length; i++) if (this.box[i] && this.target[i]) c++;
      return c;
    }

    get solved() {
      return this.boxesOnTargets === this.boxCount;
    }

    /**
     * Try to move the player one step.
     * @param {'u'|'d'|'l'|'r'} dir
     * @returns {null | {dir, from, to, pushed:boolean, boxFrom?:number, boxTo?:number}}
     */
    move(dir) {
      const d = DIRS[dir];
      if (!d) throw new Error(`Bad direction "${dir}"`);
      const { x, y } = this.xy(this.player);
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (this.isWall(nx, ny)) return null;
      const to = this.index(nx, ny);
      let rec;
      if (this.box[to]) {
        const bx = nx + d.dx;
        const by = ny + d.dy;
        if (this.isWall(bx, by) || this.hasBox(bx, by)) return null;
        const boxTo = this.index(bx, by);
        this.box[to] = 0;
        this.box[boxTo] = 1;
        rec = { dir, from: this.player, to, pushed: true, boxFrom: to, boxTo };
        this.pushes++;
      } else {
        rec = { dir, from: this.player, to, pushed: false };
      }
      this.player = to;
      this.moves++;
      this.history.push(rec);
      return rec;
    }

    /** Undo the last move. Returns the undone record or null. */
    undo() {
      const rec = this.history.pop();
      if (!rec) return null;
      this.player = rec.from;
      this.moves--;
      if (rec.pushed) {
        this.box[rec.boxTo] = 0;
        this.box[rec.boxFrom] = 1;
        this.pushes--;
      }
      return rec;
    }

    reset() {
      this.box.set(this.initialBox);
      this.player = this.initialPlayer;
      this.history = [];
      this.moves = 0;
      this.pushes = 0;
    }

    /** Cells the player can walk to without pushing anything (as indices). */
    reachable() {
      const n = this.width * this.height;
      const seen = new Uint8Array(n);
      const queue = [this.player];
      seen[this.player] = 1;
      const w = this.width;
      while (queue.length) {
        const i = queue.pop();
        const x = i % w;
        const y = (i - x) / w;
        for (const k in DIRS) {
          const nx = x + DIRS[k].dx;
          const ny = y + DIRS[k].dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= this.height) continue;
          const j = ny * w + nx;
          if (seen[j] || this.wall[j] || this.box[j]) continue;
          seen[j] = 1;
          queue.push(j);
        }
      }
      return seen;
    }

    /**
     * Shortest walking path (no pushes) from the player to cell (x, y).
     * @returns {string[] | null} list of directions or null if unreachable
     */
    pathTo(x, y) {
      if (!this.isFloor(x, y)) return null;
      const goal = this.index(x, y);
      if (goal === this.player) return [];
      if (this.box[goal]) return null;
      const n = this.width * this.height;
      const prev = new Int32Array(n).fill(-1);
      const prevDir = new Array(n);
      const seen = new Uint8Array(n);
      const queue = [this.player];
      seen[this.player] = 1;
      const w = this.width;
      let head = 0;
      while (head < queue.length) {
        const i = queue[head++];
        if (i === goal) break;
        const x0 = i % w;
        const y0 = (i - x0) / w;
        for (const k of ['u', 'd', 'l', 'r']) {
          const nx = x0 + DIRS[k].dx;
          const ny = y0 + DIRS[k].dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= this.height) continue;
          const j = ny * w + nx;
          if (seen[j] || this.wall[j] || this.box[j]) continue;
          seen[j] = 1;
          prev[j] = i;
          prevDir[j] = k;
          queue.push(j);
        }
      }
      if (!seen[goal]) return null;
      const path = [];
      for (let i = goal; i !== this.player; i = prev[i]) path.push(prevDir[i]);
      path.reverse();
      return path;
    }

    /** Render the current state back to rows (handy for debugging/tests). */
    toRows() {
      const rows = [];
      for (let y = 0; y < this.height; y++) {
        let s = '';
        for (let x = 0; x < this.width; x++) {
          const i = this.index(x, y);
          let ch;
          if (this.voidCell[i]) ch = '-';
          else if (this.wall[i]) ch = '#';
          else if (this.player === i) ch = this.target[i] ? '+' : '@';
          else if (this.box[i]) ch = this.target[i] ? '*' : '$';
          else ch = this.target[i] ? '.' : ' ';
          s += ch;
        }
        rows.push(s);
      }
      return rows;
    }
  }

  /**
   * Replay a LURD solution string on a fresh copy of the level.
   * @returns {{ok:boolean, moves:number, pushes:number, failedAt?:number}}
   */
  function replay(rows, solution) {
    const level = new Level(rows);
    for (let i = 0; i < solution.length; i++) {
      const ch = solution[i].toLowerCase();
      const rec = level.move(ch);
      if (!rec) return { ok: false, moves: level.moves, pushes: level.pushes, failedAt: i };
      const wantPush = solution[i] === solution[i].toUpperCase();
      if (rec.pushed !== wantPush) {
        return { ok: false, moves: level.moves, pushes: level.pushes, failedAt: i };
      }
    }
    return { ok: level.solved, moves: level.moves, pushes: level.pushes };
  }

  return { Level, DIRS, replay };
});

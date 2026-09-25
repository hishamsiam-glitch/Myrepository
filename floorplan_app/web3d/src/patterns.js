// Procedural surface patterns drawn on a 2D canvas and used as repeating
// textures. Every pattern is tinted by the skin colour so "brick" can be
// red, grey or white brick. Keep the names in sync with kPatterns in
// lib/widgets/skin_editor.dart.

const SIZE = 512;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToCss([r, g, b], a = 1) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

// amount > 0 lightens towards white, < 0 darkens towards black.
function shade(rgb, amount) {
  return rgb.map((c) => (amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)));
}

// Small deterministic PRNG so textures look the same on every load.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  return c;
}

function noise(ctx, base, amount, count, rand) {
  for (let i = 0; i < count; i++) {
    const v = (rand() - 0.5) * 2 * amount;
    ctx.fillStyle = rgbToCss(shade(base, v), 0.35);
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 2 + rand() * 3, 2 + rand() * 3);
  }
}

const painters = {
  brick(ctx, base, rand) {
    const rows = 8;
    const cols = 4;
    const bh = SIZE / rows;
    const bw = SIZE / cols;
    const mortar = 5;
    ctx.fillStyle = rgbToCss(shade(base, 0.55));
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c <= cols; c++) {
        const x = c * bw + off;
        const y = r * bh;
        ctx.fillStyle = rgbToCss(shade(base, (rand() - 0.5) * 0.25));
        ctx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar);
      }
    }
    noise(ctx, base, 0.2, 1500, rand);
  },

  tile(ctx, base, rand) {
    const n = 4;
    const s = SIZE / n;
    const grout = 6;
    ctx.fillStyle = rgbToCss(shade(base, -0.45));
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const g = ctx.createLinearGradient(i * s, j * s, (i + 1) * s, (j + 1) * s);
        g.addColorStop(0, rgbToCss(shade(base, 0.12 + rand() * 0.05)));
        g.addColorStop(1, rgbToCss(shade(base, -0.08 + rand() * 0.05)));
        ctx.fillStyle = g;
        ctx.fillRect(i * s + grout / 2, j * s + grout / 2, s - grout, s - grout);
      }
    }
  },

  wood(ctx, base, rand) {
    const planks = 6;
    const ph = SIZE / planks;
    for (let p = 0; p < planks; p++) {
      const tone = (rand() - 0.5) * 0.3;
      ctx.fillStyle = rgbToCss(shade(base, tone));
      ctx.fillRect(0, p * ph, SIZE, ph);
      // Grain.
      for (let i = 0; i < 18; i++) {
        ctx.strokeStyle = rgbToCss(shade(base, tone - 0.15 - rand() * 0.15), 0.5);
        ctx.lineWidth = 1 + rand();
        ctx.beginPath();
        const y = p * ph + rand() * ph;
        ctx.moveTo(0, y);
        for (let x = 0; x <= SIZE; x += 32) {
          ctx.lineTo(x, y + Math.sin(x / 60 + rand()) * 3);
        }
        ctx.stroke();
      }
      // Seam and staggered end joints.
      ctx.fillStyle = rgbToCss(shade(base, -0.55));
      ctx.fillRect(0, p * ph, SIZE, 3);
      const joint = rand() * SIZE;
      ctx.fillRect(joint, p * ph, 3, ph);
    }
  },

  parquet(ctx, base, rand) {
    // Basket-weave: 4x4 blocks, each block holds 4 planks, alternating
    // orientation.
    const n = 4;
    const s = SIZE / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const horizontal = (i + j) % 2 === 0;
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = rgbToCss(shade(base, (rand() - 0.5) * 0.3));
          if (horizontal) ctx.fillRect(i * s, j * s + (k * s) / 4, s, s / 4);
          else ctx.fillRect(i * s + (k * s) / 4, j * s, s / 4, s);
          ctx.strokeStyle = rgbToCss(shade(base, -0.5));
          ctx.lineWidth = 2;
          if (horizontal) ctx.strokeRect(i * s, j * s + (k * s) / 4, s, s / 4);
          else ctx.strokeRect(i * s + (k * s) / 4, j * s, s / 4, s);
        }
      }
    }
  },

  stripes(ctx, base) {
    const n = 8;
    const w = SIZE / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rgbToCss(i % 2 ? shade(base, 0.4) : base);
      ctx.fillRect(i * w, 0, w, SIZE);
    }
  },

  plaster(ctx, base, rand) {
    ctx.fillStyle = rgbToCss(base);
    ctx.fillRect(0, 0, SIZE, SIZE);
    noise(ctx, base, 0.12, 6000, rand);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = rgbToCss(shade(base, (rand() - 0.5) * 0.2), 0.25);
      ctx.lineWidth = 8 + rand() * 20;
      ctx.beginPath();
      ctx.arc(rand() * SIZE, rand() * SIZE, 20 + rand() * 60, 0, Math.PI * 2 * rand());
      ctx.stroke();
    }
  },

  concrete(ctx, base, rand) {
    ctx.fillStyle = rgbToCss(base);
    ctx.fillRect(0, 0, SIZE, SIZE);
    noise(ctx, base, 0.25, 9000, rand);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = rgbToCss(shade(base, -0.25), 0.25);
      ctx.beginPath();
      ctx.arc(rand() * SIZE, rand() * SIZE, 1 + rand() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Formwork lines.
    ctx.strokeStyle = rgbToCss(shade(base, -0.35), 0.6);
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, SIZE - 3, SIZE - 3);
  },

  marble(ctx, base, rand) {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, rgbToCss(shade(base, 0.2)));
    g.addColorStop(1, rgbToCss(shade(base, -0.05)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = rgbToCss(shade(base, -0.45), 0.25 + rand() * 0.3);
      ctx.lineWidth = 0.5 + rand() * 2;
      ctx.beginPath();
      let x = rand() * SIZE;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < SIZE) {
        x += (rand() - 0.5) * 60;
        y += 20 + rand() * 40;
        ctx.quadraticCurveTo(x + (rand() - 0.5) * 40, y - 20, x, y);
      }
      ctx.stroke();
    }
  },

  hex(ctx, base, rand) {
    ctx.fillStyle = rgbToCss(shade(base, -0.5));
    ctx.fillRect(0, 0, SIZE, SIZE);
    const r = SIZE / 8; // circumradius
    const w = Math.sqrt(3) * r;
    const h = 1.5 * r;
    for (let row = -1; row < SIZE / h + 1; row++) {
      for (let col = -1; col < SIZE / w + 1; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0);
        const cy = row * h;
        ctx.fillStyle = rgbToCss(shade(base, (rand() - 0.5) * 0.2));
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const px = cx + (r - 3) * Math.cos(a);
          const py = cy + (r - 3) * Math.sin(a);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  },

  checker(ctx, base) {
    const n = 4;
    const s = SIZE / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = rgbToCss((i + j) % 2 ? shade(base, 0.6) : base);
        ctx.fillRect(i * s, j * s, s, s);
      }
    }
  },

  stone(ctx, base, rand) {
    ctx.fillStyle = rgbToCss(shade(base, -0.5));
    ctx.fillRect(0, 0, SIZE, SIZE);
    const rows = 5;
    const rh = SIZE / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 60;
      while (x < SIZE) {
        const w = 60 + rand() * 90;
        ctx.fillStyle = rgbToCss(shade(base, (rand() - 0.5) * 0.35));
        const inset = 4;
        ctx.beginPath();
        ctx.roundRect(x + inset, r * rh + inset, w - inset * 2, rh - inset * 2, 10);
        ctx.fill();
        x += w;
      }
    }
    noise(ctx, base, 0.15, 2500, rand);
  },

  wallpaper(ctx, base, rand) {
    ctx.fillStyle = rgbToCss(shade(base, 0.15));
    ctx.fillRect(0, 0, SIZE, SIZE);
    const n = 4;
    const s = SIZE / n;
    ctx.fillStyle = rgbToCss(shade(base, -0.2), 0.7);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = i * s + s / 2 + ((j % 2) * s) / 2;
        const cy = j * s + s / 2;
        // A simple four-petal motif.
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(a) * s * 0.16, cy + Math.sin(a) * s * 0.16, s * 0.16, s * 0.08, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    void rand;
  },
};

export const PATTERN_NAMES = Object.keys(painters);

/** Returns a canvas with the named pattern tinted by `colorHex`. */
export function makePattern(name, colorHex) {
  const paint = painters[name] || painters.plaster;
  const c = canvas();
  const ctx = c.getContext('2d');
  const base = hexToRgb(colorHex || '#cccccc');
  let seed = 7;
  for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  paint(ctx, base, rng(seed));
  return c;
}

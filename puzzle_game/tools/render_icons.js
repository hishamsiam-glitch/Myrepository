#!/usr/bin/env node
/*
 * Renders the launcher icons (all densities, legacy + adaptive foreground),
 * the 512px Play Store icon and the 1024x500 feature graphic from
 * web/icon.svg using headless Chromium (Playwright).
 *
 * Usage: node tools/render_icons.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const STORE = path.join(ROOT, 'store_assets');
const svg = fs.readFileSync(path.join(ROOT, 'web', 'icon.svg'), 'utf8');

// Legacy icon: the full artwork with a rounded dark background.
// Adaptive foreground: artwork scaled into the 66/108 safe zone, transparent.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function page(html, w, h) {
  return `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body style="width:${w}px;height:${h}px">${html}</body></html>`;
}

async function shoot(browser, html, w, h, out, transparent) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(page(html, w, h));
  await p.screenshot({ path: out, omitBackground: !!transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await p.close();
  console.log('wrote', path.relative(ROOT, out));
}

(async () => {
  const browser = await chromium.launch();
  const legacy = (s) => svg.replace(/width="108" height="108"/, `width="${s}" height="${s}"`);
  const foregroundSvg = svg.replace(/<rect width="108" height="108" rx="24" fill="#0f172a"\/>/, '');
  const foreground = (s) =>
    `<div style="width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center">` +
    foregroundSvg.replace(/width="108" height="108"/, `width="${Math.round(s * 0.62)}" height="${Math.round(s * 0.62)}"`) +
    '</div>';

  for (const [name, scale] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    await shoot(browser, legacy(48 * scale), 48 * scale, 48 * scale, path.join(dir, 'ic_launcher.png'), true);
    await shoot(browser, foreground(108 * scale), 108 * scale, 108 * scale, path.join(dir, 'ic_launcher_foreground.png'), true);
  }

  fs.mkdirSync(STORE, { recursive: true });
  await shoot(browser, legacy(512), 512, 512, path.join(STORE, 'icon_512x512.png'), false);

  const feature = `
    <div style="width:1024px;height:500px;background:radial-gradient(ellipse at 30% 40%, #1e2a48 0%, #0f172a 70%);display:flex;align-items:center;padding:0 80px;box-sizing:border-box;font-family:system-ui,Roboto,sans-serif;color:#e2e8f0">
      ${legacy(260)}
      <div style="margin-left:60px">
        <div style="font-size:84px;font-weight:800;letter-spacing:1px;line-height:1">Crate Quest</div>
        <div style="font-size:34px;color:#f59e0b;margin-top:18px;font-weight:600">100 levels &middot; easy to brain-melting</div>
        <div style="font-size:24px;color:#94a3b8;margin-top:14px">Push every crate onto a glowing pad. Offline, no ads.</div>
      </div>
    </div>`;
  await shoot(browser, feature, 1024, 500, path.join(STORE, 'feature_graphic_1024x500.png'), false);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

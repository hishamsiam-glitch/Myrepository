// Renders tool/icon.svg into the Android launcher mipmaps. Run from
// floorplan_app/tool with: node gen_icons.mjs (needs web3d/node_modules).
import { chromium } from '../web3d/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [dpi, size] of Object.entries(sizes)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="192" height="192"', `width="${size}" height="${size}"`)}</body></html>`);
  const out = path.join(here, '..', 'android', 'app', 'src', 'main', 'res', `mipmap-${dpi}`, 'ic_launcher.png');
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', path.relative(process.cwd(), out));
}
// Store-listing size icon too.
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(`<html><body style="margin:0">${svg.replace('width="192" height="192"', 'width="512" height="512"')}</body></html>`);
await page.screenshot({ path: path.join(here, 'icon_512.png'), clip: { x: 0, y: 0, width: 512, height: 512 } });
await browser.close();

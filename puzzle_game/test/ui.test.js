#!/usr/bin/env node
/*
 * Browser smoke test with Playwright + headless Chromium: loads the game,
 * solves level 1 with the keyboard, plays the shipped solution of level 2,
 * checks progress persistence and the Android back handler.
 *
 * Usage: node test/ui.test.js   (needs `npm install` or a global playwright)
 */
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(WEB, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      if (!file.startsWith(WEB) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('ok   ' + msg);
  else {
    failures++;
    console.log('FAIL ' + msg);
  }
};

(async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(url);
  await page.waitForSelector('#worlds .level-btn');
  const count = await page.locator('.level-btn').count();
  check(count === 100, `menu shows 100 level buttons (${count})`);
  check((await page.locator('.level-btn.locked').count()) === 99, 'only level 1 unlocked at first');

  // Level 1: play the shipped solution with the keyboard.
  await page.click('.level-btn[data-level="1"]');
  await page.waitForSelector('#screen-game:not(.hidden)');
  const sol1 = await page.evaluate(() => window.CrateQuest.definition.solution);
  const keyFor = { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight' };
  for (const ch of sol1.toLowerCase()) {
    await page.keyboard.press(keyFor[ch]);
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('#overlay-win:not(.hidden)', { timeout: 5000 });
  check(true, 'level 1 solved with the keyboard shows the win dialog');
  const title = await page.textContent('#win-title');
  check(/Level 1 complete/.test(title), `win title: ${title.trim()}`);

  // Next level via the dialog.
  await page.click('#btn-win-next');
  await page.waitForFunction(() => window.CrateQuest.definition && window.CrateQuest.definition.id === 2);
  check(true, 'next-level button opens level 2');

  // Undo / restart.
  const first = sol1[0].toLowerCase();
  await page.evaluate(() => window.CrateQuest.move('r'));
  await page.waitForTimeout(250);
  await page.keyboard.press('z');
  const movesAfterUndo = await page.evaluate(() => window.CrateQuest.level.moves);
  check(movesAfterUndo === 0, `undo returns to 0 moves (${movesAfterUndo}, first move ${first})`);

  // Watch the solution for level 2.
  await page.click('#btn-solution');
  await page.waitForSelector('#overlay-solution:not(.hidden)');
  await page.click('#btn-solution-yes');
  await page.waitForSelector('#overlay-win:not(.hidden)', { timeout: 60000 });
  const title2 = await page.textContent('#win-title');
  check(/solved with help/.test(title2), `solution playback completes level 2 (${title2.trim()})`);

  // Progress persisted and unlocks.
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('crateQuest.v1')));
  check(progress.solved['1'] && progress.solved['1'].assisted === false, 'level 1 stored as solved without help');
  check(progress.solved['2'] && progress.solved['2'].assisted === true, 'level 2 stored as solved with help');

  // Android back handler: closes dialog -> menu -> nothing.
  const back1 = await page.evaluate(() => window.CrateQuest.handleBack());
  check(back1 === true, 'back from win dialog handled');
  await page.waitForSelector('#screen-menu:not(.hidden)');
  const back2 = await page.evaluate(() => window.CrateQuest.handleBack());
  check(back2 === false, 'back on the menu is not handled (app may exit)');
  check((await page.locator('.level-btn.locked').count()) === 97, 'levels 1-3 unlocked after solving 1 and 2');

  // Reload keeps progress.
  await page.reload();
  await page.waitForSelector('#worlds .level-btn');
  check((await page.textContent('#progress-text')).trim() === '2 / 100', 'progress survives reload');

  // Tap-to-walk on the canvas (level 3): tap the player's own tile does nothing harmful,
  // tap a reachable floor tile walks there.
  await page.click('.level-btn[data-level="3"]');
  await page.waitForSelector('#screen-game:not(.hidden)');
  const walked = await page.evaluate(() => {
    const lvl = window.CrateQuest.level;
    const seen = lvl.reachable();
    for (let i = 0; i < seen.length; i++) {
      if (seen[i] && i !== lvl.player) {
        const { x, y } = lvl.xy(i);
        return { x, y };
      }
    }
    return null;
  });
  const box = await page.locator('#board').boundingBox();
  const tile = await page.evaluate(() => parseFloat(document.getElementById('board').style.width) / window.CrateQuest.level.width);
  await page.mouse.click(box.x + (walked.x + 0.5) * tile, box.y + (walked.y + 0.5) * tile);
  await page.waitForTimeout(1500);
  const pos = await page.evaluate(() => window.CrateQuest.level.playerPos);
  check(pos.x === walked.x && pos.y === walked.y, `tap-to-walk moved the player to ${walked.x},${walked.y}`);

  // Every level renders without throwing.
  const renderErrors = await page.evaluate(async () => {
    const bad = [];
    for (let id = 1; id <= 100; id++) {
      try {
        window.CrateQuest.progress.solved[id - 1] = window.CrateQuest.progress.solved[id - 1] || { moves: 1, pushes: 1, assisted: true };
        window.CrateQuest.startLevel(id);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (window.CrateQuest.definition.id !== id) bad.push(id);
      } catch (e) {
        bad.push(id + ':' + e.message);
      }
    }
    return bad;
  });
  check(renderErrors.length === 0, `all 100 levels open and render (${renderErrors.join(', ') || 'none failed'})`);

  await page.screenshot({ path: path.join(__dirname, 'screenshot-ui.png') });
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);

  await browser.close();
  server.close();
  if (failures) {
    console.log(`\n${failures} UI check(s) failed`);
    process.exit(1);
  }
  console.log('\nUI smoke test passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

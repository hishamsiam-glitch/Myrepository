# Space Invaders 3D

A 100-level 3D take on the arcade classic, steered by tilting your phone.
Pure web: one folder of static files, no build step, no server code.

## Play it

The game must be served over **HTTPS** (or `localhost`) because browsers
only expose the orientation sensors on secure pages.

* **GitHub Pages** – the `Deploy Space Invaders 3D` workflow in
  `.github/workflows/deploy-pages.yml` publishes this folder. Enable it once
  in the repository: *Settings → Pages → Build and deployment → Source:
  GitHub Actions*. The game is then at
  `https://<owner>.github.io/<repo>/`.
* **Locally** – `npx http-server space-invaders-3d -p 8080` and open
  `http://localhost:8080` on the same machine, or use any static server with
  HTTPS to reach it from a phone on your network.

Open it on the phone, tap **ENABLE TILT CONTROLS** (iOS asks for
permission), and go. Use **FULLSCREEN** or *Add to Home Screen* for a
full-screen arcade feel.

## Controls

| Input | Steer | Depth | Fire |
|-------|-------|-------|------|
| Phone sensors | tilt left / right | tilt forward / back | tap (hold for auto-fire) |
| Touch fallback | drag horizontally | – | tap |
| Keyboard | ← → or A D | ↑ ↓ or W S | Space (P pauses) |

The tilt centre is captured when sensors are enabled and can be re-captured
any time with the **⌖ CENTRE** button in the HUD, the pause menu, or
Settings. Sensitivity, inverted tilt, auto-fire, sound and the forward/back
axis are all in Settings and persist on the device.

## The 100 levels

`levels.js` generates every level from a few curves rather than a hand-made
list, so difficulty ramps smoothly:

* **Formation** grows from 3×6 to 6×9, and speeds up as it thins out.
* **Enemy fire** gets denser (interval 1.15 s → 0.14 s, up to 9 bullets in
  flight), faster, and in later sectors partly aimed at you.
* **Shields** drop from 4 to 1 and are ground away by invaders passing
  through them.
* **Invader types**: squid (30), crab (20), octopus (10), and from sector 4
  an armoured top row (40, two hits), from sector 8 phantoms (60, three
  hits).
* **Boss saucer** on every 10th level with a growing HP pool and spread
  shots; the mystery UFO crosses on the other levels.
* **Ten sectors** of ten levels, each with its own name, palette and a
  score multiplier equal to its number (×1 … ×10).

The full table is viewable in-game under **100 LEVELS**.

## Score card and score log

Just like the cabinet:

* **HIGH SCORES** – top-ten table with three-letter initials, level
  reached and date. Qualifying games get the arcade letter-wheel entry
  screen.
* **SCORE LOG** – every game played (last 50): date, score, level, invaders
  destroyed, duration, how it ended (game over / victory / quit) and which
  control scheme was used, plus lifetime totals.
* **CONTINUE** on the title screen restarts from the deepest level you have
  reached (score starts from zero, so the table stays honest).

Everything is stored in the browser's `localStorage` on the device.

## Files

```
index.html            Markup for the HUD and all screens
style.css             Arcade styling
main.js               Entry point (WebGL check)
game.js               Three.js scene, entities, game state machine, UI
levels.js             Level generator (100 levels, 10 sectors)
scores.js             High-score table, score log, settings persistence
input.js              Phone sensors, touch and keyboard input
audio.js              WebAudio synthesised sound effects
vendor/three.module.js  Three.js r170 (MIT, see THREE-LICENSE.txt)
manifest.webmanifest  PWA manifest (fullscreen, portrait)
```

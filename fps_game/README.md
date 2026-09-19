# Gyro Strike

A first-person shooter for phones, played in landscape and steered with the
phone's motion sensors: turn your body (and the phone) to aim, tilt the phone
to walk and strafe, tap to fire. Fight through eight zones of a compound to
the extraction pad, saving progress at checkpoints along the way, with
missions in some zones that must be completed to open the gates.

It is an HTML5 / WebGL game (Three.js) wrapped in a small native Android app
that feeds the game the phone's rotation sensor, so the same code also runs
in a mobile browser.

## Get the APK

The **FPS game** workflow builds the Android app on every push and publishes
the APK as a GitHub Release named **fps-sideload-latest**:

https://github.com/hishamsiam-glitch/Myrepository/releases/tag/fps-sideload-latest

Download `gyro-strike.apk` on the phone, open it, and allow installs from your
browser when asked. It is debug-signed (fine for sideloading, not for the Play
Store), needs Android 8.0 or newer, is landscape-only and plays best on a phone
with a gyroscope (any phone from the last decade). No permissions are
requested beyond vibration.

## Controls

Hold the phone in landscape in front of you like a window into the world.
Tap the &#x27F3; button at any time to make your current pose the neutral one.

| Action | Tilt scheme (default) | Gyro look scheme | Touch scheme |
| --- | --- | --- | --- |
| Turn / aim | Rotate the phone left / right | Rotate the phone left / right | Drag on the right half |
| Look up / down | Auto (aim stays level, hostiles are hit at any height) | Tilt the phone up / down | Drag on the right half |
| Walk | Tip the top edge away from you (forward) or towards you (back) | Hold the left half of the screen; slide the finger down to back up | Left-half virtual stick |
| Strafe | Tilt the phone left / right (right edge down = step right) | Same | Left-half virtual stick |
| Fire | FIRE button or touch anywhere on the right half | Same | FIRE button |
| Pause | &#x23F8; button or the Android back button | | |

Settings (title screen or pause menu) let you pick the scheme, turn
sensitivity (how much the view turns per degree the phone turns, default
1.5x so you never need to turn all the way around), tilt range, inverted
pitch/strafe, sound and vibration. On a desktop: WASD to move, arrow keys or
mouse (click the view to lock it) to look, Space to fire, R to recenter, Esc
to pause.

## Gameplay

- **Zones and checkpoints.** The compound is eight rooms in a snake. Each
  room's hostiles spawn when you enter it. Walking through a glowing cyan
  ring is a checkpoint: your health, ammo, score, kills, cleared rooms,
  collected pickups, completed missions and opened gates are saved on the
  device. Dying or failing a mission puts you back at the last checkpoint
  with exactly that saved state, and **Continue** on the title screen
  resumes there after the app is closed.
- **Missions.** Four of the zones start a mission when you enter them:
  - *Clear the hangar* - destroy all six hostiles; opens gate A.
  - *Recover the data cores* - collect three cores within 90 s; opens gate B.
  - *Race to the relay* - reach the relay in the reactor hall within 75 s.
  - *Hold the extraction pad* - survive 45 s of waves; brings the
    extraction beacon online. Step onto the beacon to finish.
  The mission panel (top right) shows progress and the timer; the arrow at
  the top of the screen always points at the current objective.
- **Enemies.** Drones hover at eye height and shoot; crawlers rush you and
  bite; heavies soak damage and fire bursts. Yellow pickups give ammo, green
  give health, cyan are data cores.

## Project layout

```
index.html        Page, HUD and menu markup
css/style.css     HUD / overlay styling
js/lib/three.min.js  Three.js r186 (MIT), bundled as a single ES module
js/level.js       Level layout, collision, grid raycasts, flow-field pathing (pure, unit-tested)
js/sensors.js     Rotation-matrix maths shared by the Android bridge and DeviceOrientation
js/input.js       Control schemes: sensors + touch + keyboard -> movement/aim
js/entities.js    Enemy AI, projectiles, pickups, checkpoints, gates, particles, weapon
js/audio.js       Synthesised sound effects (WebAudio)
js/save.js        Storage through the Android bridge or localStorage
js/game.js        Game loop, player, missions, checkpoints, HUD, screens
test/             Node unit test for the level + Playwright end-to-end smoke test
android/          Android WebView wrapper app (builds the sideload APK)
```

### How the sensors reach the game

`android/.../GameBridge.java` registers the game rotation vector sensor
(gyroscope fused with the accelerometer) and exposes it to the page as
`window.AndroidBridge.getSensors()`, which returns the 3x3 rotation matrix
and the current display rotation. `js/sensors.js` turns that matrix into a
heading (turn), pitch (tilt forward/back) and roll (tilt sideways) that stay
continuous however the phone is held. In a browser the same maths runs on
`deviceorientation` events. Saves go through the bridge to
`SharedPreferences` in the APK and to `localStorage` in a browser.

## Running the web version

Any static file server works:

```bash
cd fps_game
npx http-server . -p 8080
```

Then open `http://<your computer's LAN IP>:8080/` on the phone in landscape.
iOS only delivers orientation events on `https://` pages, so for an iPhone
serve over HTTPS.

## Tests

```bash
cd fps_game
npm install                        # installs playwright
npx playwright install chromium    # or: CHROMIUM_PATH=/path/to/chrome
npm test
```

`test/level.test.js` checks the layout (every spawn on open floor, gates
really block, everything reachable once they open, collision sliding).
`test/smoke.test.js` runs the game in headless Chromium with a mocked
Android sensor bridge and drives it through the whole campaign: tilt to
walk, turning, strafing, gyro pitch, shooting, a checkpoint save, all four
missions (including a timed failure and retry), a reload with Continue,
death and respawn, and extraction. It also saves screenshots next to itself.

## Building the APK yourself

With the Android SDK installed:

```bash
cd fps_game/android
gradle assembleRelease   # or ./gradlew if you add a wrapper
# -> app/build/outputs/apk/release/app-release.apk
```

The web files are copied into the APK at build time, so there is a single
source for both the web and Android versions.

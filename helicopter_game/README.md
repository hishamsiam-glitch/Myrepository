# Skyline Heli

A helicopter game for phones. You steer by tilting the phone and fly
forward by holding a finger anywhere on the screen, over an endless,
procedurally generated world of oceans, beaches, grassland, forests,
deserts, canyons, hills, mountains and snow peaks.

It is a single HTML5 canvas page with no build step and no dependencies,
so it runs in any modern mobile browser (Chrome, Samsung Internet, Safari)
and can be added to the home screen as a web app.

## Controls

| Action | Control |
| --- | --- |
| Move forward | Hold a finger anywhere on the screen. Lift it to slow to a hover. |
| Turn left / right | Roll the phone left / right. |
| Climb / descend | Tip the top of the phone towards you to climb, away from you to descend (invertible in the start menu). |
| Reset neutral tilt | Tap the &#x27F3; button (or press `c`). The pose you hold when tapping Start is the initial neutral. |
| Pause | Tap &#x23F8; (or `p` / `Esc`). The game also pauses when the tab is hidden. |

Without a tilt sensor (desktop, or permission denied on iOS) you can drag
on the screen to steer, or use the arrow keys / WASD with space to fly.

## Gameplay

- **Stay above the terrain.** The ALT gauge on the right shows your
  altitude (yellow marker) and the height of the ground beneath you (brown
  fill). Hills, canyons, mountains and snow peaks all have height; water and
  lowlands do not. The helicopter's shadow also closes in as the ground
  rises. Hitting terrain ends the run.
- **Fuel.** Flying burns fuel, climbing burns a little more. Fly low over
  the red fuel cans to refuel. If the tank runs dry the engine stops and
  the helicopter sinks to the ground.
- **Rings.** Golden rings float at a fixed altitude. The label on each ring
  tells you how far to climb (&#x25B2;) or descend (&#x25BC;) to pass
  through it; it turns white and says OK when you are at its altitude.
- **Score** = distance flown + 50 per fuel can + 100 per ring. Your best
  score is kept on the device.

Every run generates a fresh world. Add `?seed=<number>` to the URL to
replay a specific one.

## Android APK

`android/` is a small native Android app that bundles the game in a
full-screen WebView. The `Helicopter game` workflow builds it on every
push and publishes the APK as a GitHub Release named
**heli-sideload-latest**:

https://github.com/hishamsiam-glitch/Myrepository/releases/tag/heli-sideload-latest

Download `skyline-heli.apk` on the phone, open it, and allow installs from
your browser when asked. It is debug-signed (fine for sideloading, not for
the Play Store) and needs Android 8.0 or newer. The tilt sensors need no
permission on Android.

To build it yourself, with the Android SDK installed:

```bash
cd helicopter_game/android
gradle assembleRelease   # or ./gradlew if you add a wrapper
# -> app/build/outputs/apk/release/app-release.apk
```

The web files are copied into the APK at build time, so there is a single
source for both the web and Android versions.

## Running it

Any static file server works, for example:

```bash
cd helicopter_game
npx http-server . -p 8080
```

Then open `http://<your computer's LAN IP>:8080/` on the phone. Note that
iOS only delivers orientation events on `https://` pages or `localhost`, so
for iPhone testing serve over HTTPS or use the GitHub Pages deployment.

### GitHub Pages

The `Helicopter game` workflow in `.github/workflows/helicopter-game.yml`
runs the smoke test and publishes this folder to GitHub Pages on every
push, at `https://<owner>.github.io/<repo>/`. The deploy job only works
once Pages has been enabled by the repository owner: **Settings -> Pages
-> Build and deployment -> Source: GitHub Actions**. Until then the deploy
job is skipped as a non-blocking failure and the test job still reports
the result.

## Tests

`test/smoke.test.js` drives the game in headless Chromium with synthetic
tilt and touch events and checks the core mechanics: hovering without a
finger, forward flight while holding, turning with roll tilt, climbing with
pitch tilt, fuel consumption, slowing to a hover, terrain crashes, restart
and biome variety.

```bash
cd helicopter_game
npm install          # installs playwright
npx playwright install chromium
npm test
```

## Project layout

```
index.html       Page, HUD and menu markup
css/style.css    HUD / overlay styling
js/noise.js      Seeded value noise + fBm
js/terrain.js    Elevation / moisture fields, biomes, ground height,
                 chunked terrain renderer, pickup placement
js/input.js      Tilt sensor mapping (with screen-rotation handling and
                 iOS permission flow), hold-to-fly touch, keyboard/drag fallback
js/audio.js      Synthesised rotor hum and effect sounds (WebAudio)
js/heli.js       Helicopter sprite + shadow
js/game.js       Physics, camera, rendering, HUD, screens
test/            Playwright smoke test
android/         Android WebView wrapper app (builds the sideload APK)
```

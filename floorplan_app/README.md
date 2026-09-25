# Floor Plan Tracer

An Android app that traces a floor plan with the phone camera, measures it,
lets you mark doors, windows and openings, turns the plan into an editable
3D model, and dresses the walls and floor in colours, patterns or your own
photos.

**Download the APK:** every push to this folder builds the app on GitHub
Actions and publishes it as the `floorplan-latest` release. Open the
repository's *Releases* page on your phone and install
`app-arm64-v8a-release.apk` (see [docs/FLOORPLAN_TRACER.md](../docs/FLOORPLAN_TRACER.md)).

## What it does

| Step | Where | How |
| --- | --- | --- |
| Trace a room with the camera | *Trace with camera* | ARCore tracks the phone. Aim the centre reticle at a floor corner and tap **Add corner**; walk along the wall and add the next corner. Distances are measured live. |
| Declare doors, windows, openings | While tracing, or later in the editor | Aim at one edge, tap **Door** (or **Window** / **Opening**), aim at the other edge, tap again. In the 2D editor tap a wall with the Door/Window/Opening tool. |
| Trace a paper plan | *Draw or trace a photo* → menu → *Photograph a paper plan* | Tap two points with a known real distance to set the scale, then tap corners with the Wall tool. |
| Draw by hand | *Draw or trace a photo* | Tap corners on the metre grid. Snaps to right angles and existing corners. |
| Change sizes | 2D editor or 3D view | Drag corners, or tap a wall and type its exact length, height and thickness; edit each opening's position, width, height and sill. *Set height of all walls* is in the menu. |
| Convert to 3D | **3D** button | Walls become solid boxes with real openings (glazed windows, doors with a leaf), and closed rooms get a floor slab. Orbit, pinch-zoom and pan. |
| Skins | 3D view | Tap a wall (or the floor) and choose a colour, a tinted pattern (brick, tiles, wood, parquet, stone, marble, plaster, …) or an image from the gallery/camera, with an adjustable tile size. Default wall skin and floor skin are in the app bar. |
| Share | 3D view menu | Share a PNG snapshot of the 3D view or the plan file (JSON). |

Plans are saved automatically on the phone.

## Requirements

- Android 7.0 (API 24) or newer.
- Camera tracing needs an [ARCore-capable phone](https://developers.google.com/ar/devices)
  with *Google Play Services for AR* (the app offers to install it). Phones
  without ARCore can still use photo and manual tracing and the full 3D
  editor.

## Project layout

```
lib/
  model/plan.dart              Vertices, walls, openings, skins; JSON; room (loop) detection
  ar/ar_bridge.dart            Method/event channels to the native ARCore view
  screens/ar_trace_screen.dart AR tracing UI and overlay (corners, live distances, marks)
  screens/plan_editor_screen.dart  2D editor: pan/zoom, drag corners, tools, photo scale
  screens/viewer3d_screen.dart 3D viewer (WebView) with skin/height editing sheets
  services/project_store.dart  Local persistence
  services/scene_export.dart   Plan -> JSON scene for the 3D viewer
  widgets/                     Wall editor sheet, skin editor, numeric fields
android/app/src/main/kotlin/   ARCore session + camera renderer as a Flutter platform view
web3d/                         three.js viewer source; `npm run build` writes assets/web/viewer.html
assets/web/viewer.html         The bundled 3D viewer (committed; CI checks it is current)
test/                          Dart unit + widget tests;  web3d/test: headless-Chromium viewer tests
tool/                          Icon generator
```

## Building locally

```bash
flutter pub get
flutter analyze && flutter test
cd web3d && npm ci && npm run build && npm test && cd ..
flutter build apk --release --split-per-abi   # needs the Android SDK
```

Signing for the Play Store: put an upload keystore next to
`android/key.properties` (copy `android/key.properties.example`) or set the
`UPLOAD_KEYSTORE_BASE64`, `UPLOAD_STORE_PASSWORD`, `UPLOAD_KEY_PASSWORD` and
`UPLOAD_KEY_ALIAS` repository secrets, and CI also produces a signed `.aab`.

## How the AR tracing works

`ArTracerView.kt` runs an ARCore session inside a `GLSurfaceView`, draws the
camera image, and ~30 times a second streams the camera's view/projection
matrices, the detected floor planes and a *cursor* to Flutter. The cursor is
where the ray through the screen centre meets the floor: an ARCore hit on a
tracked plane when there is one, otherwise the analytic intersection with
the detected floor height, so corners right up against walls (where plane
detection is weakest) can still be marked. Flutter projects the traced
corners with the same matrices and draws the overlay itself, so all plan
logic lives in Dart. Horizontal distances between corners are the wall
lengths; door/window marks are projected onto the wall once its second
corner is placed.

# Floor Plan Tracer - install and use

## Installing the APK on your phone

1. On the phone, open this repository's **Releases** page and pick the
   release named **Floor Plan Tracer - sideload build** (tag
   `floorplan-latest`).
2. Download `app-arm64-v8a-release.apk` (works on practically every phone
   made since 2017, including all current Samsung, Pixel, Xiaomi, Huawei
   and OnePlus models). Only very old 32-bit phones need
   `app-armeabi-v7a-release.apk`; `app-x86_64-release.apk` is for emulators.
3. Open the downloaded file. Android asks to allow installs from your
   browser or file manager the first time; allow it and tap **Install**.
4. When you first start camera tracing, allow the camera and, if asked,
   install *Google Play Services for AR* from the Play Store.

The sideload build is debug-signed. It installs and runs like any app, but
Play Protect may show a warning because it did not come from the Play
Store; choose *Install anyway*. Updates from a later CI build install over
the previous one as long as they were signed with the same key.

## Tracing a room with the camera

1. Home → **Trace with camera**. Hold the phone at chest height pointing at
   the floor and sweep slowly until the status says the floor is detected
   (a light blue area appears on the floor).
2. Stand so the centre reticle sits on a floor corner where two walls meet
   and tap **Add corner**. The reticle is green on a detected floor area
   and amber when the app extrapolates the floor height (still accurate,
   as long as the floor is level).
3. Walk along the wall. A green line follows the reticle and the live
   distance is shown. At the next corner tap **Add corner** again: the wall
   is created with its length.
4. Doors and windows: while walking along a wall, aim at the floor under
   one edge of the door and tap **Door**; aim under the other edge and tap
   **Door** again. Same for **Window** and **Opening** (a doorway without a
   door). The marks are attached to the wall when you add its next corner.
   Window sill and heights use sensible defaults (0.9 m sill, 1.2 m high;
   doors 2.1 m) that you can change afterwards.
5. When you reach the first corner again, tapping **Add corner** on it (or
   **Close room**) closes the room. **New wall chain** starts a separate
   run of walls (another room, an internal wall).
6. **Undo** steps back; **Done** returns to the 2D editor where everything
   can be adjusted.

Tips: good light and a textured floor help tracking. If tracking is lost,
keep the phone still for a moment; the walls you already traced stay in
place.

## Tracing a paper plan or drawing by hand

- Home → **Draw or trace a photo**. Use the ⋮ menu to *Photograph a paper
  plan* or pick one from the gallery. Then tap two points on the photo
  whose real distance you know (a dimension on the drawing, a door of known
  width) and type the distance: this sets the scale.
- Select the **Wall** tool and tap the corners. Tap **Finish chain** to
  stop a run of walls. Tapping on an existing corner joins walls there.
- **Door / Window / Opening** tools: tap on a wall to place one.
- **Select** tool: drag corners to move them (snaps to 45° and to other
  corners), tap a wall to edit it. Pinch to zoom, drag empty space to pan.

## Editing sizes

Tap a wall (2D editor or 3D view) to open its editor:

- **Length** moves the wall's end corner along the wall, so connected walls
  follow. **Height** and **Thickness** apply to that wall.
- Each opening has *From start*, *Width*, *Height* and *Sill*; change the
  type between door, window and opening, or delete it.
- Menu → **Set height of all walls** changes every wall at once (the 3D view
  has a slider for the same thing).

## 3D and skins

- Tap **3D**. Drag to orbit, pinch to zoom, two-finger drag to pan. The ⋮
  menu has perspective, top and inside-the-room views.
- Tap a wall to edit its size and choose its **skin**: a flat colour, a
  pattern tinted with the chosen colour (brick, tiles, wood planks, parquet,
  stripes, plaster, concrete, marble, hex tiles, checker, stone, wallpaper)
  or an image from your gallery or camera. *Tile size* is the real-world
  size of one repeat of the pattern/image.
- The app bar's paint icon sets the **default wall skin** (and can apply it
  to all walls), the grid icon sets the **floor skin**.
- ⋮ → **Share 3D snapshot** sends a PNG of the current view; **Share plan
  file** exports the plan as JSON.

## Building it yourself / signing for the Play Store

CI (`.github/workflows/build-floorplan-apk.yml`) runs the Dart and viewer
tests and builds the APKs on every push to `floorplan_app/`. To produce a
Play-Store-signed bundle, create an upload keystore once:

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then either put `floorplan_app/android/key.properties` (see
`key.properties.example`) on your machine and run
`flutter build appbundle --release`, or add these repository secrets so CI
signs it and publishes the `.aab` as the `floorplan-playstore` release:
`UPLOAD_KEYSTORE_BASE64` (`base64 -w0 upload-keystore.jks`),
`UPLOAD_STORE_PASSWORD`, `UPLOAD_KEY_PASSWORD`, `UPLOAD_KEY_ALIAS`.

Local build needs Flutter (stable) and the Android SDK; the 3D viewer
bundle is committed, so Node is only needed when changing `web3d/`.

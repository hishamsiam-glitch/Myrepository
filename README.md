# Myrepository

Two Android apps, each a self-contained Flutter project.

## [`chess/`](chess) — Chess

Play chess against the computer offline, at five strengths. Games save
themselves after every move, so one can be spread across days; every finished
game is kept in a log you can review move by move, and any entry — saved game
or log entry — can be deleted.

- Full rules: castling, en passant, promotion, checkmate, stalemate, the
  fifty-move rule, threefold repetition, insufficient material
- Beginner / Easy / Medium / Hard / Expert, differing in search depth, time
  budget, and how often they play a less-than-best move
- Alpha-beta search with iterative deepening and quiescence, running in a
  background isolate so the board never freezes
- No permissions, no network access, no ads, no data collection

See [`chess/README.md`](chess/README.md) for the layout, how the engine works,
and how to install the CI-built APK on a phone.

## [`app/`](app) — Scientific Calculator

<p>
  <img src="app/store_assets/screenshots/01_scientific_light.png" width="200" alt="Scientific mode, light theme">
  <img src="app/store_assets/screenshots/02_functions_light.png" width="200" alt="Live preview of sin(30)">
  <img src="app/store_assets/screenshots/03_basic_dark.png" width="200" alt="Basic mode, dark theme">
</p>

A scientific calculator: arithmetic, `sin cos tan` and their inverses,
`ln log sqrt x² x^y 1/x x!`, `π`/`e`, a degrees/radians toggle and a live
result preview.

See [`app/README.md`](app/README.md), and
[`docs/PLAY_STORE_RELEASE.md`](docs/PLAY_STORE_RELEASE.md) for publishing it.

## Building either app

```bash
cd chess          # or: cd app
flutter pub get
flutter analyze
flutter test
flutter run
```

## Installing on a phone

Both apps have a CI workflow that builds a release APK on every push and
publishes it to a GitHub Release:

| App | Release tag | File to download |
|-----|-------------|------------------|
| Chess | `chess-sideload-latest` | `chess-arm64-v8a-release.apk` |
| Calculator | `sideload-latest` | `app-arm64-v8a-release.apk` |

`arm64-v8a` covers essentially every phone sold in the last decade. Open the
downloaded file on the phone and allow installing from your browser or file
manager when Android asks.

These APKs are signed with Flutter's debug key: fine for your own device, not
valid for a Play Store upload. Both projects read a real upload keystore from
`android/key.properties` when you provide one (see each project's
`android/key.properties.example`).

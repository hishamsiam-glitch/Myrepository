# Chess

An offline chess app for Android: play against the computer at five strengths,
leave a game half-finished and pick it up days later, and keep a log of every
game you have played.

## Features

- **Play against the computer** at five strengths — Beginner, Easy, Medium,
  Hard, Expert — choosing White or Black.
- **Games save themselves.** Every move is written to storage as it is played,
  so you can close the app (or have Android kill it) mid-game and carry on
  later from the home screen. Several games can be in progress at once.
- **A log of every game** with the result, difficulty, colour, move count and
  dates, plus a review screen that steps through the game move by move.
- **Delete any entry** — a saved game or a log entry — by swiping it or using
  its delete button, or clear a whole list from the overflow menu. Every
  delete is confirmed and can be undone.
- **Full rules**: castling, en passant, promotion (you pick the piece),
  checkmate, stalemate, the fifty-move rule, threefold repetition and
  insufficient-material draws. Take back a move, or resign.
- **Copy a game's moves** to the clipboard from the review screen, to paste
  into an analysis board elsewhere.
- No network access, no permissions, no accounts, no ads. The games are stored
  in the app's own private directory.

## Project layout

```
chess/
  lib/
    chess/                   The rules, as plain Dart with no Flutter imports
      pieces.dart            Colours, piece types, square indexing (0 = a1)
      move.dart              A move (from, to, promotion) and its UCI form
      position.dart          Board, move generation, legality, FEN, SAN
      game.dart              Move history, repetition/50-move tracking, results
    engine/
      difficulty.dart        The five strength settings and what makes them differ
      evaluation.dart        Material, piece-square tables, pawn structure
      search.dart            Alpha-beta + iterative deepening + quiescence
    storage/
      game_record.dart       One library entry (start position + moves + result)
      game_storage.dart      JSON file in the app documents directory
      game_library.dart      The in-memory library, and saving/deleting
    ui/                      Board, home, game, library, review screens
    game_session.dart        One game being played: rules + AI turn + autosave
    main.dart                App entry point
  test/                      141 tests (see below)
  tool/
    generate_icons.dart    Regenerates the launcher icons (no dependencies)
  android/                   Android project (Gradle, manifest, icons)
```

## How the computer plays

`lib/engine/search.dart` is a negamax alpha-beta search with iterative
deepening, a quiescence search over captures, and MVV-LVA move ordering. It
runs in a background isolate, so the board never freezes while it thinks.

Iterative deepening is bounded by a wall-clock budget as well as a depth
ceiling, so a slow phone searches less deeply rather than hanging.

Strength is not just search depth — a shallow search still plays "correctly"
and feels robotic. Each level also has a *noise window* (play any move within
N centipawns of the best one, chosen at random) and a *blunder chance* (ignore
the search entirely and play a random legal move):

| Level | Depth | Time | Noise | Blunders |
|-------|-------|------|-------|----------|
| Beginner | 1 | 0.15s | 90cp | 35% |
| Easy | 2 | 0.4s | 55cp | 15% |
| Medium | 3 | 0.9s | 30cp | 5% |
| Hard | 4 | 2s | 12cp | — |
| Expert | up to 7 | 4.5s | — | — |

The search also knows which positions have already occurred in the game and
scores repeating one as a draw, so it will not repeat while it is winning, but
will happily repeat to save a lost game.

## Running it on your phone

The quickest route is the build CI publishes on every push:

1. Open the repository's **Releases** page and download **`Chess-apk.zip`**
   from the `chess-sideload-latest` release.
2. Extract `Chess.apk` from it (long-press the zip in the Files app and choose
   Extract).
3. Tap `Chess.apk` to install, allowing "install unknown apps" for whichever
   app you opened it from when Android asks.

Download the zip rather than the `.apk` directly: Chrome on Android often
refuses to finalise an `.apk` download while Play Protect verifies it, leaving
it sitting at "16.84 MB / 16.84 MB" and never completing. A zip downloads
normally, and is about half the size because the `.so` files inside an APK are
stored uncompressed. The raw per-ABI APKs are in the same release for `adb
install` (`arm64-v8a` covers essentially every phone sold in the last decade;
`armeabi-v7a` also runs on 64-bit devices if you need a smaller file).

These APKs are signed with Flutter's debug key, which is fine for installing
on your own device but not for a Play Store upload. For that, create an upload
keystore, copy `android/key.properties.example` to `android/key.properties`
(it is git-ignored), and build with `flutter build appbundle --release`.

## Building it yourself

```bash
cd chess
flutter pub get
flutter analyze
flutter test
flutter run                              # on a connected device or emulator
flutter build apk --release --split-per-abi
```

## Tests

```bash
flutter test
```

141 tests, and the important ones are the rules tests. `test/position_test.dart`
runs `perft` against five standard published positions (the starting position,
"kiwipete", and three others chosen because they stress castling, en passant
discoveries, pins and promotion). Those node counts only match if move
generation is exactly right, so they catch any rules bug immediately.

The rest cover game results and repetition tracking (`game_test.dart`), the
evaluation and the search's tactics (`search_test.dart`), saving, loading and
deleting (`storage_test.dart`), the play/undo/resign/autosave flow
(`game_session_test.dart`) and the screens end to end (`widget_test.dart`).

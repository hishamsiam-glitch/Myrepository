# Releasing Scientific Calculator to the Play Store

This app was fully built and tested in this repository (`app/`), including
running `flutter analyze` and the full test suite (49 tests: 44 pure-Dart
engine tests + 5 widget tests) against a real Flutter SDK. The one thing
that could **not** be done inside the sandbox that built this app is
producing the final signed `.aab`/`.apk` — that step requires the Android
SDK (`dl.google.com`), which was blocked by this session's network policy.
Everything below can be done on your own machine in well under an hour.

## 0. Prerequisites

- A computer with [Flutter](https://docs.flutter.dev/get-started/install)
  and Android Studio (or just the Android command-line SDK) installed.
- A [Google Play Console](https://play.google.com/console) developer
  account. This is a **one-time $25 USD fee** per Google account, paid
  directly to Google — there's no way around this requirement, and no one
  else can pay it on your behalf since it's tied to your identity/account
  for policy reasons.
- This repository cloned locally.

## 1. Get the app running locally

```bash
cd app
flutter pub get
flutter analyze          # should report "No issues found!"
flutter test              # should report 49 passing tests
flutter run                # launch on a connected device/emulator
```

## 2. Create your upload keystore

Google requires every release build to be cryptographically signed. Generate
your own upload key once — **back it up somewhere safe**; if you lose it you
will not be able to publish updates to the same app listing.

```bash
keytool -genkey -v -keystore ~/upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload
```

Then create `app/android/key.properties` (already git-ignored, so it will
never be committed) from the template:

```bash
cp app/android/key.properties.example app/android/key.properties
```

Edit it with the values you just chose:

```properties
storePassword=<your store password>
keyPassword=<your key password>
keyAlias=upload
storeFile=/absolute/path/to/upload-keystore.jks
```

`app/android/build.gradle.kts` is already wired to use this file
automatically when it's present, and falls back to debug signing when it's
absent (so `flutter run` keeps working without any of this).

## 3. Build the release bundle

Play Store uploads use the Android App Bundle format:

```bash
cd app
flutter build appbundle --release
```

Output: `app/build/app/outputs/bundle/release/app-release.aab`

To sanity-check the signed build on a real device before uploading:

```bash
flutter build apk --release
# install app/build/app/outputs/flutter-apk/app-release.apk on a device
```

## 4. Create the app in Play Console

1. Play Console → **Create app**.
2. App name: `Scientific Calculator` (or your preferred name).
3. Default language, app or game: **App**, Free.
4. Declarations: confirm compliance with Play policies and US export laws.

## 5. Fill in the store listing

Use `docs/STORE_LISTING.md` in this repo — it has the exact title, short
description, full description, category, and data-safety answers to paste
in. Upload the generated graphics:

- App icon: `store_assets/icon_512x512.png`
- Feature graphic: `store_assets/feature_graphic_1024x500.png`
- Phone screenshots: `app/store_assets/screenshots/*.png`

(You can regenerate the screenshots anytime with
`flutter test tool/generate_screenshots.dart` from inside `app/`.)

## 6. Publish the privacy policy

Play Console requires a public URL to a privacy policy, even for an app
that collects no data. `docs/PRIVACY_POLICY.md` is ready to use. Easiest
options:

- **GitHub**: push this repo, then use the rendered file's URL, e.g.
  `https://github.com/<you>/<repo>/blob/main/docs/PRIVACY_POLICY.md`
  (publicly viewable without login, which is all Play Console checks for).
- **GitHub Pages**: enable Pages on the repo (Settings → Pages → deploy
  from `/docs`) for a cleaner URL.
- Any other place you can host a static page (Notion, a gist, your own
  site) works too.

Paste that URL into Play Console → App content → Privacy policy.

## 7. Complete the required App content sections

Play Console won't let you publish until each of these is filled in
(all answers are in `docs/STORE_LISTING.md`):

- **Privacy policy** — URL from step 6.
- **Ads** — declare no ads.
- **App access** — "All functionality is available without special access"
  (no login required).
- **Content rating** — fill out the IARC questionnaire; answer "No" to
  every content question.
- **Target audience and content** — select an age range; this app has no
  age-inappropriate content.
- **Data safety** — declare no data collected/shared.
- **Government apps / Financial features / News apps** — not applicable,
  answer accordingly.

## 8. Upload the build

1. Play Console → **Release → Testing → Internal testing** (recommended
   first) or **Production**.
2. Create a new release, upload `app-release.aab` from step 3.
3. Add release notes (e.g. "Initial release").
4. Review and roll out.

Starting with **Internal testing** lets you install the app via a private
link and verify everything before it's visible to the public. When you're
happy with it, promote the same release to Production.

## 9. Review

Google's review typically takes a few hours to a few days for a first
submission. You'll get an email when it's approved (or if changes are
requested).

---

### Updating the app later

1. Bump the version in `app/pubspec.yaml` (`version: 1.0.1+2` — the part
   before `+` is the user-visible version, the part after is the build
   number and **must increase** on every upload).
2. `flutter build appbundle --release`
3. Upload the new `.aab` as a new release in Play Console.

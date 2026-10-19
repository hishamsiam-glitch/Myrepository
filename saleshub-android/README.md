# Sales HUB — Android app

A signed wrapper around https://saleshub.gulfhygienic.com.sa. Users sign in once (code + authenticator; "Keep me
signed in on this phone" is pre-ticked inside the app) and later launches open straight into their own view.
Everything role-based is decided by the portal, so salesmen, supervisors, directors and managers all use the same APK.

## Build on a laptop (Android Studio)
1. Install Android Studio (Koala or newer). Open this `android` folder as a project; let it sync (first sync downloads the SDK 35 platform).
2. Create the signing key once (keep the .jks and passwords in the password safe — losing it means a new app identity for every update):
   `keytool -genkeypair -v -keystore saleshub.jks -alias saleshub -keyalg RSA -keysize 4096 -validity 10000`
3. Create `keystore.properties` next to this README:
   ```
   storeFile=saleshub.jks
   storePassword=...
   keyAlias=saleshub
   keyPassword=...
   ```
4. Build → Generate Signed Bundle / APK → APK → release. Output: `app/build/outputs/apk/release/app-release.apk`.
   (or from a terminal: `gradlew assembleRelease`)

## Build with GitHub Actions
Push the repository to GitHub; `.github/workflows/android.yml` builds the APK on every change under `android/` and on
"Run workflow". For a signed release add the four repository secrets named in the workflow.

## Distribute
Sideload (Settings → Install unknown apps for the file manager / browser), or push through MDM. Installing a newer version
over the old one keeps the sign-in (same signing key, same package `sa.com.ughi.saleshub`).

## Updating
Bump `versionCode` / `versionName` in `app/build.gradle.kts`, build, redistribute. The portal URL is `PORTAL_URL` in the same file.

## What the app does
- Loads only the portal host inside the app; other links open in the phone's browser.
- Pull to refresh; back navigates within the portal; offline screen with retry.
- "Export to Excel" saves to Downloads/Sales HUB.
- Cookies (session + device token) are excluded from cloud backup and device transfer.
- HTTPS only, system CA store only (no user-installed CAs).
- Splash and launcher icons from the Sales HUB brand kit.

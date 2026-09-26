# AppGuard – email-approved app & website control for Android

AppGuard turns an Android phone or tablet into a **whitelist-only device**:

* Every app is blocked except a small set of always-allowed apps (launcher,
  phone, keyboard, system UI, anything the administrator marks).
* Inside browsers every website is blocked unless its domain is approved.
* Approvals are **time-limited**. The administrator sets a default duration
  (60 minutes out of the box). When the time is up the app or site is blocked
  again until a *new* approval arrives.
* Approvals arrive **by email**. The device sends a request to
  `hisham.siam@gmail.com`; a reply containing `APPROVE` (optionally with a
  duration, e.g. `APPROVE 45`) unlocks the app or site for that duration.
  Emails from any other address are ignored, and Gmail's DKIM/SPF
  authentication headers are checked so a forged "From" does not work.
* Anything not approved shows a full-screen **Blocked by AppGuard** page with
  a *Request approval* button, the request code, and an *Administrator unlock*
  option (PIN) for when the parent is physically present.

The app is written in Kotlin against the plain Android framework (no AndroidX,
no third-party UI); the only dependency is the Android build of JavaMail for
IMAP/SMTP. The release APK is about 1 MB.

## Install

1. Copy `release/AppGuard-1.0.0.apk` (or the asset on the *AppGuard (latest
   build)* GitHub Release) to the device and open it. Allow installing from
   unknown sources when asked.
2. Open **AppGuard** and create the administrator PIN.
3. Work through the setup checklist on the main screen:
   * **Accessibility service** – this is what blocks apps and websites.
     On Android 13+ a sideloaded app is a "restricted setting": open
     *Settings → Apps → AppGuard → ⋮ → Allow restricted settings* first,
     then enable *AppGuard protection* under Accessibility.
   * **Device administrator** – stops the app from being uninstalled
     without deactivating the admin first (deactivation shows a warning;
     the PIN-protected *Administrator settings* has a proper off switch).
   * **Device mailbox** – the mailbox AppGuard uses to *send* requests and
     *read* approvals (see below).
   * Notifications, battery-optimisation exemption, and *Display over other
     apps* keep the blocker responsive.
4. Choose **Administrator → Choose always-allowed apps…** to whitelist
   anything that should never need approval (e.g. Phone, Messages, Camera).

Once the accessibility service is on, **Android Settings is blocked too**
(otherwise a child could just switch the service off). The administrator
unlocks it for 10 minutes with the PIN from the main screen when needed.

### Optional: device-owner hardening

For the strongest protection make AppGuard the device owner on a device
with no Google account added yet (factory-reset state), via ADB:

```bash
adb shell dpm set-device-owner com.hishamsiam.appguard/.GuardDeviceAdminReceiver
```

Then tap **Apply device-owner hardening** in Administrator settings. This
blocks uninstalling AppGuard, factory reset from Settings, safe boot, adding
users, and USB debugging.

## The device mailbox

AppGuard needs its *own* mailbox on the controlled device (not the
approver's). Any IMAP/SMTP account works; Gmail is the easiest:

1. Create a Gmail account for the device (e.g. `kidsphone.appguard@gmail.com`).
2. Turn on 2-Step Verification, then create an **App password**
   (Google Account → Security → 2-Step Verification → App passwords).
3. In AppGuard: *Administrator → Device mailbox*, choose the **Gmail**
   preset, enter the address and the 16-character app password, tap
   **Test mailbox connection**, then **Save settings**.

The approver address defaults to `hisham.siam@gmail.com` and can be
changed in Administrator settings (PIN required).

## Approving by email

When the child taps **Request approval** on the block screen, the approver
receives:

```
Subject: [AppGuard] Approval request K7Q2ZP: YouTube
```

Reply with one of these as the first line of the reply:

| Reply            | Effect                                               |
|------------------|------------------------------------------------------|
| `APPROVE`        | allow for the configured default duration            |
| `APPROVE 45`     | allow for 45 minutes (`2h`, `1 hour`, `90m` also work) |
| `DENY`           | reject the request                                   |

The approver can also send a fresh email (subject or first line) without a
request:

| Email                                 | Effect                                  |
|---------------------------------------|-----------------------------------------|
| `APPROVE youtube.com 60`              | allow the site (and its subdomains) 60 min |
| `APPROVE com.instagram.android 30`    | allow the app by package name           |
| `APPROVE Instagram`                   | allow the app by its name, default time |
| `REVOKE youtube.com`                  | block it again immediately              |
| `LOCK`                                | revoke every approval                   |

The device checks the mailbox every minute while a request is waiting
(configurable interval otherwise, plus a system job every 15 minutes), and
the block screen closes by itself once the approval arrives. When the
approver is physically present, **Administrator unlock** on the block screen
grants the default duration after the PIN.

### How sender verification works

Only messages whose `From` is the approver address are considered, and only
if the receiving mail server's `Authentication-Results` header reports
`dkim=pass`, `spf=pass` or `dmarc=pass` for the approver's domain. Gmail
adds this header to every message. If the device mailbox is at a provider
that does not, switch off *Verify sender authenticity* in settings.
AppGuard's own outgoing requests carry an `X-AppGuard-Request` header and
are never treated as approvals, and quoted text in replies is ignored.

## Building

### With the Android SDK (normal)

```bash
cd appguard
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

Every push touching `appguard/` also builds the APK on GitHub Actions and
publishes it as the `appguard-latest` GitHub Release
(`.github/workflows/build-appguard.yml`).

### Without the Android SDK

`tools/build-without-sdk.sh` builds the same APK using only aapt2, kotlinc,
d8 (from `r8.jar`), zipalign and apksigner – handy on machines that cannot
reach `dl.google.com`. The header of the script lists where each tool comes
from and the environment variables that point at them.

### Signing key

`keystore/appguard-release.jks` (password in `keystore/keystore.properties`)
is committed deliberately so that CI builds, local builds and the no-SDK
build are all signed identically and can be installed over each other. Do
not use this key for anything you plan to publish on Google Play.

## Project layout

```
appguard/
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/hishamsiam/appguard/
    GuardAccessibilityService.kt  watches the foreground app / browser URL bar, raises the block screen
    Policy.kt                     allow/deny decisions, grants, target resolution
    Store.kt                      settings, approvals, pending requests, PIN (SharedPreferences + JSON)
    Apps.kt                       package helpers, browser address-bar ids, always-allowed system packages
    MailClient.kt                 JavaMail IMAP fetch / SMTP send
    ApprovalParser.kt             turns the approver's email into a command
    SenderAuth.kt                 DKIM/SPF/DMARC header check
    MailPoller.kt                 sends requests, applies commands, notifications
    MailPollJob.kt                JobScheduler fallback poller
    GuardDeviceAdminReceiver.kt   device admin / device-owner hardening
    BlockedActivity.kt            the "Blocked by AppGuard" page
    MainActivity.kt               status, setup checklist, active approvals, pending requests
    SettingsActivity.kt           PIN-protected administrator settings
    AppPickerActivity.kt          always-allowed app picker
  keystore/                       release signing key
  tools/build-without-sdk.sh      SDK-less build pipeline
  release/                        the built APK
```

## Limitations to know about

* Blocking relies on the accessibility service; a user who can reach
  Android Settings can turn it off, which is why Settings itself is blocked
  and why device-owner mode is recommended for determined users.
* Website filtering reads the browser's address bar. It covers Chrome,
  Firefox, Samsung Internet, Edge, Brave, Opera, DuckDuckGo and other
  common browsers; an unknown browser is simply treated as an app (blocked
  unless approved).
* Approval latency equals the mailbox check interval (1 minute while a
  request is pending); there is no push channel.

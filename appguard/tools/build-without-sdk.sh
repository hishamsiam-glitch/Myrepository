#!/usr/bin/env bash
# Builds a signed release APK WITHOUT the Android SDK / Android Gradle Plugin.
#
# Needed when dl.google.com (the SDK download host) is unreachable. Uses:
#   aapt2      - Debian/Ubuntu package "aapt" ships it at /usr/lib/android-sdk/build-tools/debian/aapt2
#   kotlinc    - https://github.com/JetBrains/kotlin/releases (kotlin-compiler-*.zip)
#   d8         - inside r8.jar from https://storage.googleapis.com/r8-releases/raw/<ver>/r8.jar
#   android.jar- API 35 framework classes for compiling: org.robolectric:android-all (Maven Central)
#   res jar    - framework resources for aapt2: Debian/Ubuntu package "android-sdk-platform-23"
#   zipalign / apksigner - Debian/Ubuntu packages "zipalign", "apksigner"
#   JavaMail   - com.sun.mail:android-mail + android-activation 1.6.7 (Maven Central)
#
# Override any location with the environment variables below. The normal
# Gradle build (./gradlew assembleRelease) produces an equivalent APK.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${ABT_HOME:-/opt/abt}"
AAPT2="${AAPT2:-/usr/lib/android-sdk/build-tools/debian/aapt2}"
KOTLINC="${KOTLINC:-$TOOLS/kotlinc/bin/kotlinc}"
R8_JAR="${R8_JAR:-$TOOLS/r8.jar}"
ANDROID_JAR="${ANDROID_JAR:-$TOOLS/android-all.jar}"                 # compile classpath (API 35)
# aapt2 cannot read the Robolectric jar's resource table, so framework resources
# come from Ubuntu's android-sdk-platform-23 package instead (only attributes
# that exist in API 23 are referenced from XML).
RES_JAR="${RES_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
MAIL_JAR="${MAIL_JAR:-$TOOLS/android-mail-1.6.7.jar}"
ACTIVATION_JAR="${ACTIVATION_JAR:-$TOOLS/android-activation-1.6.7.jar}"
ZIPALIGN="${ZIPALIGN:-zipalign}"
APKSIGNER="${APKSIGNER:-apksigner}"
KOTLIN_STDLIB="${KOTLIN_STDLIB:-$(dirname "$KOTLINC")/../lib/kotlin-stdlib.jar}"

MIN_SDK=26; TARGET_SDK=35
VERSION_CODE="${VERSION_CODE:-1}"; VERSION_NAME="${VERSION_NAME:-1.0.0}"
OUT="${OUT_DIR:-$ROOT/build/nosdk}"
APP="$ROOT/app/src/main"
KS_PROPS="$ROOT/keystore/keystore.properties"
prop() { grep -E "^$1=" "$KS_PROPS" | cut -d= -f2-; }
KS_FILE="$ROOT/keystore/$(basename "$(prop storeFile)")"

for f in "$AAPT2" "$KOTLINC" "$R8_JAR" "$ANDROID_JAR" "$RES_JAR" "$MAIL_JAR" "$ACTIVATION_JAR" "$KOTLIN_STDLIB" "$KS_FILE"; do
  [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
done
unset JAVA_TOOL_OPTIONS 2>/dev/null || true

rm -rf "$OUT"; mkdir -p "$OUT"/{flat,gen,classes,dex,libs,apk}
echo "== aapt2 compile"
"$AAPT2" compile --dir "$APP/res" -o "$OUT/flat/res.zip"

echo "== aapt2 link"
# AGP 8 forbids the package attribute in the source manifest (it uses the Gradle
# namespace instead), while aapt2 on its own needs it - so inject it here.
sed 's|<manifest |<manifest package="com.hishamsiam.appguard" |' "$APP/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"
"$AAPT2" link -o "$OUT/apk/base.apk" \
  -I "$RES_JAR" \
  --manifest "$OUT/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --auto-add-overlay --no-version-vectors \
  "$OUT/flat/res.zip"

echo "== javac R.java"
javac --release 8 -nowarn -d "$OUT/classes" $(find "$OUT/gen" -name '*.java')

echo "== kotlinc"
# The Robolectric jar carries android.annotation.Nullable on framework APIs
# that the real SDK stubs expose as platform types; ignore them to match AGP.
"$KOTLINC" -jvm-target 1.8 -no-reflect -nowarn \
  -Xnullability-annotations=@android.annotation:ignore \
  -classpath "$ANDROID_JAR:$MAIL_JAR:$ACTIVATION_JAR:$OUT/classes" \
  -d "$OUT/classes" \
  $(find "$APP/java" -name '*.kt')

echo "== strip module-info from stdlib"
cp "$KOTLIN_STDLIB" "$OUT/libs/kotlin-stdlib.jar"
zip -q -d "$OUT/libs/kotlin-stdlib.jar" 'META-INF/versions/*' 'module-info.class' 2>/dev/null || true

echo "== d8"
( cd "$OUT/classes" && jar cf "$OUT/libs/app-classes.jar" . )
java -cp "$R8_JAR" com.android.tools.r8.D8 --release --min-api "$MIN_SDK" \
  --lib "$ANDROID_JAR" --output "$OUT/dex" \
  "$OUT/libs/app-classes.jar" "$OUT/libs/kotlin-stdlib.jar" "$MAIL_JAR" "$ACTIVATION_JAR"

echo "== package"
cp "$OUT/apk/base.apk" "$OUT/apk/unaligned.apk"
( cd "$OUT/dex" && zip -q "$OUT/apk/unaligned.apk" classes*.dex )
# JavaMail locates its providers through these classpath resources.
mkdir -p "$OUT/res-java" && ( cd "$OUT/res-java" \
  && unzip -q -o "$MAIL_JAR" 'META-INF/javamail.*' 'META-INF/mailcap' 'META-INF/services/*' \
  && unzip -q -o "$ACTIVATION_JAR" 'META-INF/mailcap.default' 'META-INF/mimetypes.default' \
  && zip -q -r "$OUT/apk/unaligned.apk" META-INF )
"$ZIPALIGN" -p -f 4 "$OUT/apk/unaligned.apk" "$OUT/apk/aligned.apk"

echo "== sign"
FINAL="$OUT/AppGuard-$VERSION_NAME.apk"
"$APKSIGNER" sign --ks "$KS_FILE" --ks-key-alias "$(prop keyAlias)" \
  --ks-pass "pass:$(prop storePassword)" --key-pass "pass:$(prop keyPassword)" \
  --min-sdk-version "$MIN_SDK" --out "$FINAL" "$OUT/apk/aligned.apk"
"$APKSIGNER" verify --print-certs "$FINAL" | head -3
ls -la "$FINAL"

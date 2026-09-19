import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing is loaded from android/key.properties, which is git-ignored
// and NOT committed. See android/key.properties.example. Without it the
// release build falls back to the debug key so it is still installable for
// sideloading/testing (but not suitable for a Play Store upload).
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(keystorePropertiesFile.inputStream())
}

android {
    namespace = "com.hishamsiam.crate_quest"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.hishamsiam.crate_quest"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    // The game itself is the plain HTML/JS in ../../web; it is packaged as
    // app assets so there is exactly one copy of the game in the repo.
    sourceSets {
        getByName("main") {
            assets.srcDirs("../../web")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            // The app is a few hundred KB of Java; shrinking buys nothing.
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}

dependencies {
    // AndroidX pulls in mismatched kotlin-stdlib / kotlin-stdlib-jdk8
    // versions; the BOM aligns them so AGP's duplicate-class check passes.
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:1.8.22"))
    // WebViewAssetLoader: serves the bundled game from an https:// origin so
    // localStorage (saved progress) behaves exactly like a normal website.
    implementation("androidx.webkit:webkit:1.12.1")
}

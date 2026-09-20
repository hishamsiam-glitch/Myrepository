import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing is loaded from android/key.properties, which is
// git-ignored and NOT committed. See key.properties.example.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(keystorePropertiesFile.inputStream())
}

// The game itself lives one level up (../../). It is copied into the APK's
// assets at build time so there is a single source of truth for the web and
// Android versions.
val gameAssetsDir = layout.buildDirectory.dir("generated/gameAssets")
val copyGameAssets = tasks.register<Copy>("copyGameAssets") {
    from(rootProject.file("..")) {
        include("index.html", "style.css", "*.js", "icon.svg", "manifest.webmanifest")
        include("vendor/**", "fonts/**")
        exclude("android/**")
    }
    into(gameAssetsDir.map { it.dir("www") })
}

android {
    namespace = "com.hishamsiam.spaceinvaders3d"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hishamsiam.spaceinvaders3d"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
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
            // Falls back to the debug key so the build works out of the box
            // (sideloadable); with key.properties present it uses your real
            // upload key, which is what the Play Store needs.
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(gameAssetsDir.get().asFile)
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

tasks.named("preBuild") {
    dependsOn(copyGameAssets)
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
}

import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The release signing key is committed on purpose so every build (CI, local,
// no-SDK script) is signed with the same key and can be installed over an
// existing installation. See ../keystore/keystore.properties.
val keystoreProps = Properties().apply {
    rootProject.file("keystore/keystore.properties").inputStream().use { load(it) }
}

android {
    namespace = "com.hishamsiam.appguard"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hishamsiam.appguard"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore/" + keystoreProps.getProperty("storeFile").removePrefix("../keystore/"))
            storePassword = keystoreProps.getProperty("storePassword")
            keyAlias = keystoreProps.getProperty("keyAlias")
            keyPassword = keystoreProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            // The app is tiny (framework widgets only, no AndroidX); shrinking
            // buys nothing and JavaMail relies on reflection + META-INF
            // resources, so keep the release build unobfuscated.
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint {
        // Release builds run lintVital; keep a warning-level finding from breaking CI.
        checkReleaseBuilds = false
        abortOnError = false
    }

    packaging {
        resources {
            // JavaMail discovers its protocol providers through these files.
            pickFirsts += listOf("META-INF/mailcap", "META-INF/mailcap.default", "META-INF/mimetypes.default")
            excludes += listOf("META-INF/LICENSE.md", "META-INF/NOTICE.md", "META-INF/hk2-locator/default", "META-INF/gfprobe-provider.xml")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // Android-friendly JavaMail build (IMAP + SMTP) from Maven Central.
    implementation("com.sun.mail:android-mail:1.6.7")
    implementation("com.sun.mail:android-activation:1.6.7")
}

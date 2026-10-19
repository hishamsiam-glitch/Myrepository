import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: put keystore.properties next to this file (see README.md). Without it, only the debug build signs.
val keystoreProps = Properties().apply { val f = rootProject.file("keystore.properties"); if (f.exists()) f.inputStream().use { load(it) } }

android {
    namespace = "sa.com.ughi.saleshub"
    compileSdk = 35

    defaultConfig {
        applicationId = "sa.com.ughi.saleshub"
        minSdk = 29                       // Android 10+ (MediaStore downloads)
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "PORTAL_URL", "\"https://saleshub.gulfhygienic.com.sa/\"")
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.isNotEmpty()) {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreProps.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.google.android.material:material:1.12.0")
}

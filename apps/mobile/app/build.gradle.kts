plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "id.ssb.mpsheartbeat"
    compileSdk = 34

    defaultConfig {
        applicationId = "id.ssb.mpsheartbeat"
        minSdk = 24            // Android 7.0 — tablet lama masih terdukung
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures { buildConfig = true }   // BuildConfig.VERSION_NAME dipakai payload
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Sengaja TANPA dependency eksternal (OkHttp/Retrofit/coroutines):
    // heartbeat cukup HttpURLConnection + Handler — APK kecil, permukaan supply-chain nol.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1") // watchdog restart service
}

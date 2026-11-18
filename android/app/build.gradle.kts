plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "sa.news.reader"
    compileSdk = 35

    defaultConfig {
        applicationId = "sa.news.reader"
        minSdk = 26
        targetSdk = 34
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    // A fixed key kept in the repository so every build can be installed over
    // the previous one without uninstalling (which would erase saved stories).
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webassets"))
}

// The app's interface is the same web app as in /public, bundled into the APK.
val prepareWebAssets by tasks.registering(Copy::class) {
    from("../../public")
    into(layout.buildDirectory.dir("webassets/www"))
    exclude("data/**", "sw.js", "manifest.webmanifest")
}
tasks.named("preBuild") { dependsOn(prepareWebAssets) }

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}

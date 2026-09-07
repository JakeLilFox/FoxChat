plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Tauri includes this vendored plugin as a Gradle subproject. Keep its generated
// output in the app's build tree instead of rewriting files inside the vendor tree.
if (rootProject != project) {
    layout.buildDirectory.set(
        rootProject.layout.buildDirectory.dir("plugin-builds/tauri-plugin-remote-push")
    )
}

android {
    namespace = "app.tauri.remotepush"
    compileSdk = 36
    defaultConfig { minSdk = 21 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation(project(":tauri-android"))
    implementation("com.google.firebase:firebase-messaging:24.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}

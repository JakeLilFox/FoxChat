buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
        classpath("com.google.gms:google-services:4.4.3")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

// Tauri includes Android libraries directly from Cargo's registry and this repository's vendor
// tree. Gradle otherwise writes each library's output beside its source, dirtying the repository
// and requiring write access to the global Cargo cache. Keep all reproducible output local.
subprojects {
    if (name != "app") {
        layout.buildDirectory.set(rootProject.layout.buildDirectory.dir("plugin-builds/$name"))
    }
}

tasks.register("clean").configure {
    delete("build")
}

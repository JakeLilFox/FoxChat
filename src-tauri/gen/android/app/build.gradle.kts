import java.util.Properties
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.jar.JarInputStream
import java.util.jar.JarOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// Firebase configuration is supplied per deployment and is intentionally not
// committed. Applying the plugin when the file is present generates the
// Android resources required by Firebase Messaging for background delivery.
val sideBySideE2e = System.getenv("ANDROID_E2E_SIDE_BY_SIDE")
    ?.equals("true", ignoreCase = true) == true

if (file("google-services.json").exists() && !sideBySideE2e) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.warn(
        if (sideBySideE2e) {
            "Side-by-side E2E build: Firebase is disabled because its package is intentionally isolated"
        } else {
            "google-services.json is missing: closed-app FCM notifications will not work"
        }
    )
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// sdk-android embeds the current `uniffi.matrix_sdk_crypto` model classes. The legacy
// crypto-only compatibility AAR also carries an older copy of that package in addition to
// its independent `org.matrix.rustcomponents.sdk.crypto` OlmMachine API. Keep the latter
// (and its separate native library) for one-time upgrade migration, but remove only the
// duplicate model package so Android can safely package both APIs.
val legacyCryptoAar by configurations.creating {
    isCanBeConsumed = false
    isCanBeResolved = true
}
val sanitizedLegacyCryptoAar = layout.buildDirectory.file(
    "generated/legacy-crypto/crypto-android-26.05.12-sanitized.aar",
)
val sanitizeLegacyCryptoAar by tasks.registering {
    inputs.files(legacyCryptoAar)
    outputs.file(sanitizedLegacyCryptoAar)
    doLast {
        val source = legacyCryptoAar.singleFile
        val target = sanitizedLegacyCryptoAar.get().asFile
        target.parentFile.mkdirs()
        ZipInputStream(source.inputStream().buffered()).use { input ->
            ZipOutputStream(target.outputStream().buffered()).use { output ->
                while (true) {
                    val entry = input.nextEntry ?: break
                    output.putNextEntry(ZipEntry(entry.name))
                    if (entry.name == "classes.jar") {
                        val classes = ByteArrayOutputStream()
                        JarInputStream(ByteArrayInputStream(input.readBytes())).use { jarInput ->
                            JarOutputStream(classes).use { jarOutput ->
                                while (true) {
                                    val classEntry = jarInput.nextJarEntry ?: break
                                    if (!classEntry.name.startsWith("uniffi/")) {
                                        jarOutput.putNextEntry(ZipEntry(classEntry.name))
                                        jarInput.copyTo(jarOutput)
                                        jarOutput.closeEntry()
                                    }
                                }
                            }
                        }
                        output.write(classes.toByteArray())
                    } else {
                        input.copyTo(output)
                    }
                    output.closeEntry()
                }
            }
        }
    }
}

// CI passes VERSION_CODE as the app's semver (e.g. "0.0.15"), which Android's
// integer versionCode can't hold directly, so a plain "x.y.z" is packed into
// major*1_000_000 + minor*1_000 + patch instead of failing to parse.
fun versionCodeOf(raw: String): Int {
    raw.toIntOrNull()?.let { return it }
    val (major, minor, patch) = raw.split(".").map { it.toIntOrNull() ?: 0 } + listOf(0, 0, 0)
    return major * 1_000_000 + minor * 1_000 + patch
}

android {
    compileSdk = 36
    namespace = "foxchat.jakefox.de"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = if (sideBySideE2e) "foxchat.jakefox.de.e2e" else "foxchat.jakefox.de"
        minSdk = 24
        targetSdk = 36
        versionCode = System.getenv("VERSION_CODE")?.let { versionCodeOf(it) } ?: tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = if (System.getenv("VERSION_NAME") != null) System.getenv("VERSION_NAME") else tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            if (sideBySideE2e) {
                versionNameSuffix = "-e2e"
            }
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
    val keystorePath = if (project.hasProperty("PKEYSTORE_PATH")) project.property("PKEYSTORE_PATH") as String else (System.getenv("PKEYSTORE_PATH") ?: "")
    val keystorePassword = if (project.hasProperty("PKEYSTORE_PASSWORD")) project.property("PKEYSTORE_PASSWORD") as String else (System.getenv("PKEYSTORE_PASSWORD") ?: "")
    val keystoreAlias = if (project.hasProperty("PKEYSTORE_ALIAS")) project.property("PKEYSTORE_ALIAS") as String else (System.getenv("PKEYSTORE_ALIAS") ?: "release")
    val keystoreAliasPassword = if (project.hasProperty("PKEYSTORE_ALIAS_PASSWORD")) project.property("PKEYSTORE_ALIAS_PASSWORD") as String else (System.getenv("PKEYSTORE_ALIAS_PASSWORD") ?: keystorePassword)

    signingConfigs {
        if (keystorePath.isNotEmpty() && keystorePassword.isNotEmpty()) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                keyAlias = keystoreAlias
                keyPassword = keystoreAliasPassword
            }
        }
    }

        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            if (keystorePath.isNotEmpty() && keystorePassword.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

// rustls-platform-verifier ships its small Android trust-manager bridge inside the
// Cargo crate so its Kotlin and Rust halves always stay on matching versions.
fun rustlsPlatformVerifierComponent(): Pair<File, String> {
    val cargo = System.getenv("CARGO")?.takeIf { it.isNotBlank() }
        ?: if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) {
            File(System.getProperty("user.home"), ".cargo/bin/cargo.exe").absolutePath
        } else {
            "cargo"
        }
    val metadata = providers.exec {
        workingDir = file("../../..")
        commandLine(
            cargo,
            "metadata",
            "--format-version",
            "1",
            "--filter-platform",
            "aarch64-linux-android",
            "--manifest-path",
            "Cargo.toml",
        )
    }.standardOutput.asText.get()
    val packages = (JsonSlurper().parseText(metadata) as Map<*, *>)["packages"] as List<*>
    val component = packages
        .filterIsInstance<Map<*, *>>()
        .first { it["name"] == "rustls-platform-verifier-android" }
    val manifestPath = component["manifest_path"] as String
    val version = component["version"] as String
    return File(File(manifestPath).parentFile, "maven") to version
}

val rustlsPlatformVerifier = rustlsPlatformVerifierComponent()
repositories {
    maven {
        url = uri(rustlsPlatformVerifier.first)
        metadataSources { artifact() }
    }
}

dependencies {
    val legacyCryptoOverride = System.getenv("ANDROID_E2E_LEGACY_CRYPTO_AAR")
        ?.takeIf { it.isNotBlank() }
    if (legacyCryptoOverride != null) {
        legacyCryptoAar(files(legacyCryptoOverride))
    } else {
        legacyCryptoAar("org.matrix.rustcomponents:crypto-android:26.05.12@aar")
    }
    implementation("com.google.firebase:firebase-messaging:24.1.2")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("androidx.security:security-crypto:1.1.0")
    // Android owns Matrix through the production Rust SDK. The sanitized compatibility
    // AAR is only the pre-cutover fallback for existing installations.
    implementation("org.matrix.rustcomponents:sdk-android:26.08.05")
    implementation("rustls:rustls-platform-verifier:${rustlsPlatformVerifier.second}@aar")
    implementation(files(sanitizedLegacyCryptoAar).builtBy(sanitizeLegacyCryptoAar))
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

// Keep normal desktop/web development buildable before the Firebase file is
// provisioned. Android push is enabled as soon as google-services.json exists.
if (file("google-services.json").exists() && !sideBySideE2e) {
    apply(plugin = "com.google.gms.google-services")
}

val tauriBuild = project.file("tauri.build.gradle.kts")
if (tauriBuild.exists()) {
    apply(from = "tauri.build.gradle.kts")
} else {
    println("Warning: tauri.build.gradle.kts not found at ${tauriBuild.absolutePath}")
}

# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# JNA's native bootstrap resolves fields such as Pointer.peer by their exact
# Java names. R8 must not rename or remove them in release builds.
-keep class com.sun.jna.** { *; }
-keep interface com.sun.jna.** { *; }

# Matrix Rust Crypto's generated UniFFI/JNA bindings cross the native boundary.
# Preserve their class and member names for the same reason.
-keep class org.matrix.rustcomponents.sdk.crypto.** { *; }
-keep class uniffi.matrix_sdk_crypto.** { *; }

# JNA contains optional desktop AWT helpers which are unreachable on Android.
-dontwarn java.awt.Component
-dontwarn java.awt.GraphicsEnvironment
-dontwarn java.awt.HeadlessException
-dontwarn java.awt.Window

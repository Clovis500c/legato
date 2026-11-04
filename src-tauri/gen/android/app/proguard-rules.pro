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
# Called by name from Rust over JNI (src-tauri/src/mobile/keystore.rs).
-keep class app.legato.mobile.KeystoreCrypto { *; }

# Called by name from Rust over JNI (src-tauri/src/mobile/picked.rs).
-keep class app.legato.mobile.PickedFile { *; }

# wry's WebView field, emptied by MainActivity (wry would pause the WebView as the app leaves the screen): found by type.
-keepclassmembers class app.legato.mobile.WryActivity { app.legato.mobile.RustWebView *; }

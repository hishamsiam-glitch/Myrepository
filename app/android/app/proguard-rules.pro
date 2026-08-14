# Flutter's default embedding classes must survive shrinking/obfuscation.
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Flutter's engine optionally references Play Core "deferred components"
# (dynamic feature delivery) classes that this app doesn't depend on or
# use. Silence R8's missing-class errors for them instead of pulling in
# the play-core library just to satisfy the reference.
-dontwarn com.google.android.play.core.**

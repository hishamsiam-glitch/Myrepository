# R8 reports these Play Core classes as missing because the Flutter embedding
# references deferred-component support that this app does not use. Nothing
# here is on any code path the app takes, so the references are safe to ignore.
-dontwarn com.google.android.play.core.**

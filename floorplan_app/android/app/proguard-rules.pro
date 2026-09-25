# ARCore uses reflection for its JNI bridge; keep its public API intact.
-keep class com.google.ar.core.** { *; }
-dontwarn com.google.ar.core.**
# Flutter's deferred-components support references Play Core classes that
# this app does not ship.
-dontwarn com.google.android.play.core.**

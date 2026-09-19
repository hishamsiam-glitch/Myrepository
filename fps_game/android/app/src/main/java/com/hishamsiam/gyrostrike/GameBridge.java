package com.hishamsiam.gyrostrike;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Display;
import android.view.Surface;
import android.webkit.JavascriptInterface;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Native services exposed to the page as {@code window.AndroidBridge}.
 *
 * <p>Orientation comes from the game rotation vector (gyroscope fused with
 * the accelerometer, no magnetometer, so no compass jitter), falling back to
 * the plain rotation vector and finally to the accelerometer alone (tilt
 * only, no turning). The page polls {@link #getSensors()} once per frame and
 * gets the 3x3 rotation matrix (device frame to world frame, row major) plus
 * the current display rotation, and does the camera maths itself so the
 * browser and Android code paths share one implementation.
 */
public class GameBridge implements SensorEventListener {

    private final AppCompatActivity activity;
    private final SensorManager sensorManager;
    private final SharedPreferences prefs;
    private final Vibrator vibrator;

    private final float[] matrix = new float[9];
    private final float[] scratch = new float[9];
    private final float[] fakeMagnet = {0f, 1f, 0f};
    private final Object lock = new Object();
    private boolean hasSample = false;
    private boolean yawOk = false;
    private String source = "none";
    private Sensor activeSensor;

    GameBridge(AppCompatActivity activity) {
        this.activity = activity;
        sensorManager = (SensorManager) activity.getSystemService(Context.SENSOR_SERVICE);
        prefs = activity.getSharedPreferences("gyrostrike", Context.MODE_PRIVATE);
        vibrator = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        pickSensor();
    }

    private void pickSensor() {
        if (sensorManager == null) return;
        Sensor s = sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
        if (s != null) { activeSensor = s; source = "game_rotation_vector"; yawOk = true; return; }
        s = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (s != null) { activeSensor = s; source = "rotation_vector"; yawOk = true; return; }
        s = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (s != null) { activeSensor = s; source = "accelerometer"; yawOk = false; }
    }

    void start() {
        if (sensorManager != null && activeSensor != null) {
            sensorManager.registerListener(this, activeSensor, SensorManager.SENSOR_DELAY_GAME);
        }
    }

    void stop() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        int type = event.sensor.getType();
        if (type == Sensor.TYPE_GAME_ROTATION_VECTOR || type == Sensor.TYPE_ROTATION_VECTOR) {
            SensorManager.getRotationMatrixFromVector(scratch, event.values);
        } else if (type == Sensor.TYPE_ACCELEROMETER) {
            // Tilt only: any horizontal reference gives a matrix whose pitch
            // and roll are right; the yaw it implies is meaningless and the
            // page is told so via yawOk=false.
            if (!SensorManager.getRotationMatrix(scratch, null, event.values, fakeMagnet)) return;
        } else {
            return;
        }
        synchronized (lock) {
            System.arraycopy(scratch, 0, matrix, 0, 9);
            hasSample = true;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private int displayRotation() {
        Display d;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            d = activity.getDisplay();
        } else {
            d = activity.getWindowManager().getDefaultDisplay();
        }
        if (d == null) return 0;
        switch (d.getRotation()) {
            case Surface.ROTATION_90: return 90;
            case Surface.ROTATION_180: return 180;
            case Surface.ROTATION_270: return 270;
            default: return 0;
        }
    }

    /** Latest orientation as JSON; called by the page every frame. */
    @JavascriptInterface
    public String getSensors() {
        float[] m = new float[9];
        boolean ok;
        synchronized (lock) {
            ok = hasSample;
            System.arraycopy(matrix, 0, m, 0, 9);
        }
        StringBuilder sb = new StringBuilder(160);
        sb.append("{\"ok\":").append(ok)
          .append(",\"yawOk\":").append(yawOk)
          .append(",\"source\":\"").append(source).append('"')
          .append(",\"rot\":").append(displayRotation())
          .append(",\"r\":[");
        for (int i = 0; i < 9; i++) {
            if (i > 0) sb.append(',');
            sb.append(m[i]);
        }
        sb.append("]}");
        return sb.toString();
    }

    @JavascriptInterface
    public boolean hasRotationSensor() {
        return yawOk;
    }

    @JavascriptInterface
    public String getItem(String key) {
        return prefs.getString(key, null);
    }

    @JavascriptInterface
    public void setItem(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    @JavascriptInterface
    public void removeItem(String key) {
        prefs.edit().remove(key).apply();
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        if (vibrator == null || !vibrator.hasVibrator()) return;
        try {
            vibrator.vibrate(VibrationEffect.createOneShot(Math.max(1, Math.min(ms, 500)), VibrationEffect.DEFAULT_AMPLITUDE));
        } catch (Exception ignored) { }
    }
}

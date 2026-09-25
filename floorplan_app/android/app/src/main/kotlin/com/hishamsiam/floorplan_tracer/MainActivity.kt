package com.hishamsiam.floorplan_tracer

import android.Manifest
import android.content.pm.PackageManager
import com.google.ar.core.ArCoreApk
import com.google.ar.core.exceptions.UnavailableDeviceNotCompatibleException
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingPermissionResult: MethodChannel.Result? = null
    private var installRequested = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        flutterEngine.platformViewsController.registry
            .registerViewFactory("floorplan/ar_view", ArTracerViewFactory(messenger, this))

        MethodChannel(messenger, "floorplan/ar").setMethodCallHandler { call, result ->
            when (call.method) {
                "checkAvailability" -> {
                    try {
                        val availability = ArCoreApk.getInstance().checkAvailability(this)
                        result.success(
                            mapOf(
                                "supported" to availability.isSupported,
                                "transient" to availability.isTransient,
                                "status" to availability.name,
                            )
                        )
                    } catch (e: Exception) {
                        result.success(mapOf("supported" to false, "transient" to false, "status" to "ERROR: ${e.message}"))
                    }
                }
                "requestInstall" -> {
                    try {
                        val status = ArCoreApk.getInstance().requestInstall(this, !installRequested)
                        when (status) {
                            ArCoreApk.InstallStatus.INSTALLED -> result.success("installed")
                            ArCoreApk.InstallStatus.INSTALL_REQUESTED -> {
                                installRequested = true
                                result.success("requested")
                            }
                            else -> result.success("unknown")
                        }
                    } catch (e: UnavailableUserDeclinedInstallationException) {
                        result.success("declined")
                    } catch (e: UnavailableDeviceNotCompatibleException) {
                        result.success("unsupported")
                    } catch (e: Exception) {
                        result.success("error: ${e.message}")
                    }
                }
                "hasCameraPermission" -> result.success(hasCamera())
                "requestCameraPermission" -> {
                    if (hasCamera()) {
                        result.success(true)
                    } else if (pendingPermissionResult != null) {
                        result.success(false)
                    } else {
                        pendingPermissionResult = result
                        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_REQUEST)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun hasCamera(): Boolean =
        checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_REQUEST) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingPermissionResult?.success(granted)
            pendingPermissionResult = null
        }
    }

    override fun onResume() {
        super.onResume()
        ArTracerView.current?.resume()
    }

    override fun onPause() {
        ArTracerView.current?.pause()
        super.onPause()
    }

    companion object {
        private const val CAMERA_REQUEST = 4711
    }
}

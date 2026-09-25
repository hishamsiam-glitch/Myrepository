package com.hishamsiam.floorplan_tracer

import android.app.Activity
import android.content.Context
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import android.view.View
import com.google.ar.core.Camera
import com.google.ar.core.Config
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

/**
 * A platform view that runs an ARCore session, renders the camera image, and
 * streams the camera matrices plus a floor "cursor" (where the centre of the
 * screen hits the floor) to Flutter, which draws the tracing overlay itself.
 */
class ArTracerView(
    context: Context,
    private val activity: Activity,
    messenger: BinaryMessenger,
    viewId: Int,
) : PlatformView, GLSurfaceView.Renderer, MethodChannel.MethodCallHandler {

    private val glView = GLSurfaceView(context)
    private val backgroundRenderer = BackgroundRenderer()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val methodChannel = MethodChannel(messenger, "floorplan/ar_view_$viewId")
    private val eventChannel = EventChannel(messenger, "floorplan/ar_events_$viewId")

    @Volatile private var eventSink: EventChannel.EventSink? = null
    @Volatile private var session: Session? = null
    @Volatile private var resumed = false
    private var installRequested = false

    private var viewportWidth = 1
    private var viewportHeight = 1
    private var viewportChanged = false
    private var lastEventTime = 0L
    private var frameCounter = 0L

    // Scratch matrices, GL thread only.
    private val viewMatrix = FloatArray(16)
    private val projMatrix = FloatArray(16)
    private val viewProj = FloatArray(16)
    private val invViewProj = FloatArray(16)
    private val nearPoint = FloatArray(4)
    private val farPoint = FloatArray(4)

    // Cursor state shared with the method channel (main thread reads).
    @Volatile private var lastCursor: DoubleArray? = null
    @Volatile private var lastFloorY: Double? = null

    private var sessionError: String? = null

    init {
        glView.preserveEGLContextOnPause = true
        glView.setEGLContextClientVersion(2)
        glView.setEGLConfigChooser(8, 8, 8, 8, 16, 0)
        glView.setRenderer(this)
        glView.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        glView.setWillNotDraw(false)

        methodChannel.setMethodCallHandler(this)
        eventChannel.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                eventSink = events
                sessionError?.let { err -> events?.success(mapOf("error" to err)) }
            }

            override fun onCancel(arguments: Any?) {
                eventSink = null
            }
        })

        current = this
        createSession()
        resume()
    }

    private fun createSession() {
        try {
            val s = Session(activity)
            val config = Config(s)
            config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL
            config.updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
            config.focusMode = Config.FocusMode.AUTO
            config.lightEstimationMode = Config.LightEstimationMode.DISABLED
            if (s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                // Depth improves hit-testing against floors near walls.
                config.depthMode = Config.DepthMode.AUTOMATIC
            }
            s.configure(config)
            session = s
        } catch (e: Exception) {
            sessionError = e.javaClass.simpleName + ": " + (e.message ?: "")
            postEvent(mapOf("error" to sessionError!!))
        }
    }

    fun resume() {
        if (resumed) return
        val s = session ?: return
        try {
            s.resume()
            resumed = true
            glView.onResume()
        } catch (e: CameraNotAvailableException) {
            sessionError = "Camera not available: ${e.message}"
            postEvent(mapOf("error" to sessionError!!))
        } catch (e: Exception) {
            sessionError = e.javaClass.simpleName + ": " + (e.message ?: "")
            postEvent(mapOf("error" to sessionError!!))
        }
    }

    fun pause() {
        if (!resumed) return
        resumed = false
        glView.onPause()
        session?.pause()
    }

    override fun getView(): View = glView

    override fun dispose() {
        pause()
        methodChannel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
        eventSink = null
        session?.close()
        session = null
        if (current === this) current = null
    }

    override fun onMethodCall(call: io.flutter.plugin.common.MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getCursor" -> result.success(lastCursor?.toList())
            "getFloorY" -> result.success(lastFloorY)
            else -> result.notImplemented()
        }
    }

    // ------------------------------------------------------------ rendering

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0.05f, 0.05f, 0.05f, 1f)
        backgroundRenderer.createOnGlThread()
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
        viewportWidth = max(1, width)
        viewportHeight = max(1, height)
        viewportChanged = true
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val s = session ?: return
        if (!resumed) return

        if (viewportChanged) {
            @Suppress("DEPRECATION")
            val rotation = activity.windowManager.defaultDisplay?.rotation ?: Surface.ROTATION_0
            s.setDisplayGeometry(rotation, viewportWidth, viewportHeight)
            viewportChanged = false
        }
        s.setCameraTextureName(backgroundRenderer.textureId)

        val frame: Frame = try {
            s.update()
        } catch (e: CameraNotAvailableException) {
            postEvent(mapOf("error" to "Camera not available"))
            return
        } catch (e: Exception) {
            postEvent(mapOf("error" to (e.message ?: e.javaClass.simpleName)))
            return
        }

        backgroundRenderer.draw(frame)
        frameCounter++

        val now = SystemClock.uptimeMillis()
        if (now - lastEventTime < 33) return // ~30 events per second is plenty
        lastEventTime = now

        val camera = frame.camera
        camera.getViewMatrix(viewMatrix, 0)
        camera.getProjectionMatrix(projMatrix, 0, 0.05f, 50f)

        val planes = s.getAllTrackables(Plane::class.java)
            .filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }

        val floor = pickFloor(planes)
        val floorY = floor?.centerPose?.ty()?.toDouble()
        lastFloorY = floorY

        val cursor = computeCursor(frame, camera, planes, floorY)
        lastCursor = cursor?.first

        val event = HashMap<String, Any?>()
        event["tracking"] = camera.trackingState.name
        event["reason"] = camera.trackingFailureReason.name
        event["floor"] = floorY != null
        event["floorY"] = floorY
        event["cursor"] = cursor?.first?.toList()
        event["cursorOnPlane"] = cursor?.second ?: false
        event["view"] = viewMatrix.map { it.toDouble() }
        event["proj"] = projMatrix.map { it.toDouble() }
        val camPose = camera.pose
        event["camera"] = listOf(camPose.tx().toDouble(), camPose.ty().toDouble(), camPose.tz().toDouble())
        if (frameCounter % 4 == 0L) {
            event["planes"] = planes.take(8).map { planePolygonWorld(it) }
        }
        postEvent(event)
    }

    /** The floor is the lowest tracked horizontal plane with a sensible area. */
    private fun pickFloor(planes: List<Plane>): Plane? {
        var best: Plane? = null
        for (p in planes) {
            val area = p.extentX * p.extentZ
            if (area < 0.2f) continue
            if (best == null || p.centerPose.ty() < best.centerPose.ty() - 0.05f) best = p
        }
        return best
    }

    /**
     * Where the ray through the screen centre meets the floor. Prefers a
     * real ARCore hit on a tracked plane polygon, then a hit within a plane's
     * extents, then an analytic intersection with the infinite floor plane
     * so corners along walls can be marked even where no plane was detected.
     */
    private fun computeCursor(frame: Frame, camera: Camera, planes: List<Plane>, floorY: Double?): Pair<DoubleArray, Boolean>? {
        if (camera.trackingState != TrackingState.TRACKING) return null
        val cx = viewportWidth / 2f
        val cy = viewportHeight / 2f
        try {
            val hits = frame.hitTest(cx, cy)
            var inExtents: DoubleArray? = null
            for (hit in hits) {
                val t = hit.trackable
                if (t is Plane && t.type == Plane.Type.HORIZONTAL_UPWARD_FACING && t.trackingState == TrackingState.TRACKING) {
                    val pose = hit.hitPose
                    if (t.isPoseInPolygon(pose)) {
                        return Pair(doubleArrayOf(pose.tx().toDouble(), pose.ty().toDouble(), pose.tz().toDouble()), true)
                    }
                    if (inExtents == null && t.isPoseInExtents(pose)) {
                        inExtents = doubleArrayOf(pose.tx().toDouble(), pose.ty().toDouble(), pose.tz().toDouble())
                    }
                }
            }
            if (inExtents != null) return Pair(inExtents, true)
        } catch (_: Exception) {
            // hitTest can throw if the frame is stale; fall through.
        }
        if (floorY == null) return null

        // Analytic ray/plane intersection.
        Matrix.multiplyMM(viewProj, 0, projMatrix, 0, viewMatrix, 0)
        if (!Matrix.invertM(invViewProj, 0, viewProj, 0)) return null
        val ndc = floatArrayOf(0f, 0f, -1f, 1f)
        Matrix.multiplyMV(nearPoint, 0, invViewProj, 0, ndc, 0)
        ndc[2] = 1f
        Matrix.multiplyMV(farPoint, 0, invViewProj, 0, ndc, 0)
        if (abs(nearPoint[3]) < 1e-6f || abs(farPoint[3]) < 1e-6f) return null
        for (i in 0..2) {
            nearPoint[i] /= nearPoint[3]
            farPoint[i] /= farPoint[3]
        }
        val dx = farPoint[0] - nearPoint[0]
        val dy = farPoint[1] - nearPoint[1]
        val dz = farPoint[2] - nearPoint[2]
        if (abs(dy) < 1e-6f) return null
        val t = (floorY.toFloat() - nearPoint[1]) / dy
        if (t <= 0f) return null
        val x = nearPoint[0] + dx * t
        val z = nearPoint[2] + dz * t
        val dist = sqrt((x - nearPoint[0]) * (x - nearPoint[0]) + (z - nearPoint[2]) * (z - nearPoint[2]))
        if (dist > 20f) return null
        return Pair(doubleArrayOf(x.toDouble(), floorY, z.toDouble()), false)
    }

    private fun planePolygonWorld(plane: Plane): List<Double> {
        val poly = plane.polygon
        val n = poly.limit() / 2
        val step = max(1, n / 24)
        val out = ArrayList<Double>()
        val local = FloatArray(3)
        var i = 0
        while (i < n) {
            local[0] = poly.get(i * 2)
            local[1] = 0f
            local[2] = poly.get(i * 2 + 1)
            val world = plane.centerPose.transformPoint(local)
            out.add(world[0].toDouble())
            out.add(world[1].toDouble())
            out.add(world[2].toDouble())
            i += step
        }
        return out
    }

    private fun postEvent(event: Map<String, Any?>) {
        mainHandler.post { eventSink?.success(event) }
    }

    companion object {
        /** The live view, so the activity can forward lifecycle events. */
        @Volatile var current: ArTracerView? = null
    }
}

class ArTracerViewFactory(
    private val messenger: BinaryMessenger,
    private val activity: Activity,
) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView {
        return ArTracerView(context, activity, messenger, viewId)
    }
}

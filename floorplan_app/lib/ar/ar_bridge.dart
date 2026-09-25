import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:vector_math/vector_math_64.dart' hide Colors;

/// Static helpers for ARCore availability and the camera permission,
/// implemented natively in MainActivity.kt.
class ArSupport {
  static const _channel = MethodChannel('floorplan/ar');

  static bool get isAndroid =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Returns (supported, transient, status). When `transient` is true the
  /// availability is still being determined and the caller should retry.
  static Future<ArAvailability> checkAvailability() async {
    if (!isAndroid) return const ArAvailability(false, false, 'NOT_ANDROID');
    try {
      final r = await _channel.invokeMapMethod<String, dynamic>('checkAvailability');
      return ArAvailability(
        r?['supported'] == true,
        r?['transient'] == true,
        r?['status'] as String? ?? 'UNKNOWN',
      );
    } on MissingPluginException {
      return const ArAvailability(false, false, 'NO_NATIVE');
    }
  }

  /// "installed", "requested", "declined", "unsupported" or an error text.
  static Future<String> requestInstall() async {
    if (!isAndroid) return 'unsupported';
    try {
      return await _channel.invokeMethod<String>('requestInstall') ?? 'unknown';
    } on MissingPluginException {
      return 'unsupported';
    }
  }

  static Future<bool> hasCameraPermission() async {
    if (!isAndroid) return false;
    try {
      return await _channel.invokeMethod<bool>('hasCameraPermission') ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> requestCameraPermission() async {
    if (!isAndroid) return false;
    try {
      return await _channel.invokeMethod<bool>('requestCameraPermission') ?? false;
    } on MissingPluginException {
      return false;
    }
  }
}

class ArAvailability {
  const ArAvailability(this.supported, this.transient, this.status);
  final bool supported;
  final bool transient;
  final String status;
}

/// One update from the native AR session.
class ArFrame {
  ArFrame({
    required this.tracking,
    required this.reason,
    required this.floorDetected,
    required this.floorY,
    required this.cursor,
    required this.cursorOnPlane,
    required this.view,
    required this.proj,
    required this.cameraPosition,
    required this.planes,
  }) : viewProj = proj * view;

  final String tracking; // TRACKING, PAUSED, STOPPED
  final String reason; // NONE, INSUFFICIENT_LIGHT, EXCESSIVE_MOTION, ...
  final bool floorDetected;
  final double? floorY;
  final Vector3? cursor;
  final bool cursorOnPlane;
  final Matrix4 view;
  final Matrix4 proj;
  final Matrix4 viewProj;
  final Vector3 cameraPosition;

  /// Detected floor planes as world-space polygons (may be stale between
  /// updates, planes are only sent every few frames).
  final List<List<Vector3>> planes;

  bool get isTracking => tracking == 'TRACKING';

  static ArFrame? parse(Map<dynamic, dynamic> m, {List<List<Vector3>>? previousPlanes}) {
    final view = m['view'] as List?;
    final proj = m['proj'] as List?;
    if (view == null || proj == null) return null;
    final cursorRaw = m['cursor'] as List?;
    final cam = (m['camera'] as List?) ?? const [0, 0, 0];
    List<List<Vector3>>? planes;
    final planesRaw = m['planes'] as List?;
    if (planesRaw != null) {
      planes = planesRaw.map((p) {
        final flat = (p as List).map((e) => (e as num).toDouble()).toList();
        final pts = <Vector3>[];
        for (var i = 0; i + 2 < flat.length; i += 3) {
          pts.add(Vector3(flat[i], flat[i + 1], flat[i + 2]));
        }
        return pts;
      }).toList();
    }
    return ArFrame(
      tracking: m['tracking'] as String? ?? 'STOPPED',
      reason: m['reason'] as String? ?? 'NONE',
      floorDetected: m['floor'] == true,
      floorY: (m['floorY'] as num?)?.toDouble(),
      cursor: cursorRaw == null
          ? null
          : Vector3((cursorRaw[0] as num).toDouble(), (cursorRaw[1] as num).toDouble(),
              (cursorRaw[2] as num).toDouble()),
      cursorOnPlane: m['cursorOnPlane'] == true,
      view: Matrix4.fromList(view.map((e) => (e as num).toDouble()).toList()),
      proj: Matrix4.fromList(proj.map((e) => (e as num).toDouble()).toList()),
      cameraPosition: Vector3((cam[0] as num).toDouble(), (cam[1] as num).toDouble(),
          (cam[2] as num).toDouble()),
      planes: planes ?? previousPlanes ?? const [],
    );
  }

  /// Projects a world point to widget coordinates. Returns null when the
  /// point is behind the camera.
  Offset? project(Vector3 world, Size size) {
    final c = viewProj.transform(Vector4(world.x, world.y, world.z, 1));
    if (c.w <= 1e-5) return null;
    return Offset((c.x / c.w + 1) / 2 * size.width, (1 - c.y / c.w) / 2 * size.height);
  }

  /// Projects a segment, clipping it against the camera's near plane so
  /// lines that pass behind the camera still draw correctly.
  List<Offset>? projectSegment(Vector3 a, Vector3 b, Size size) {
    var ca = viewProj.transform(Vector4(a.x, a.y, a.z, 1));
    var cb = viewProj.transform(Vector4(b.x, b.y, b.z, 1));
    const eps = 1e-3;
    if (ca.w < eps && cb.w < eps) return null;
    if (ca.w < eps) {
      final t = (eps - ca.w) / (cb.w - ca.w);
      ca = ca + (cb - ca) * t;
    } else if (cb.w < eps) {
      final t = (eps - cb.w) / (ca.w - cb.w);
      cb = cb + (ca - cb) * t;
    }
    Offset toScreen(Vector4 c) =>
        Offset((c.x / c.w + 1) / 2 * size.width, (1 - c.y / c.w) / 2 * size.height);
    return [toScreen(ca), toScreen(cb)];
  }
}

/// Hosts the native ARCore view and exposes its frame stream.
class ArCameraView extends StatefulWidget {
  const ArCameraView({super.key, required this.onFrame, required this.onError});

  final ValueChanged<ArFrame> onFrame;
  final ValueChanged<String> onError;

  @override
  State<ArCameraView> createState() => _ArCameraViewState();
}

class _ArCameraViewState extends State<ArCameraView> {
  StreamSubscription<dynamic>? _sub;
  List<List<Vector3>> _planes = const [];

  @override
  Widget build(BuildContext context) {
    return PlatformViewLink(
      viewType: 'floorplan/ar_view',
      surfaceFactory: (context, controller) {
        return AndroidViewSurface(
          controller: controller as AndroidViewController,
          gestureRecognizers: const <Factory<OneSequenceGestureRecognizer>>{},
          hitTestBehavior: PlatformViewHitTestBehavior.transparent,
        );
      },
      onCreatePlatformView: (params) {
        final controller = PlatformViewsService.initExpensiveAndroidView(
          id: params.id,
          viewType: params.viewType,
          layoutDirection: TextDirection.ltr,
          creationParams: const <String, dynamic>{},
          creationParamsCodec: const StandardMessageCodec(),
          onFocus: () => params.onFocusChanged(true),
        );
        controller.addOnPlatformViewCreatedListener(params.onPlatformViewCreated);
        controller.addOnPlatformViewCreatedListener(_onCreated);
        controller.create();
        return controller;
      },
    );
  }

  void _onCreated(int id) {
    _sub?.cancel();
    final events = EventChannel('floorplan/ar_events_$id');
    _sub = events.receiveBroadcastStream().listen((event) {
      if (!mounted) return;
      if (event is Map) {
        final err = event['error'];
        if (err != null) {
          widget.onError(err.toString());
          return;
        }
        final frame = ArFrame.parse(event, previousPlanes: _planes);
        if (frame != null) {
          _planes = frame.planes;
          widget.onFrame(frame);
        }
      }
    }, onError: (Object e) => widget.onError(e.toString()));
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

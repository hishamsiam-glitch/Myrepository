import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../ar/ar_bridge.dart';
import '../model/plan.dart';
import '../services/project_store.dart';
import '../widgets/wall_sheet.dart';
import 'ar_trace_screen.dart';
import 'viewer3d_screen.dart';

enum _Tool { select, wall, door, window, opening, scale }

/// The 2D plan editor: pan/zoom canvas, draggable corners, wall tools,
/// door/window placement and an optional photo background with a scale.
class PlanEditorScreen extends StatefulWidget {
  const PlanEditorScreen({super.key, required this.plan, this.openArOnStart = false});

  final FloorPlan plan;
  final bool openArOnStart;

  @override
  State<PlanEditorScreen> createState() => _PlanEditorScreenState();
}

class _PlanEditorScreenState extends State<PlanEditorScreen> {
  FloorPlan get plan => widget.plan;

  _Tool _tool = _Tool.select;
  double _scale = 60; // screen px per metre
  Offset _offset = Offset.zero; // screen position of plan origin
  bool _fitted = false;

  String? _selectedWall;
  String? _selectedVertex;
  String? _chainLast; // last vertex while drawing walls
  final List<Offset> _scalePoints = []; // plan coords (m) while calibrating

  String? _dragVertex;
  Offset? _dragStartFocal;
  Offset _dragStartOffset = Offset.zero;
  double _dragStartScale = 60;

  ui.Image? _bgImage;
  String? _bgPath;

  final List<Map<String, dynamic>> _history = [];
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _loadBackground();
    if (widget.openArOnStart) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _traceWithCamera());
    }
  }

  // ------------------------------------------------------------ coordinates

  Offset _toScreen(double x, double y) => Offset(x * _scale + _offset.dx, y * _scale + _offset.dy);
  Offset _toPlan(Offset s) => Offset((s.dx - _offset.dx) / _scale, (s.dy - _offset.dy) / _scale);

  void _fit(Size size) {
    final b = plan.bounds;
    if (b == null) {
      if (_bgImage != null && plan.background != null) {
        final mpp = plan.background!.metersPerPixel;
        final w = _bgImage!.width * mpp;
        final h = _bgImage!.height * mpp;
        _scale = math.min(size.width / w, size.height / h) * 0.95;
        _offset = Offset((size.width - w * _scale) / 2, (size.height - h * _scale) / 2);
      } else {
        _scale = 60;
        _offset = Offset(size.width / 2, size.height / 2);
      }
      return;
    }
    final w = math.max(1.0, b[2] - b[0]);
    final h = math.max(1.0, b[3] - b[1]);
    _scale = (math.min(size.width / w, size.height / h) * 0.75).clamp(5.0, 400.0);
    final cx = (b[0] + b[2]) / 2;
    final cy = (b[1] + b[3]) / 2;
    _offset = Offset(size.width / 2 - cx * _scale, size.height / 2 - cy * _scale);
  }

  // --------------------------------------------------------------- history

  void _pushHistory() {
    _history.add(plan.toJson());
    if (_history.length > 60) _history.removeAt(0);
  }

  void _undo() {
    if (_history.isEmpty) return;
    final from = FloorPlan.fromJson(_history.removeLast());
    setState(() {
      plan.vertices
        ..clear()
        ..addAll(from.vertices);
      plan.walls
        ..clear()
        ..addAll(from.walls);
      plan.background = from.background;
      _selectedWall = null;
      _selectedVertex = null;
      _chainLast = null;
    });
    _markDirty();
    _loadBackground();
  }

  void _markDirty() {
    _dirty = true;
    ProjectStore.instance.save(plan);
  }

  // ------------------------------------------------------------ background

  Future<void> _loadBackground() async {
    final bg = plan.background;
    if (bg == null) {
      if (_bgImage != null) setState(() => _bgImage = null);
      _bgPath = null;
      return;
    }
    final abs = await ProjectStore.instance.imageAbsolutePath(plan, bg.imagePath);
    if (abs == _bgPath) return;
    final file = File(abs);
    if (!await file.exists()) return;
    final bytes = await file.readAsBytes();
    final img = await decodeImageFromList(bytes);
    if (!mounted) return;
    setState(() {
      _bgImage = img;
      _bgPath = abs;
      _fitted = false;
    });
  }

  Future<void> _pickBackground(ImageSource source) async {
    final file = await ImagePicker().pickImage(source: source, maxWidth: 2048, maxHeight: 2048, imageQuality: 90);
    if (file == null) return;
    final rel = await ProjectStore.instance.importImage(plan, file.path);
    _pushHistory();
    setState(() {
      plan.background = Background(imagePath: rel, metersPerPixel: plan.background?.metersPerPixel ?? 0.01);
      _tool = _Tool.scale;
      _scalePoints.clear();
    });
    _markDirty();
    await _loadBackground();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Tap two points on the photo whose real distance you know to set the scale.'),
      ));
    }
  }

  Future<void> _finishScale() async {
    if (_scalePoints.length != 2 || plan.background == null) return;
    final d = (_scalePoints[1] - _scalePoints[0]).distance;
    final ctrl = TextEditingController();
    final meters = await showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Real distance'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Distance between the two points (m)', suffixText: 'm'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, double.tryParse(ctrl.text.replaceAll(',', '.'))),
            child: const Text('Set scale'),
          ),
        ],
      ),
    );
    setState(() => _scalePoints.clear());
    if (meters == null || meters <= 0 || d < 1e-9) return;
    _pushHistory();
    final factor = meters / d; // new metres per old metre
    setState(() {
      plan.background!.metersPerPixel *= factor;
      plan.scaleAll(factor);
      _scale /= factor; // keep the photo the same size on screen
      _tool = _Tool.wall;
    });
    _markDirty();
  }

  // ----------------------------------------------------------------- input

  Vertex? _vertexAt(Offset s) {
    Vertex? best;
    var bestD = 22.0;
    for (final v in plan.vertices.values) {
      final d = (_toScreen(v.x, v.y) - s).distance;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  Wall? _wallAt(Offset s) {
    Wall? best;
    var bestD = 18.0;
    for (final w in plan.walls) {
      final a = plan.vertices[w.a]!;
      final b = plan.vertices[w.b]!;
      final d = _distToSegment(s, _toScreen(a.x, a.y), _toScreen(b.x, b.y));
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  double _distToSegment(Offset p, Offset a, Offset b) {
    final ab = b - a;
    final len2 = ab.dx * ab.dx + ab.dy * ab.dy;
    if (len2 < 1e-9) return (p - a).distance;
    var t = ((p - a).dx * ab.dx + (p - a).dy * ab.dy) / len2;
    t = t.clamp(0.0, 1.0);
    return (p - (a + ab * t)).distance;
  }

  /// Snaps a plan point to nearby vertices, then to right angles relative to
  /// [from], then to a 5 cm grid.
  Offset _snap(Offset p, {Vertex? from}) {
    final near = plan.findVertexNear(p.dx, p.dy, 14 / _scale);
    if (near != null) return Offset(near.x, near.y);
    if (from != null) {
      final dx = p.dx - from.x;
      final dy = p.dy - from.y;
      final len = math.sqrt(dx * dx + dy * dy);
      if (len > 1e-6) {
        final ang = math.atan2(dy, dx);
        final snapped = (ang / (math.pi / 4)).round() * (math.pi / 4);
        if ((ang - snapped).abs() < 0.12) {
          p = Offset(from.x + math.cos(snapped) * len, from.y + math.sin(snapped) * len);
        }
      }
    }
    return Offset((p.dx * 20).round() / 20, (p.dy * 20).round() / 20);
  }

  void _onTap(Offset s) {
    final p = _toPlan(s);
    switch (_tool) {
      case _Tool.select:
        final v = _vertexAt(s);
        if (v != null) {
          setState(() {
            _selectedVertex = v.id;
            _selectedWall = null;
          });
          return;
        }
        final w = _wallAt(s);
        setState(() {
          _selectedWall = w?.id;
          _selectedVertex = null;
        });
        if (w != null) _openWall(w);
      case _Tool.wall:
        _pushHistory();
        setState(() {
          final from = _chainLast == null ? null : plan.vertices[_chainLast!];
          final sp = _snap(p, from: from);
          var v = plan.findVertexNear(sp.dx, sp.dy, 1e-6);
          v ??= plan.addVertex(sp.dx, sp.dy);
          if (from != null && from.id != v.id) {
            plan.addWall(from.id, v.id);
          }
          _chainLast = v.id;
        });
        _markDirty();
      case _Tool.door:
      case _Tool.window:
      case _Tool.opening:
        final w = _wallAt(s);
        if (w == null) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tap on a wall to place it.')));
          return;
        }
        _pushHistory();
        final a = plan.vertices[w.a]!;
        final b = plan.vertices[w.b]!;
        final len = plan.wallLength(w);
        final t = (((p.dx - a.x) * (b.x - a.x) + (p.dy - a.y) * (b.y - a.y)) / (len * len)).clamp(0.0, 1.0);
        final type = switch (_tool) {
          _Tool.door => OpeningType.door,
          _Tool.window => OpeningType.window,
          _ => OpeningType.opening,
        };
        final width = switch (type) {
          OpeningType.door => 0.9,
          OpeningType.window => 1.2,
          OpeningType.opening => 1.0,
        };
        setState(() {
          plan.addOpening(w, type, t * len - width / 2, width);
          _selectedWall = w.id;
        });
        _markDirty();
      case _Tool.scale:
        setState(() => _scalePoints.add(p));
        if (_scalePoints.length == 2) _finishScale();
    }
  }

  void _onScaleStart(ScaleStartDetails d) {
    _dragStartFocal = d.focalPoint;
    _dragStartOffset = _offset;
    _dragStartScale = _scale;
    _dragVertex = null;
    if (d.pointerCount == 1 && _tool == _Tool.select) {
      final v = _vertexAt(d.localFocalPoint);
      if (v != null) {
        _pushHistory();
        _dragVertex = v.id;
        _selectedVertex = v.id;
      }
    }
  }

  void _onScaleUpdate(ScaleUpdateDetails d) {
    if (_dragVertex != null) {
      if (d.pointerCount > 1) return;
      final v = plan.vertices[_dragVertex!];
      if (v == null) return;
      // Snap relative to the neighbour on the other end of an attached wall.
      Vertex? from;
      for (final w in plan.wallsAt(v.id)) {
        final other = w.a == v.id ? w.b : w.a;
        from = plan.vertices[other];
        break;
      }
      var p = _toPlan(d.localFocalPoint);
      final near = plan.findVertexNear(p.dx, p.dy, 14 / _scale);
      if (near != null && near.id != v.id) {
        p = Offset(near.x, near.y);
      } else {
        p = _snap(p, from: from);
      }
      setState(() => plan.moveVertex(v.id, p.dx, p.dy));
      return;
    }
    setState(() {
      final focal0 = _dragStartFocal ?? d.focalPoint;
      final newScale = (_dragStartScale * d.scale).clamp(5.0, 600.0);
      // Zoom around the focal point, then apply the pan.
      final planAtFocal = Offset(
        (focal0.dx - _dragStartOffset.dx) / _dragStartScale,
        (focal0.dy - _dragStartOffset.dy) / _dragStartScale,
      );
      _scale = newScale;
      _offset = d.focalPoint - Offset(planAtFocal.dx * newScale, planAtFocal.dy * newScale);
    });
  }

  void _onScaleEnd(ScaleEndDetails d) {
    if (_dragVertex != null) {
      final v = plan.vertices[_dragVertex!];
      _dragVertex = null;
      if (v != null) {
        // Merge with a coincident vertex (joining walls).
        final other = plan.vertices.values.where((o) => o.id != v.id && (o.x - v.x).abs() < 1e-6 && (o.y - v.y).abs() < 1e-6).firstOrNull;
        if (other != null) {
          for (final w in plan.walls) {
            if (w.a == v.id) w.a = other.id;
            if (w.b == v.id) w.b = other.id;
          }
          plan.walls.removeWhere((w) => w.a == w.b);
          plan.vertices.remove(v.id);
          _selectedVertex = other.id;
        }
        for (final w in plan.walls) {
          plan.clampOpenings(w);
        }
      }
      setState(() {});
      _markDirty();
    }
  }

  Future<void> _openWall(Wall w) async {
    _pushHistory();
    await showWallSheet(context, plan: plan, wall: w, onChanged: () {
      setState(() {});
      _markDirty();
    });
    if (mounted) setState(() => _selectedWall = plan.wall(w.id)?.id);
  }

  // --------------------------------------------------------------- actions

  Future<void> _traceWithCamera() async {
    if (!ArSupport.isAndroid) {
      _snack('Camera tracing needs an Android phone with ARCore.');
      return;
    }
    var avail = await ArSupport.checkAvailability();
    for (var i = 0; i < 10 && avail.transient; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      avail = await ArSupport.checkAvailability();
    }
    if (!avail.supported) {
      if (avail.status.contains('NOT_INSTALLED') || avail.status.contains('TOO_OLD')) {
        final r = await ArSupport.requestInstall();
        if (r != 'installed') {
          _snack('Google Play Services for AR is required for camera tracing ($r).');
          return;
        }
      } else {
        _snack('This phone does not support ARCore (${avail.status}). Use photo or manual tracing instead.');
        return;
      }
    }
    if (!await ArSupport.hasCameraPermission()) {
      final ok = await ArSupport.requestCameraPermission();
      if (!ok) {
        _snack('Camera permission is needed for tracing.');
        return;
      }
    }
    // ARCore may still need its install step even when "supported".
    final install = await ArSupport.requestInstall();
    if (install != 'installed') {
      _snack('Google Play Services for AR is being installed. Try again once it finishes.');
      return;
    }
    if (!mounted) return;
    _pushHistory();
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ArTraceScreen(plan: plan)));
    if (!mounted) return;
    setState(() => _fitted = false);
    _markDirty();
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _open3d() async {
    if (plan.walls.isEmpty) {
      _snack('Trace or draw some walls first.');
      return;
    }
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => Viewer3DScreen(plan: plan)));
    if (mounted) setState(() {});
    _markDirty();
  }

  Future<void> _setAllHeights() async {
    final ctrl = TextEditingController(text: plan.defaultHeight.toStringAsFixed(2));
    final h = await showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Wall height for all walls'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(suffixText: 'm'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, double.tryParse(ctrl.text.replaceAll(',', '.'))),
            child: const Text('Apply'),
          ),
        ],
      ),
    );
    if (h == null || h <= 0) return;
    _pushHistory();
    setState(() => plan.setAllHeights(h));
    _markDirty();
  }

  Future<void> _rename() async {
    final ctrl = TextEditingController(text: plan.name);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Plan name'),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, ctrl.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    setState(() => plan.name = name);
    _markDirty();
  }

  void _deleteSelected() {
    if (_selectedWall != null) {
      _pushHistory();
      setState(() {
        plan.removeWall(_selectedWall!);
        _selectedWall = null;
      });
      _markDirty();
    } else if (_selectedVertex != null) {
      _pushHistory();
      setState(() {
        for (final w in plan.wallsAt(_selectedVertex!)) {
          plan.removeWall(w.id);
        }
        plan.vertices.remove(_selectedVertex);
        _selectedVertex = null;
      });
      _markDirty();
    }
  }

  // ------------------------------------------------------------------ build

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (didPop, _) {
        if (_dirty) ProjectStore.instance.save(plan);
      },
      child: Scaffold(
        appBar: AppBar(
          title: GestureDetector(onTap: _rename, child: Text(plan.name)),
          actions: [
            IconButton(tooltip: 'Undo', onPressed: _history.isEmpty ? null : _undo, icon: const Icon(Icons.undo)),
            IconButton(
              tooltip: 'Fit to screen',
              onPressed: () => setState(() => _fitted = false),
              icon: const Icon(Icons.fit_screen),
            ),
            FilledButton.tonalIcon(
              onPressed: _open3d,
              icon: const Icon(Icons.view_in_ar),
              label: const Text('3D'),
            ),
            PopupMenuButton<String>(
              onSelected: (v) {
                switch (v) {
                  case 'bg_gallery':
                    _pickBackground(ImageSource.gallery);
                  case 'bg_camera':
                    _pickBackground(ImageSource.camera);
                  case 'bg_scale':
                    setState(() {
                      _tool = _Tool.scale;
                      _scalePoints.clear();
                    });
                  case 'bg_remove':
                    _pushHistory();
                    setState(() => plan.background = null);
                    _markDirty();
                    _loadBackground();
                  case 'heights':
                    _setAllHeights();
                  case 'rename':
                    _rename();
                }
              },
              itemBuilder: (context) => [
                const PopupMenuItem(value: 'bg_gallery', child: ListTile(leading: Icon(Icons.photo_library), title: Text('Photo of a plan from gallery'))),
                const PopupMenuItem(value: 'bg_camera', child: ListTile(leading: Icon(Icons.photo_camera), title: Text('Photograph a paper plan'))),
                if (plan.background != null)
                  const PopupMenuItem(value: 'bg_scale', child: ListTile(leading: Icon(Icons.straighten), title: Text('Set photo scale'))),
                if (plan.background != null)
                  const PopupMenuItem(value: 'bg_remove', child: ListTile(leading: Icon(Icons.hide_image), title: Text('Remove photo'))),
                const PopupMenuDivider(),
                const PopupMenuItem(value: 'heights', child: ListTile(leading: Icon(Icons.height), title: Text('Set height of all walls'))),
                const PopupMenuItem(value: 'rename', child: ListTile(leading: Icon(Icons.edit), title: Text('Rename plan'))),
              ],
            ),
          ],
        ),
        body: Column(
          children: [
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final size = Size(constraints.maxWidth, constraints.maxHeight);
                  if (!_fitted) {
                    _fit(size);
                    _fitted = true;
                  }
                  return GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTapUp: (d) => _onTap(d.localPosition),
                    onScaleStart: _onScaleStart,
                    onScaleUpdate: _onScaleUpdate,
                    onScaleEnd: _onScaleEnd,
                    child: ClipRect(
                      child: CustomPaint(
                        size: size,
                        painter: _PlanPainter(
                          plan: plan,
                          scale: _scale,
                          offset: _offset,
                          background: _bgImage,
                          selectedWall: _selectedWall,
                          selectedVertex: _selectedVertex,
                          chainLast: _chainLast,
                          scalePoints: _scalePoints,
                          textStyle: Theme.of(context).textTheme.labelSmall!,
                          colorScheme: scheme,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            _buildToolbar(context),
          ],
        ),
        floatingActionButton: _tool == _Tool.wall && _chainLast != null
            ? FloatingActionButton.extended(
                onPressed: () => setState(() => _chainLast = null),
                icon: const Icon(Icons.stop),
                label: const Text('Finish chain'),
              )
            : (_selectedWall != null || _selectedVertex != null) && _tool == _Tool.select
                ? FloatingActionButton.extended(
                    onPressed: _deleteSelected,
                    icon: const Icon(Icons.delete_outline),
                    label: Text(_selectedWall != null ? 'Delete wall' : 'Delete corner'),
                  )
                : null,
      ),
    );
  }

  Widget _buildToolbar(BuildContext context) {
    final hint = switch (_tool) {
      _Tool.select => 'Tap a wall to edit it, drag corners to move them. Pinch to zoom.',
      _Tool.wall => _chainLast == null ? 'Tap where the wall starts.' : 'Tap the next corner. Tap "Finish chain" to stop.',
      _Tool.door => 'Tap a wall to add a door.',
      _Tool.window => 'Tap a wall to add a window.',
      _Tool.opening => 'Tap a wall to add an open doorway.',
      _Tool.scale => _scalePoints.isEmpty
          ? 'Tap the first point of a known distance on the photo.'
          : 'Tap the second point.',
    };
    return Material(
      elevation: 8,
      color: Theme.of(context).colorScheme.surfaceContainer,
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
              child: Text(hint, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  _toolButton(_Tool.select, Icons.touch_app, 'Select'),
                  _toolButton(_Tool.wall, Icons.timeline, 'Wall'),
                  _toolButton(_Tool.door, Icons.door_front_door_outlined, 'Door'),
                  _toolButton(_Tool.window, Icons.window_outlined, 'Window'),
                  _toolButton(_Tool.opening, Icons.crop_portrait, 'Opening'),
                  if (plan.background != null) _toolButton(_Tool.scale, Icons.straighten, 'Scale'),
                  const SizedBox(width: 8),
                  FilledButton.icon(
                    onPressed: _traceWithCamera,
                    icon: const Icon(Icons.camera_alt),
                    label: const Text('Trace with camera'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _toolButton(_Tool t, IconData icon, String label) {
    final selected = _tool == t;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: ChoiceChip(
        avatar: Icon(icon, size: 18, color: selected ? scheme.onSecondaryContainer : null),
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        onSelected: (_) => setState(() {
          _tool = t;
          _chainLast = null;
          _scalePoints.clear();
          if (t != _Tool.select) {
            _selectedVertex = null;
          }
        }),
      ),
    );
  }
}

class _PlanPainter extends CustomPainter {
  _PlanPainter({
    required this.plan,
    required this.scale,
    required this.offset,
    required this.background,
    required this.selectedWall,
    required this.selectedVertex,
    required this.chainLast,
    required this.scalePoints,
    required this.textStyle,
    required this.colorScheme,
  });

  final FloorPlan plan;
  final double scale;
  final Offset offset;
  final ui.Image? background;
  final String? selectedWall;
  final String? selectedVertex;
  final String? chainLast;
  final List<Offset> scalePoints;
  final TextStyle textStyle;
  final ColorScheme colorScheme;

  Offset _s(double x, double y) => Offset(x * scale + offset.dx, y * scale + offset.dy);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = colorScheme.surface);

    // Background photo.
    final bg = background;
    if (bg != null && plan.background != null) {
      final mpp = plan.background!.metersPerPixel;
      final dst = Rect.fromLTWH(offset.dx, offset.dy, bg.width * mpp * scale, bg.height * mpp * scale);
      canvas.drawImageRect(
        bg,
        Rect.fromLTWH(0, 0, bg.width.toDouble(), bg.height.toDouble()),
        dst,
        Paint()..filterQuality = FilterQuality.medium,
      );
    } else {
      _drawGrid(canvas, size);
    }

    // Walls.
    for (final w in plan.walls) {
      final a = plan.vertices[w.a]!;
      final b = plan.vertices[w.b]!;
      final pa = _s(a.x, a.y);
      final pb = _s(b.x, b.y);
      final thick = math.max(4.0, w.thickness * scale);
      final selected = w.id == selectedWall;
      canvas.drawLine(
        pa,
        pb,
        Paint()
          ..color = selected ? colorScheme.primary : colorScheme.onSurface.withValues(alpha: 0.8)
          ..strokeWidth = thick
          ..strokeCap = StrokeCap.round,
      );
      final len = plan.wallLength(w);
      if (len > 1e-6) {
        final dir = (pb - pa) / (pb - pa).distance;
        for (final o in w.openings) {
          final p0 = pa + dir * (o.offset * scale);
          final p1 = pa + dir * (o.end * scale);
          _drawOpening(canvas, o, p0, p1, thick, dir);
        }
        // Length label, offset to the side of the wall.
        final mid = (pa + pb) / 2;
        final normal = Offset(-dir.dy, dir.dx);
        _label(canvas, mid + normal * (thick / 2 + 12), fmtMeters(len));
      }
    }

    // Vertices.
    for (final v in plan.vertices.values) {
      final p = _s(v.x, v.y);
      final sel = v.id == selectedVertex || v.id == chainLast;
      canvas.drawCircle(p, sel ? 9 : 6, Paint()..color = sel ? colorScheme.tertiary : colorScheme.surface);
      canvas.drawCircle(
        p,
        sel ? 9 : 6,
        Paint()
          ..color = colorScheme.onSurface
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }

    // Scale calibration points.
    for (final p in scalePoints) {
      final s = _s(p.dx, p.dy);
      canvas.drawCircle(s, 8, Paint()..color = Colors.redAccent);
    }
    if (scalePoints.length == 2) {
      canvas.drawLine(_s(scalePoints[0].dx, scalePoints[0].dy), _s(scalePoints[1].dx, scalePoints[1].dy),
          Paint()..color = Colors.redAccent..strokeWidth = 3);
    }
  }

  void _drawGrid(Canvas canvas, Size size) {
    final minor = Paint()..color = colorScheme.onSurface.withValues(alpha: 0.06);
    final major = Paint()..color = colorScheme.onSurface.withValues(alpha: 0.16);
    final step = scale; // 1 m
    if (step < 8) return;
    final x0 = offset.dx % step;
    final y0 = offset.dy % step;
    final ix0 = ((-offset.dx) / step).floor();
    final iy0 = ((-offset.dy) / step).floor();
    var i = ix0;
    for (var x = x0; x <= size.width; x += step, i++) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), i % 5 == 0 ? major : minor);
    }
    var j = iy0;
    for (var y = y0; y <= size.height; y += step, j++) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), j % 5 == 0 ? major : minor);
    }
  }

  void _drawOpening(Canvas canvas, Opening o, Offset p0, Offset p1, double thick, Offset dir) {
    // Cut the wall.
    canvas.drawLine(p0, p1, Paint()..color = colorScheme.surface..strokeWidth = thick + 1);
    final normal = Offset(-dir.dy, dir.dx);
    switch (o.type) {
      case OpeningType.door:
        final paint = Paint()
          ..color = Colors.orange.shade800
          ..strokeWidth = 2
          ..style = PaintingStyle.stroke;
        final w = (p1 - p0).distance;
        // Door leaf and swing arc.
        canvas.drawLine(p0, p0 + normal * w, paint);
        final rect = Rect.fromCircle(center: p0, radius: w);
        final start = math.atan2(dir.dy, dir.dx);
        final end = math.atan2(normal.dy, normal.dx);
        var sweep = end - start;
        while (sweep > math.pi) {
          sweep -= 2 * math.pi;
        }
        while (sweep < -math.pi) {
          sweep += 2 * math.pi;
        }
        canvas.drawArc(rect, start, sweep, false, paint);
        canvas.drawLine(p0, p1, Paint()..color = paint.color..strokeWidth = 1.5);
      case OpeningType.window:
        final paint = Paint()
          ..color = Colors.blue.shade600
          ..strokeWidth = 2;
        canvas.drawLine(p0 + normal * (thick / 4), p1 + normal * (thick / 4), paint);
        canvas.drawLine(p0 - normal * (thick / 4), p1 - normal * (thick / 4), paint);
        canvas.drawLine(p0 + normal * (thick / 2), p0 - normal * (thick / 2), paint);
        canvas.drawLine(p1 + normal * (thick / 2), p1 - normal * (thick / 2), paint);
      case OpeningType.opening:
        final paint = Paint()
          ..color = Colors.purple.shade400
          ..strokeWidth = 1.5;
        final n = ((p1 - p0).distance / 8).ceil().clamp(1, 40);
        for (var i = 0; i < n; i++) {
          final t0 = i / n;
          final t1 = (i + 0.5) / n;
          canvas.drawLine(p0 + (p1 - p0) * t0, p0 + (p1 - p0) * t1, paint);
        }
    }
  }

  void _label(Canvas canvas, Offset at, String text) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: textStyle.copyWith(color: colorScheme.onSurface)),
      textDirection: TextDirection.ltr,
    )..layout();
    final rect = Rect.fromCenter(center: at, width: tp.width + 8, height: tp.height + 4);
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(4)),
        Paint()..color = colorScheme.surface.withValues(alpha: 0.85));
    tp.paint(canvas, rect.topLeft + const Offset(4, 2));
  }

  @override
  bool shouldRepaint(covariant _PlanPainter old) => true;
}

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:vector_math/vector_math_64.dart' hide Colors;

import '../ar/ar_bridge.dart';
import '../model/plan.dart';

/// Traces walls by aiming the phone at floor corners in AR. Returns when the
/// user taps Done; the plan is edited in place.
class ArTraceScreen extends StatefulWidget {
  const ArTraceScreen({super.key, required this.plan});

  final FloorPlan plan;

  @override
  State<ArTraceScreen> createState() => _ArTraceScreenState();
}

class _Mark {
  _Mark(this.type, this.start);
  final OpeningType type;
  final Vector3 start;
  Vector3? end;
}

class _Snapshot {
  _Snapshot(this.plan, this.chain, this.marks, this.vertexY);
  final Map<String, dynamic> plan;
  final List<String> chain;
  final List<_Mark> marks;
  final Map<String, double> vertexY;
}

class _ArTraceScreenState extends State<ArTraceScreen> {
  ArFrame? _frame;
  String? _error;
  final List<String> _chain = [];
  final List<_Mark> _marks = [];
  final Map<String, double> _vertexY = {};
  final List<_Snapshot> _history = [];
  String? _hint;
  DateTime _hintUntil = DateTime.now();

  FloorPlan get plan => widget.plan;

  void _showHint(String text) {
    setState(() {
      _hint = text;
      _hintUntil = DateTime.now().add(const Duration(seconds: 3));
    });
  }

  void _pushHistory() {
    _history.add(_Snapshot(
      plan.toJson(),
      List.of(_chain),
      _marks.map((m) => _Mark(m.type, m.start)..end = m.end).toList(),
      Map.of(_vertexY),
    ));
    if (_history.length > 50) _history.removeAt(0);
  }

  void _restore(FloorPlan from) {
    plan.vertices
      ..clear()
      ..addAll(from.vertices);
    plan.walls
      ..clear()
      ..addAll(from.walls);
  }

  void _undo() {
    if (_history.isEmpty) return;
    final s = _history.removeLast();
    setState(() {
      _restore(FloorPlan.fromJson(s.plan));
      _chain
        ..clear()
        ..addAll(s.chain);
      _marks
        ..clear()
        ..addAll(s.marks);
      _vertexY
        ..clear()
        ..addAll(s.vertexY);
    });
  }

  Vector3? get _cursor => _frame?.cursor;

  void _addCorner() {
    final c = _cursor;
    if (c == null) {
      _showHint('Aim the centre of the screen at the floor first');
      return;
    }
    _pushHistory();
    setState(() {
      final existing = plan.findVertexNear(c.x, c.z, 0.2);
      Vertex v;
      if (existing != null) {
        v = existing;
      } else {
        v = plan.addVertex(c.x, c.z);
        _vertexY[v.id] = c.y;
      }
      if (_chain.isNotEmpty) {
        final last = _chain.last;
        if (last == v.id) return;
        final w = plan.addWall(last, v.id);
        _applyMarks(w);
        if (_chain.length >= 2 && v.id == _chain.first) {
          // Snapped back onto the first corner: the room is closed.
          _chain.clear();
          _showHint('Room closed');
          return;
        }
      }
      _chain.add(v.id);
    });
  }

  /// Converts pending door/window marks into openings on the new wall.
  void _applyMarks(Wall w) {
    final a = plan.vertices[w.a]!;
    final b = plan.vertices[w.b]!;
    final len = plan.wallLength(w);
    if (len < 1e-6) {
      _marks.clear();
      return;
    }
    final ux = (b.x - a.x) / len;
    final uy = (b.y - a.y) / len;
    double along(Vector3 p) => (p.x - a.x) * ux + (p.z - a.y) * uy;
    for (final m in _marks) {
      final end = m.end;
      if (end == null) continue;
      final s = along(m.start);
      final e = along(end);
      final o0 = math.min(s, e);
      final o1 = math.max(s, e);
      if (o1 - o0 < 0.05) continue;
      plan.addOpening(w, m.type, o0, o1 - o0);
    }
    _marks.clear();
  }

  void _mark(OpeningType type) {
    final c = _cursor;
    if (c == null) {
      _showHint('Aim at the floor under the ${type.label.toLowerCase()} edge');
      return;
    }
    if (_chain.isEmpty) {
      _showHint('Add the wall\'s first corner before marking a ${type.label.toLowerCase()}');
      return;
    }
    _pushHistory();
    setState(() {
      final open = _marks.where((m) => m.end == null).toList();
      if (open.isNotEmpty) {
        final m = open.last;
        if (m.type == type) {
          m.end = c;
          _showHint('${type.label} marked. Now add the wall\'s next corner');
          return;
        }
        _marks.remove(m);
      }
      _marks.add(_Mark(type, c));
      _showHint('${type.label} start set. Aim at its other edge and tap ${type.label} again');
    });
  }

  void _closeRoom() {
    if (_chain.length < 3) {
      _showHint('Add at least three corners to close a room');
      return;
    }
    _pushHistory();
    setState(() {
      final w = plan.addWall(_chain.last, _chain.first);
      _applyMarks(w);
      _chain.clear();
    });
  }

  void _newChain() {
    if (_chain.isEmpty && _marks.isEmpty) return;
    _pushHistory();
    setState(() {
      _chain.clear();
      _marks.clear();
    });
  }

  Future<void> _done() async {
    // A lone corner without a wall is useless; drop it.
    plan.pruneOrphanVertices();
    Navigator.of(context).pop(true);
  }

  String get _statusText {
    if (_error != null) return _error!;
    final f = _frame;
    if (f == null) return 'Starting camera…';
    if (!f.isTracking) {
      return switch (f.reason) {
        'INSUFFICIENT_LIGHT' => 'Too dark. Turn on the lights.',
        'EXCESSIVE_MOTION' => 'Moving too fast. Slow down.',
        'INSUFFICIENT_FEATURES' => 'Point at a textured surface and move slowly.',
        'CAMERA_UNAVAILABLE' => 'Camera unavailable.',
        _ => 'Move the phone slowly to start tracking…',
      };
    }
    if (!f.floorDetected) return 'Slowly sweep the phone over the floor to detect it';
    if (_chain.isEmpty) return 'Aim the centre at a floor corner and tap "Add corner"';
    return 'Walk along the wall, aim at the next corner';
  }

  @override
  Widget build(BuildContext context) {
    final hintVisible = _hint != null && DateTime.now().isBefore(_hintUntil);
    final theme = Theme.of(context);
    Vector3? lastVertex;
    if (_chain.isNotEmpty) {
      final v = plan.vertices[_chain.last]!;
      lastVertex = Vector3(v.x, _vertexY[v.id] ?? _frame?.floorY ?? 0, v.y);
    }
    final cursor = _cursor;
    double? liveLength;
    if (lastVertex != null && cursor != null) {
      liveLength = math.sqrt(math.pow(cursor.x - lastVertex.x, 2) + math.pow(cursor.z - lastVertex.z, 2));
    }
    final openMark = _marks.where((m) => m.end == null).toList();

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          ArCameraView(
            onFrame: (f) => setState(() => _frame = f),
            onError: (e) => setState(() => _error = e),
          ),
          IgnorePointer(
            child: CustomPaint(
              painter: _ArOverlayPainter(
                frame: _frame,
                plan: plan,
                chain: _chain,
                marks: _marks,
                vertexY: _vertexY,
                textStyle: theme.textTheme.labelMedium!.copyWith(color: Colors.white),
              ),
            ),
          ),
          // Top bar.
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                  child: Row(
                    children: [
                      IconButton.filledTonal(
                        onPressed: () => Navigator.of(context).pop(true),
                        icon: const Icon(Icons.arrow_back),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _Pill(
                          child: Text(_statusText, style: const TextStyle(color: Colors.white)),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _Pill(
                      child: Text(
                        'Walls: ${plan.walls.length}   Total: ${fmtMeters(plan.totalWallLength)}',
                        style: const TextStyle(color: Colors.white70),
                      ),
                    ),
                  ],
                ),
                if (hintVisible) ...[
                  const SizedBox(height: 6),
                  _Pill(
                    color: theme.colorScheme.primaryContainer,
                    child: Text(_hint!, style: TextStyle(color: theme.colorScheme.onPrimaryContainer)),
                  ),
                ],
              ],
            ),
          ),
          // Live measurement near the centre.
          if (liveLength != null)
            Align(
              alignment: const Alignment(0, -0.18),
              child: _Pill(
                color: Colors.black87,
                child: Text(
                  fmtMeters(liveLength),
                  style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                ),
              ),
            ),
          // Bottom controls.
          Align(
            alignment: Alignment.bottomCenter,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _MarkButton(
                          icon: Icons.door_front_door_outlined,
                          label: openMark.isNotEmpty && openMark.last.type == OpeningType.door ? 'Door end' : 'Door',
                          active: openMark.isNotEmpty && openMark.last.type == OpeningType.door,
                          onTap: () => _mark(OpeningType.door),
                        ),
                        _MarkButton(
                          icon: Icons.window_outlined,
                          label: openMark.isNotEmpty && openMark.last.type == OpeningType.window ? 'Window end' : 'Window',
                          active: openMark.isNotEmpty && openMark.last.type == OpeningType.window,
                          onTap: () => _mark(OpeningType.window),
                        ),
                        _MarkButton(
                          icon: Icons.crop_portrait,
                          label: openMark.isNotEmpty && openMark.last.type == OpeningType.opening ? 'Opening end' : 'Opening',
                          active: openMark.isNotEmpty && openMark.last.type == OpeningType.opening,
                          onTap: () => _mark(OpeningType.opening),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        _SmallButton(
                          icon: Icons.undo,
                          label: 'Undo',
                          onTap: _history.isEmpty ? null : _undo,
                        ),
                        const Spacer(),
                        SizedBox(
                          width: 92,
                          height: 92,
                          child: FilledButton(
                            style: FilledButton.styleFrom(
                              shape: const CircleBorder(),
                              padding: EdgeInsets.zero,
                              backgroundColor: cursor == null ? Colors.grey.shade700 : null,
                            ),
                            onPressed: _addCorner,
                            child: const Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.add_location_alt, size: 30),
                                Text('Add corner', style: TextStyle(fontSize: 11)),
                              ],
                            ),
                          ),
                        ),
                        const Spacer(),
                        _SmallButton(
                          icon: Icons.check,
                          label: 'Done',
                          onTap: _done,
                          filled: true,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        TextButton.icon(
                          onPressed: _chain.length >= 3 ? _closeRoom : null,
                          icon: const Icon(Icons.check_box_outline_blank, size: 18),
                          label: const Text('Close room'),
                          style: TextButton.styleFrom(foregroundColor: Colors.white),
                        ),
                        TextButton.icon(
                          onPressed: _chain.isEmpty && _marks.isEmpty ? null : _newChain,
                          icon: const Icon(Icons.linear_scale, size: 18),
                          label: const Text('New wall chain'),
                          style: TextButton.styleFrom(foregroundColor: Colors.white),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.child, this.color});
  final Widget child;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: color ?? Colors.black54,
        borderRadius: BorderRadius.circular(20),
      ),
      child: child,
    );
  }
}

class _MarkButton extends StatelessWidget {
  const _MarkButton({required this.icon, required this.label, required this.active, required this.onTap});
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: active ? scheme.tertiary : Colors.black54,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: active ? scheme.onTertiary : Colors.white),
              Text(label, style: TextStyle(color: active ? scheme.onTertiary : Colors.white, fontSize: 11)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SmallButton extends StatelessWidget {
  const _SmallButton({required this.icon, required this.label, required this.onTap, this.filled = false});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final enabled = onTap != null;
    return Material(
      color: filled ? scheme.tertiaryContainer : Colors.black54,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: filled ? scheme.onTertiaryContainer : (enabled ? Colors.white : Colors.white38)),
              Text(label,
                  style: TextStyle(
                      color: filled ? scheme.onTertiaryContainer : (enabled ? Colors.white : Colors.white38),
                      fontSize: 11)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ArOverlayPainter extends CustomPainter {
  _ArOverlayPainter({
    required this.frame,
    required this.plan,
    required this.chain,
    required this.marks,
    required this.vertexY,
    required this.textStyle,
  });

  final ArFrame? frame;
  final FloorPlan plan;
  final List<String> chain;
  final List<_Mark> marks;
  final Map<String, double> vertexY;
  final TextStyle textStyle;

  Vector3 _world(Vertex v) => Vector3(v.x, vertexY[v.id] ?? frame?.floorY ?? 0, v.y);

  @override
  void paint(Canvas canvas, Size size) {
    final f = frame;
    final center = Offset(size.width / 2, size.height / 2);
    if (f == null) {
      _drawReticle(canvas, center, Colors.white38, false);
      return;
    }

    // Detected floor planes.
    final planePaint = Paint()
      ..color = Colors.lightBlueAccent.withValues(alpha: 0.12)
      ..style = PaintingStyle.fill;
    final planeEdge = Paint()
      ..color = Colors.lightBlueAccent.withValues(alpha: 0.5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (final poly in f.planes) {
      final path = Path();
      var ok = true;
      for (var i = 0; i < poly.length; i++) {
        final p = f.project(poly[i], size);
        if (p == null) {
          ok = false;
          break;
        }
        if (i == 0) {
          path.moveTo(p.dx, p.dy);
        } else {
          path.lineTo(p.dx, p.dy);
        }
      }
      if (ok && poly.length >= 3) {
        path.close();
        canvas.drawPath(path, planePaint);
        canvas.drawPath(path, planeEdge);
      }
    }

    // Existing walls.
    final wallPaint = Paint()
      ..color = Colors.white
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    final openingPaint = Paint()
      ..strokeWidth = 6
      ..strokeCap = StrokeCap.butt;
    for (final w in plan.walls) {
      final a = _world(plan.vertices[w.a]!);
      final b = _world(plan.vertices[w.b]!);
      final seg = f.projectSegment(a, b, size);
      if (seg == null) continue;
      canvas.drawLine(seg[0], seg[1], wallPaint);
      final len = plan.wallLength(w);
      if (len > 1e-6) {
        for (final o in w.openings) {
          final t0 = o.offset / len;
          final t1 = o.end / len;
          final p0 = a + (b - a) * t0;
          final p1 = a + (b - a) * t1;
          final os = f.projectSegment(p0, p1, size);
          if (os == null) continue;
          openingPaint.color = _openingColor(o.type);
          canvas.drawLine(os[0], os[1], openingPaint);
        }
      }
      final mid = f.project((a + b) * 0.5, size);
      if (mid != null && _onScreen(mid, size)) {
        _label(canvas, mid, fmtMeters(len), Colors.black87);
      }
    }

    // Vertices.
    final vertexPaint = Paint()..color = Colors.white;
    final chainPaint = Paint()..color = Colors.greenAccent;
    for (final v in plan.vertices.values) {
      final p = f.project(_world(v), size);
      if (p == null) continue;
      final inChain = chain.contains(v.id);
      canvas.drawCircle(p, inChain ? 7 : 5, inChain ? chainPaint : vertexPaint);
      canvas.drawCircle(p, inChain ? 7 : 5, Paint()..color = Colors.black54..style = PaintingStyle.stroke);
    }

    // Rubber band from the last corner to the cursor.
    final cursor = f.cursor;
    if (chain.isNotEmpty && cursor != null) {
      final last = _world(plan.vertices[chain.last]!);
      final seg = f.projectSegment(last, cursor, size);
      if (seg != null) {
        canvas.drawLine(
          seg[0],
          seg[1],
          Paint()
            ..color = Colors.greenAccent
            ..strokeWidth = 3
            ..strokeCap = StrokeCap.round,
        );
      }
    }

    // Pending opening marks along the wall in progress.
    for (final m in marks) {
      final s = f.project(m.start, size);
      final e = m.end == null ? (cursor == null ? null : f.project(cursor, size)) : f.project(m.end!, size);
      final color = _openingColor(m.type);
      if (s != null) {
        canvas.drawCircle(s, 6, Paint()..color = color);
      }
      if (s != null && e != null) {
        canvas.drawLine(
          s,
          e,
          Paint()
            ..color = color
            ..strokeWidth = 6,
        );
        if (m.end != null) canvas.drawCircle(e, 6, Paint()..color = color);
        final len = math.sqrt(math.pow((m.end ?? cursor!).x - m.start.x, 2) + math.pow((m.end ?? cursor!).z - m.start.z, 2));
        _label(canvas, (s + e) / 2 + const Offset(0, -18), '${m.type.label} ${fmtMeters(len)}', color);
      }
    }

    // Reticle at the centre.
    final color = cursor == null
        ? Colors.white38
        : (f.cursorOnPlane ? Colors.greenAccent : Colors.amberAccent);
    _drawReticle(canvas, center, color, cursor != null);
  }

  Color _openingColor(OpeningType t) => switch (t) {
        OpeningType.door => Colors.orangeAccent,
        OpeningType.window => Colors.lightBlueAccent,
        OpeningType.opening => Colors.purpleAccent,
      };

  bool _onScreen(Offset p, Size size) =>
      p.dx >= 0 && p.dy >= 0 && p.dx <= size.width && p.dy <= size.height;

  void _drawReticle(Canvas canvas, Offset c, Color color, bool solid) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawCircle(c, 18, paint);
    canvas.drawLine(c + const Offset(-28, 0), c + const Offset(-10, 0), paint);
    canvas.drawLine(c + const Offset(10, 0), c + const Offset(28, 0), paint);
    canvas.drawLine(c + const Offset(0, -28), c + const Offset(0, -10), paint);
    canvas.drawLine(c + const Offset(0, 10), c + const Offset(0, 28), paint);
    if (solid) canvas.drawCircle(c, 3, Paint()..color = color);
  }

  void _label(Canvas canvas, Offset at, String text, Color bg) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: textStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    final rect = Rect.fromCenter(center: at, width: tp.width + 12, height: tp.height + 6);
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(6)), Paint()..color = bg.withValues(alpha: 0.85));
    tp.paint(canvas, rect.topLeft + const Offset(6, 3));
  }

  @override
  bool shouldRepaint(covariant _ArOverlayPainter old) => true;
}

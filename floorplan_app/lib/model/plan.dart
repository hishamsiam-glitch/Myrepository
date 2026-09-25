import 'dart:math' as math;

/// Plan coordinates are in metres. `x` grows to the right and `y` grows
/// downwards on the 2D plan; in the 3D viewer `y` becomes world `z`.
class Vertex {
  Vertex({required this.id, required this.x, required this.y});

  final String id;
  double x;
  double y;

  Vertex copy() => Vertex(id: id, x: x, y: y);

  Map<String, dynamic> toJson() => {'id': id, 'x': x, 'y': y};

  factory Vertex.fromJson(Map<String, dynamic> j) => Vertex(
        id: j['id'] as String,
        x: (j['x'] as num).toDouble(),
        y: (j['y'] as num).toDouble(),
      );
}

enum OpeningType {
  door,
  window,
  opening;

  String get label => switch (this) {
        OpeningType.door => 'Door',
        OpeningType.window => 'Window',
        OpeningType.opening => 'Opening',
      };

  static OpeningType parse(String s) =>
      OpeningType.values.firstWhere((t) => t.name == s, orElse: () => OpeningType.door);
}

/// An opening cut into a wall. `offset` is the distance (m) from the wall's
/// start vertex to the opening's near edge; `sill` is the height of its
/// bottom edge above the floor.
class Opening {
  Opening({
    required this.id,
    required this.type,
    required this.offset,
    required this.width,
    double? height,
    double? sill,
  })  : height = height ?? defaultHeight(type),
        sill = sill ?? defaultSill(type);

  final String id;
  OpeningType type;
  double offset;
  double width;
  double height;
  double sill;

  static double defaultHeight(OpeningType t) => switch (t) {
        OpeningType.door => 2.1,
        OpeningType.window => 1.2,
        OpeningType.opening => 2.1,
      };

  static double defaultSill(OpeningType t) => switch (t) {
        OpeningType.door => 0.0,
        OpeningType.window => 0.9,
        OpeningType.opening => 0.0,
      };

  double get end => offset + width;

  Opening copy() => Opening(
      id: id, type: type, offset: offset, width: width, height: height, sill: sill);

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type.name,
        'offset': offset,
        'width': width,
        'height': height,
        'sill': sill,
      };

  factory Opening.fromJson(Map<String, dynamic> j) => Opening(
        id: j['id'] as String,
        type: OpeningType.parse(j['type'] as String),
        offset: (j['offset'] as num).toDouble(),
        width: (j['width'] as num).toDouble(),
        height: (j['height'] as num?)?.toDouble(),
        sill: (j['sill'] as num?)?.toDouble(),
      );
}

enum SkinKind { color, pattern, image }

/// Surface finish for a wall or the floor.
class Skin {
  Skin({
    this.kind = SkinKind.color,
    this.color = 0xFFE8E4DC,
    this.pattern = 'brick',
    this.imagePath,
    this.scale = 1.0,
  });

  SkinKind kind;

  /// ARGB colour. Used directly for [SkinKind.color] and as the tint for
  /// procedural patterns.
  int color;

  /// Procedural pattern name (see the 3D viewer's pattern list).
  String pattern;

  /// Path of a user supplied image, relative to the project directory.
  String? imagePath;

  /// Real-world size in metres of one texture tile.
  double scale;

  Skin copy() => Skin(
      kind: kind, color: color, pattern: pattern, imagePath: imagePath, scale: scale);

  Map<String, dynamic> toJson() => {
        'kind': kind.name,
        'color': color,
        'pattern': pattern,
        'imagePath': imagePath,
        'scale': scale,
      };

  factory Skin.fromJson(Map<String, dynamic>? j) {
    if (j == null) return Skin();
    return Skin(
      kind: SkinKind.values
          .firstWhere((k) => k.name == j['kind'], orElse: () => SkinKind.color),
      color: (j['color'] as num?)?.toInt() ?? 0xFFE8E4DC,
      pattern: j['pattern'] as String? ?? 'brick',
      imagePath: j['imagePath'] as String?,
      scale: (j['scale'] as num?)?.toDouble() ?? 1.0,
    );
  }
}

class Wall {
  Wall({
    required this.id,
    required this.a,
    required this.b,
    this.height = 2.7,
    this.thickness = 0.15,
    List<Opening>? openings,
    this.skin,
  }) : openings = openings ?? [];

  final String id;
  String a;
  String b;
  double height;
  double thickness;
  final List<Opening> openings;

  /// `null` means "use the plan's default wall skin".
  Skin? skin;

  Wall copy() => Wall(
        id: id,
        a: a,
        b: b,
        height: height,
        thickness: thickness,
        openings: openings.map((o) => o.copy()).toList(),
        skin: skin?.copy(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'a': a,
        'b': b,
        'height': height,
        'thickness': thickness,
        'openings': openings.map((o) => o.toJson()).toList(),
        'skin': skin?.toJson(),
      };

  factory Wall.fromJson(Map<String, dynamic> j) => Wall(
        id: j['id'] as String,
        a: j['a'] as String,
        b: j['b'] as String,
        height: (j['height'] as num?)?.toDouble() ?? 2.7,
        thickness: (j['thickness'] as num?)?.toDouble() ?? 0.15,
        openings: (j['openings'] as List? ?? [])
            .map((o) => Opening.fromJson(o as Map<String, dynamic>))
            .toList(),
        skin: j['skin'] == null ? null : Skin.fromJson(j['skin'] as Map<String, dynamic>),
      );
}

/// Optional photo (e.g. a paper plan) shown behind the 2D editor.
class Background {
  Background({required this.imagePath, this.metersPerPixel = 0.01});

  String imagePath;

  /// Scale of the photo: metres of real distance per image pixel.
  double metersPerPixel;

  Map<String, dynamic> toJson() =>
      {'imagePath': imagePath, 'metersPerPixel': metersPerPixel};

  factory Background.fromJson(Map<String, dynamic> j) => Background(
        imagePath: j['imagePath'] as String,
        metersPerPixel: (j['metersPerPixel'] as num).toDouble(),
      );
}

int _idCounter = 0;

String newId(String prefix) {
  _idCounter++;
  final t = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
  return '$prefix$t${_idCounter.toRadixString(36)}';
}

class FloorPlan {
  FloorPlan({
    required this.id,
    required this.name,
    Map<String, Vertex>? vertices,
    List<Wall>? walls,
    this.defaultHeight = 2.7,
    this.defaultThickness = 0.15,
    Skin? wallSkin,
    Skin? floorSkin,
    this.background,
    DateTime? updated,
  })  : vertices = vertices ?? {},
        walls = walls ?? [],
        wallSkin = wallSkin ?? Skin(),
        floorSkin = floorSkin ?? Skin(kind: SkinKind.pattern, pattern: 'wood', color: 0xFFC9A46B, scale: 1.2),
        updated = updated ?? DateTime.now();

  final String id;
  String name;
  final Map<String, Vertex> vertices;
  final List<Wall> walls;
  double defaultHeight;
  double defaultThickness;
  Skin wallSkin;
  Skin floorSkin;
  Background? background;
  DateTime updated;

  factory FloorPlan.create(String name) => FloorPlan(id: newId('p'), name: name);

  // ---------------------------------------------------------------- queries

  Vertex? vertex(String id) => vertices[id];

  Wall? wall(String id) {
    for (final w in walls) {
      if (w.id == id) return w;
    }
    return null;
  }

  double wallLength(Wall w) {
    final a = vertices[w.a]!;
    final b = vertices[w.b]!;
    return math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
  }

  /// Walls touching a vertex.
  List<Wall> wallsAt(String vertexId) =>
      walls.where((w) => w.a == vertexId || w.b == vertexId).toList();

  double get totalWallLength => walls.fold(0.0, (s, w) => s + wallLength(w));

  bool get isEmpty => walls.isEmpty;

  /// Bounding box of all vertices as [minX, minY, maxX, maxY], or null.
  List<double>? get bounds {
    if (vertices.isEmpty) return null;
    var minX = double.infinity, minY = double.infinity;
    var maxX = -double.infinity, maxY = -double.infinity;
    for (final v in vertices.values) {
      minX = math.min(minX, v.x);
      minY = math.min(minY, v.y);
      maxX = math.max(maxX, v.x);
      maxY = math.max(maxY, v.y);
    }
    return [minX, minY, maxX, maxY];
  }

  // ---------------------------------------------------------------- editing

  Vertex addVertex(double x, double y) {
    final v = Vertex(id: newId('v'), x: x, y: y);
    vertices[v.id] = v;
    return v;
  }

  /// Returns an existing vertex within [tolerance] metres of (x, y), if any.
  Vertex? findVertexNear(double x, double y, double tolerance) {
    Vertex? best;
    var bestD = tolerance;
    for (final v in vertices.values) {
      final d = math.sqrt((v.x - x) * (v.x - x) + (v.y - y) * (v.y - y));
      if (d <= bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  Wall addWall(String a, String b, {double? height, double? thickness}) {
    final w = Wall(
      id: newId('w'),
      a: a,
      b: b,
      height: height ?? defaultHeight,
      thickness: thickness ?? defaultThickness,
    );
    walls.add(w);
    return w;
  }

  void removeWall(String wallId) {
    walls.removeWhere((w) => w.id == wallId);
    _pruneOrphanVertices();
  }

  /// Drops vertices that no wall references any more.
  void pruneOrphanVertices() => _pruneOrphanVertices();

  void _pruneOrphanVertices() {
    final used = <String>{};
    for (final w in walls) {
      used.add(w.a);
      used.add(w.b);
    }
    vertices.removeWhere((id, _) => !used.contains(id));
  }

  /// Moves a vertex; the walls that share it follow automatically since
  /// walls reference vertices by id.
  void moveVertex(String id, double x, double y) {
    final v = vertices[id];
    if (v == null) return;
    v.x = x;
    v.y = y;
  }

  /// Changes a wall's length by sliding its end vertex along the wall
  /// direction. Other walls attached to that vertex follow.
  void setWallLength(Wall w, double length) {
    final a = vertices[w.a]!;
    final b = vertices[w.b]!;
    final cur = wallLength(w);
    if (cur < 1e-6 || length <= 0) return;
    final ux = (b.x - a.x) / cur;
    final uy = (b.y - a.y) / cur;
    b.x = a.x + ux * length;
    b.y = a.y + uy * length;
    clampOpenings(w);
  }

  /// Keeps openings inside the wall after it was shortened.
  void clampOpenings(Wall w) {
    final len = wallLength(w);
    w.openings.removeWhere((o) => o.width <= 0.01 || o.offset >= len);
    for (final o in w.openings) {
      if (o.end > len) {
        o.width = math.max(0.05, len - o.offset);
      }
    }
  }

  Opening addOpening(Wall w, OpeningType type, double offset, double width) {
    final len = wallLength(w);
    offset = offset.clamp(0.0, math.max(0.0, len - 0.05));
    width = width.clamp(0.05, math.max(0.05, len - offset));
    final o = Opening(id: newId('o'), type: type, offset: offset, width: width);
    w.openings.add(o);
    w.openings.sort((a, b) => a.offset.compareTo(b.offset));
    return o;
  }

  /// Scales every vertex position by [factor] about the origin. Used when a
  /// photo background is re-calibrated after tracing.
  void scaleAll(double factor) {
    for (final v in vertices.values) {
      v.x *= factor;
      v.y *= factor;
    }
    for (final w in walls) {
      for (final o in w.openings) {
        o.offset *= factor;
        o.width *= factor;
      }
    }
  }

  void setAllHeights(double h) {
    defaultHeight = h;
    for (final w in walls) {
      w.height = h;
    }
  }

  /// Finds closed loops of walls (rooms) as ordered vertex-id lists. Used by
  /// the 3D viewer to build floor slabs.
  ///
  /// Every directed wall edge belongs to exactly one face of the planar
  /// graph. Walking each face by always taking the next edge in angular
  /// order gives the interior faces one winding and the outer face the
  /// opposite winding, so the outer face can be dropped by its sign.
  List<List<String>> closedLoops() {
    final adj = <String, List<String>>{};
    for (final w in walls) {
      if (w.a == w.b) continue;
      adj.putIfAbsent(w.a, () => []).add(w.b);
      adj.putIfAbsent(w.b, () => []).add(w.a);
    }
    // Sort neighbours by angle around each vertex.
    for (final entry in adj.entries) {
      final c = vertices[entry.key]!;
      entry.value.sort((p, q) {
        final vp = vertices[p]!;
        final vq = vertices[q]!;
        return math.atan2(vp.y - c.y, vp.x - c.x).compareTo(math.atan2(vq.y - c.y, vq.x - c.x));
      });
    }
    final usedDirected = <String>{};
    final faces = <List<String>>[];
    for (final w in walls) {
      for (final dir in [
        [w.a, w.b],
        [w.b, w.a]
      ]) {
        if (usedDirected.contains('${dir[0]}>${dir[1]}')) continue;
        var prev = dir[0];
        var cur = dir[1];
        final face = <String>[prev];
        var closed = false;
        for (var steps = 0; steps < 2 * walls.length + 2; steps++) {
          usedDirected.add('$prev>$cur');
          final nbrs = adj[cur]!;
          final idx = nbrs.indexOf(prev);
          final next = nbrs[(idx + 1) % nbrs.length];
          prev = cur;
          cur = next;
          if (prev == dir[0] && cur == dir[1]) {
            // Back on the starting directed edge: the face is complete.
            closed = true;
            break;
          }
          face.add(prev);
        }
        if (!closed) continue;
        // Faces of one winding are rooms; the opposite winding is the
        // outer face (and degenerate faces around dead-end walls).
        _removeSpikes(face);
        final area = _signedArea(face);
        if (face.length >= 3 && area < -0.05) faces.add(face);
      }
    }
    return faces;
  }

  /// Removes zero-area spikes (x, y, x) that dead-end walls leave in a face.
  void _removeSpikes(List<String> face) {
    var changed = true;
    while (changed && face.length >= 3) {
      changed = false;
      for (var i = 0; i < face.length; i++) {
        final prev = face[(i - 1 + face.length) % face.length];
        final next = face[(i + 1) % face.length];
        if (prev == next) {
          // Remove the spike tip and one of the duplicated neighbours.
          face.removeAt(i);
          face.removeAt(i % face.length);
          changed = true;
          break;
        }
      }
    }
  }

  double _signedArea(List<String> loop) {
    var area = 0.0;
    for (var i = 0; i < loop.length; i++) {
      final a = vertices[loop[i]]!;
      final b = vertices[loop[(i + 1) % loop.length]]!;
      area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
  }

  // ------------------------------------------------------------ persistence

  FloorPlan copy() => FloorPlan.fromJson(toJson());

  Map<String, dynamic> toJson() => {
        'version': 1,
        'id': id,
        'name': name,
        'vertices': vertices.values.map((v) => v.toJson()).toList(),
        'walls': walls.map((w) => w.toJson()).toList(),
        'defaultHeight': defaultHeight,
        'defaultThickness': defaultThickness,
        'wallSkin': wallSkin.toJson(),
        'floorSkin': floorSkin.toJson(),
        'background': background?.toJson(),
        'updated': updated.toIso8601String(),
      };

  factory FloorPlan.fromJson(Map<String, dynamic> j) {
    final vs = <String, Vertex>{};
    for (final v in (j['vertices'] as List? ?? [])) {
      final vert = Vertex.fromJson(v as Map<String, dynamic>);
      vs[vert.id] = vert;
    }
    final plan = FloorPlan(
      id: j['id'] as String,
      name: j['name'] as String? ?? 'Untitled',
      vertices: vs,
      walls: (j['walls'] as List? ?? [])
          .map((w) => Wall.fromJson(w as Map<String, dynamic>))
          .where((w) => vs.containsKey(w.a) && vs.containsKey(w.b))
          .toList(),
      defaultHeight: (j['defaultHeight'] as num?)?.toDouble() ?? 2.7,
      defaultThickness: (j['defaultThickness'] as num?)?.toDouble() ?? 0.15,
      wallSkin: Skin.fromJson(j['wallSkin'] as Map<String, dynamic>?),
      floorSkin: j['floorSkin'] == null
          ? null
          : Skin.fromJson(j['floorSkin'] as Map<String, dynamic>),
      background: j['background'] == null
          ? null
          : Background.fromJson(j['background'] as Map<String, dynamic>),
      updated: DateTime.tryParse(j['updated'] as String? ?? '') ?? DateTime.now(),
    );
    return plan;
  }
}

/// Formats a length in metres for display, e.g. "3.25 m".
String fmtMeters(double m, {int decimals = 2}) => '${m.toStringAsFixed(decimals)} m';

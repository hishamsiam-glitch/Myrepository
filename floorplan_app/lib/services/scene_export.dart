import 'dart:convert';
import 'dart:io';

import '../model/plan.dart';
import 'project_store.dart';

/// Builds the JSON scene the 3D viewer (assets/web/viewer.html) renders.
/// Images are inlined as data URLs so the WebView needs no file access.
class SceneExporter {
  SceneExporter(this.plan);

  final FloorPlan plan;
  final Map<String, String> _imageCache = {};

  Future<Map<String, dynamic>> build({String? selectedWall}) async {
    final walls = <Map<String, dynamic>>[];
    for (final w in plan.walls) {
      final a = plan.vertices[w.a]!;
      final b = plan.vertices[w.b]!;
      walls.add({
        'id': w.id,
        'ax': a.x,
        'ay': a.y,
        'bx': b.x,
        'by': b.y,
        'height': w.height,
        'thickness': w.thickness,
        'openings': [
          for (final o in w.openings)
            {
              'type': o.type.name,
              'offset': o.offset,
              'width': o.width,
              'height': o.height,
              'sill': o.sill,
            }
        ],
        'skin': await _skinJson(w.skin ?? plan.wallSkin),
      });
    }
    final floors = <List<List<double>>>[];
    for (final loop in plan.closedLoops()) {
      floors.add([
        for (final id in loop) [plan.vertices[id]!.x, plan.vertices[id]!.y]
      ]);
    }
    return {
      'walls': walls,
      'floors': floors,
      'floorSkin': await _skinJson(plan.floorSkin),
      'selected': selectedWall,
    };
  }

  Future<Map<String, dynamic>> _skinJson(Skin s) async {
    String? image;
    if (s.kind == SkinKind.image && s.imagePath != null) {
      image = await _dataUrl(s.imagePath!);
    }
    return {
      'kind': image == null && s.kind == SkinKind.image ? 'color' : s.kind.name,
      'color': '#${(s.color & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}',
      'pattern': s.pattern,
      'image': image,
      'scale': s.scale,
    };
  }

  Future<String?> _dataUrl(String relative) async {
    final cached = _imageCache[relative];
    if (cached != null) return cached;
    try {
      final abs = await ProjectStore.instance.imageAbsolutePath(plan, relative);
      final file = File(abs);
      if (!await file.exists()) return null;
      final bytes = await file.readAsBytes();
      final ext = relative.split('.').last.toLowerCase();
      final mime = switch (ext) {
        'png' => 'image/png',
        'webp' => 'image/webp',
        'gif' => 'image/gif',
        _ => 'image/jpeg',
      };
      final url = 'data:$mime;base64,${base64Encode(bytes)}';
      _imageCache[relative] = url;
      return url;
    } catch (_) {
      return null;
    }
  }
}

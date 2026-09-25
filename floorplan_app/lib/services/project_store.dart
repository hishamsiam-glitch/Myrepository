import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../model/plan.dart';

/// Saves plans as JSON files under the app's documents directory. Images
/// (photo backgrounds, wall textures) are copied next to the plan file and
/// referenced by file name.
class ProjectStore {
  ProjectStore._();
  static final ProjectStore instance = ProjectStore._();

  Directory? _root;

  Future<Directory> rootDir() async {
    if (_root != null) return _root!;
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/plans');
    if (!await dir.exists()) await dir.create(recursive: true);
    _root = dir;
    return dir;
  }

  Future<Directory> planDir(String planId) async {
    final dir = Directory('${(await rootDir()).path}/$planId');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  Future<List<FloorPlan>> listPlans() async {
    final root = await rootDir();
    final plans = <FloorPlan>[];
    await for (final entry in root.list()) {
      if (entry is! Directory) continue;
      final file = File('${entry.path}/plan.json');
      if (!await file.exists()) continue;
      try {
        final json = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
        plans.add(FloorPlan.fromJson(json));
      } catch (_) {
        // Skip corrupt files rather than failing the whole list.
      }
    }
    plans.sort((a, b) => b.updated.compareTo(a.updated));
    return plans;
  }

  Future<void> save(FloorPlan plan) async {
    plan.updated = DateTime.now();
    final dir = await planDir(plan.id);
    final file = File('${dir.path}/plan.json');
    await file.writeAsString(const JsonEncoder.withIndent(' ').convert(plan.toJson()));
  }

  Future<void> delete(FloorPlan plan) async {
    final dir = await planDir(plan.id);
    if (await dir.exists()) await dir.delete(recursive: true);
  }

  /// Copies an image into the plan's directory and returns its relative name.
  Future<String> importImage(FloorPlan plan, String sourcePath) async {
    final dir = await planDir(plan.id);
    final ext = sourcePath.contains('.') ? sourcePath.split('.').last.toLowerCase() : 'jpg';
    final name = '${newId('img')}.$ext';
    await File(sourcePath).copy('${dir.path}/$name');
    return name;
  }

  Future<String> imageAbsolutePath(FloorPlan plan, String relative) async {
    final dir = await planDir(plan.id);
    return '${dir.path}/$relative';
  }
}

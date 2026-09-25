import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../model/plan.dart';
import '../services/project_store.dart';
import '../services/scene_export.dart';
import '../widgets/skin_editor.dart';
import '../widgets/wall_sheet.dart';

/// Renders the plan in 3D (three.js inside a WebView). Tapping a wall opens
/// the wall editor with skin controls; the floor and default skins are
/// edited from the app bar.
class Viewer3DScreen extends StatefulWidget {
  const Viewer3DScreen({super.key, required this.plan});

  final FloorPlan plan;

  @override
  State<Viewer3DScreen> createState() => _Viewer3DScreenState();
}

class _Viewer3DScreenState extends State<Viewer3DScreen> {
  late final WebViewController _controller;
  late final SceneExporter _exporter = SceneExporter(widget.plan);
  bool _ready = false;
  String? _selected;
  bool _sheetOpen = false;

  FloorPlan get plan => widget.plan;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFDFE7EE))
      ..addJavaScriptChannel('Flutter', onMessageReceived: _onMessage)
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) {
          // The page also posts "ready"; push the scene either way.
          _pushScene();
        },
      ))
      ..loadFlutterAsset('assets/web/viewer.html');
  }

  void _onMessage(JavaScriptMessage msg) {
    Map<String, dynamic> data;
    try {
      data = jsonDecode(msg.message) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (data['type']) {
      case 'ready':
        _ready = true;
        _pushScene();
      case 'select':
        final id = data['wallId'] as String?;
        if (id != null) {
          final w = plan.wall(id);
          if (w != null) _editWall(w);
        } else if (data['floor'] == true) {
          _editFloor();
        }
      case 'snapshot':
        _saveSnapshot(data['data'] as String? ?? '');
      case 'error':
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('3D error: ${data['message']}')));
    }
  }

  Future<void> _pushScene() async {
    final scene = await _exporter.build(selectedWall: _selected);
    final json = jsonEncode(scene);
    await _controller.runJavaScript('window.setScene && window.setScene($json);');
  }

  void _changed() {
    ProjectStore.instance.save(plan);
    _pushScene();
  }

  Future<void> _editWall(Wall w) async {
    if (_sheetOpen) return;
    _sheetOpen = true;
    _selected = w.id;
    _pushScene();
    await showWallSheet(context, plan: plan, wall: w, onChanged: _changed, showSkin: true);
    _sheetOpen = false;
    _selected = null;
    _pushScene();
  }

  Future<void> _editFloor() => _editSkin('Floor skin', plan.floorSkin);

  Future<void> _editSkin(String title, Skin skin, {Widget? extra}) async {
    if (_sheetOpen) return;
    _sheetOpen = true;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.95,
        builder: (context, controller) => SingleChildScrollView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SkinEditor(plan: plan, skin: skin, onChanged: _changed, title: title),
              ?extra,
            ],
          ),
        ),
      ),
    );
    _sheetOpen = false;
  }

  Future<void> _editDefaultWallSkin() => _editSkin(
        'Default wall skin',
        plan.wallSkin,
        extra: Padding(
          padding: const EdgeInsets.only(top: 12),
          child: FilledButton.tonalIcon(
            onPressed: () {
              for (final w in plan.walls) {
                w.skin = null;
              }
              _changed();
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Applied to every wall.')));
            },
            icon: const Icon(Icons.format_paint),
            label: const Text('Apply to all walls (clear per-wall skins)'),
          ),
        ),
      );

  Future<void> _setAllHeights() async {
    var h = plan.defaultHeight;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Height of all walls: ${fmtMeters(h, decimals: 1)}', style: Theme.of(context).textTheme.titleMedium),
              Slider(
                value: h.clamp(1.0, 6.0),
                min: 1.0,
                max: 6.0,
                divisions: 50,
                label: fmtMeters(h, decimals: 1),
                onChanged: (v) {
                  setLocal(() => h = (v * 10).round() / 10);
                  plan.setAllHeights(h);
                  _pushScene();
                },
                onChangeEnd: (_) => _changed(),
              ),
              const Text('Tap a wall in the 3D view to change one wall only.'),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _snapshot() async {
    await _controller.runJavaScript('window.snapshot && window.snapshot();');
  }

  Future<void> _saveSnapshot(String dataUrl) async {
    final comma = dataUrl.indexOf(',');
    if (comma < 0) return;
    final bytes = base64Decode(dataUrl.substring(comma + 1));
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/${plan.name.replaceAll(RegExp(r'[^\w]+'), '_')}_3d.png');
    await file.writeAsBytes(bytes);
    if (!mounted) return;
    await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], text: '${plan.name} - 3D view'));
  }

  Future<void> _sharePlanJson() async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/${plan.name.replaceAll(RegExp(r'[^\w]+'), '_')}.floorplan.json');
    await file.writeAsString(const JsonEncoder.withIndent(' ').convert(plan.toJson()));
    await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], text: '${plan.name} floor plan'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${plan.name} - 3D'),
        actions: [
          IconButton(
            tooltip: 'Default wall skin',
            onPressed: _editDefaultWallSkin,
            icon: const Icon(Icons.format_paint),
          ),
          IconButton(
            tooltip: 'Floor skin',
            onPressed: _editFloor,
            icon: const Icon(Icons.grid_on),
          ),
          IconButton(
            tooltip: 'Wall heights',
            onPressed: _setAllHeights,
            icon: const Icon(Icons.height),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              switch (v) {
                case 'persp':
                  _controller.runJavaScript('window.viewPreset && window.viewPreset("perspective");');
                case 'top':
                  _controller.runJavaScript('window.viewPreset && window.viewPreset("top");');
                case 'walk':
                  _controller.runJavaScript('window.viewPreset && window.viewPreset("inside");');
                case 'snap':
                  _snapshot();
                case 'json':
                  _sharePlanJson();
              }
            },
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'persp', child: ListTile(leading: Icon(Icons.threed_rotation), title: Text('Perspective view'))),
              PopupMenuItem(value: 'top', child: ListTile(leading: Icon(Icons.layers), title: Text('Top view'))),
              PopupMenuItem(value: 'walk', child: ListTile(leading: Icon(Icons.directions_walk), title: Text('Look from inside'))),
              PopupMenuDivider(),
              PopupMenuItem(value: 'snap', child: ListTile(leading: Icon(Icons.photo_camera), title: Text('Share 3D snapshot'))),
              PopupMenuItem(value: 'json', child: ListTile(leading: Icon(Icons.data_object), title: Text('Share plan file'))),
            ],
          ),
        ],
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (!_ready)
            const Center(child: CircularProgressIndicator()),
          Positioned(
            left: 12,
            right: 12,
            bottom: 12,
            child: IgnorePointer(
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(20)),
                  child: const Text(
                    'Drag to orbit, pinch to zoom, two fingers to pan. Tap a wall or the floor to edit its size and skin.',
                    style: TextStyle(color: Colors.white, fontSize: 12),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

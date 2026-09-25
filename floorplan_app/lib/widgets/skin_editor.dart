import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../model/plan.dart';
import '../services/project_store.dart';

/// Procedural patterns the 3D viewer can draw. Keep in sync with
/// web3d/src/patterns.js.
const kPatterns = <String, String>{
  'brick': 'Brick',
  'tile': 'Tiles',
  'wood': 'Wood planks',
  'parquet': 'Parquet',
  'stripes': 'Stripes',
  'plaster': 'Plaster',
  'concrete': 'Concrete',
  'marble': 'Marble',
  'hex': 'Hex tiles',
  'checker': 'Checker',
  'stone': 'Stone',
  'wallpaper': 'Wallpaper',
};

const kPalette = <int>[
  0xFFFFFFFF, 0xFFF5F0E6, 0xFFE8E4DC, 0xFFD9CDBF, 0xFFC9A46B, 0xFFA0522D,
  0xFF8B5A2B, 0xFF6B4F3A, 0xFFB0B0B0, 0xFF808080, 0xFF4A4A4A, 0xFF1E1E1E,
  0xFFF7D9D9, 0xFFE57373, 0xFFC62828, 0xFFFFE0B2, 0xFFFFB74D, 0xFFEF6C00,
  0xFFFFF9C4, 0xFFFFF176, 0xFFC8E6C9, 0xFF81C784, 0xFF2E7D32, 0xFFB2DFDB,
  0xFF4DB6AC, 0xFF00695C, 0xFFBBDEFB, 0xFF64B5F6, 0xFF1565C0, 0xFFD1C4E9,
  0xFF9575CD, 0xFF4527A0, 0xFFF8BBD0, 0xFFF06292, 0xFFAD1457,
];

/// Edits a [Skin] in place and reports every change through [onChanged].
class SkinEditor extends StatefulWidget {
  const SkinEditor({
    super.key,
    required this.plan,
    required this.skin,
    required this.onChanged,
    this.title,
  });

  final FloorPlan plan;
  final Skin skin;
  final VoidCallback onChanged;
  final String? title;

  @override
  State<SkinEditor> createState() => _SkinEditorState();
}

class _SkinEditorState extends State<SkinEditor> {
  Skin get skin => widget.skin;
  String? _imageAbs;

  @override
  void initState() {
    super.initState();
    _resolveImage();
  }

  Future<void> _resolveImage() async {
    final p = skin.imagePath;
    if (p == null) {
      if (mounted) setState(() => _imageAbs = null);
      return;
    }
    final abs = await ProjectStore.instance.imageAbsolutePath(widget.plan, p);
    if (mounted) setState(() => _imageAbs = abs);
  }

  void _update(VoidCallback fn) {
    setState(fn);
    widget.onChanged();
  }

  Future<void> _pickImage(ImageSource source) async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: source, maxWidth: 1024, maxHeight: 1024, imageQuality: 85);
    if (file == null) return;
    final rel = await ProjectStore.instance.importImage(widget.plan, file.path);
    _update(() {
      skin.imagePath = rel;
      skin.kind = SkinKind.image;
    });
    await _resolveImage();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.title != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(widget.title!, style: Theme.of(context).textTheme.titleMedium),
          ),
        SegmentedButton<SkinKind>(
          segments: const [
            ButtonSegment(value: SkinKind.color, icon: Icon(Icons.format_color_fill), label: Text('Colour')),
            ButtonSegment(value: SkinKind.pattern, icon: Icon(Icons.texture), label: Text('Pattern')),
            ButtonSegment(value: SkinKind.image, icon: Icon(Icons.image), label: Text('Image')),
          ],
          selected: {skin.kind},
          onSelectionChanged: (s) => _update(() => skin.kind = s.first),
        ),
        const SizedBox(height: 12),
        if (skin.kind != SkinKind.image) ...[
          Text(skin.kind == SkinKind.pattern ? 'Tint colour' : 'Colour',
              style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final c in kPalette)
                GestureDetector(
                  onTap: () => _update(() => skin.color = c),
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: Color(c),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: skin.color == c ? scheme.primary : Colors.black26,
                        width: skin.color == c ? 3 : 1,
                      ),
                    ),
                  ),
                ),
              GestureDetector(
                onTap: () => _customColor(context),
                child: Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    gradient: const SweepGradient(colors: [
                      Colors.red, Colors.yellow, Colors.green, Colors.cyan, Colors.blue, Colors.purple, Colors.red
                    ]),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.black26),
                  ),
                  child: const Icon(Icons.add, size: 18, color: Colors.white),
                ),
              ),
            ],
          ),
        ],
        if (skin.kind == SkinKind.pattern) ...[
          const SizedBox(height: 12),
          Text('Pattern', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final e in kPatterns.entries)
                ChoiceChip(
                  label: Text(e.value),
                  selected: skin.pattern == e.key,
                  onSelected: (_) => _update(() => skin.pattern = e.key),
                ),
            ],
          ),
        ],
        if (skin.kind == SkinKind.image) ...[
          Row(
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.black26),
                  borderRadius: BorderRadius.circular(8),
                  image: _imageAbs == null
                      ? null
                      : DecorationImage(image: FileImage(File(_imageAbs!)), fit: BoxFit.cover),
                ),
                child: _imageAbs == null ? const Icon(Icons.image_outlined) : null,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    FilledButton.tonalIcon(
                      onPressed: () => _pickImage(ImageSource.gallery),
                      icon: const Icon(Icons.photo_library),
                      label: const Text('Gallery'),
                    ),
                    FilledButton.tonalIcon(
                      onPressed: () => _pickImage(ImageSource.camera),
                      icon: const Icon(Icons.photo_camera),
                      label: const Text('Camera'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
        if (skin.kind != SkinKind.color) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Text('Tile size', style: Theme.of(context).textTheme.labelLarge),
              Expanded(
                child: Slider(
                  value: skin.scale.clamp(0.1, 5.0),
                  min: 0.1,
                  max: 5.0,
                  divisions: 49,
                  label: fmtMeters(skin.scale, decimals: 1),
                  onChanged: (v) => _update(() => skin.scale = v),
                ),
              ),
              SizedBox(width: 52, child: Text(fmtMeters(skin.scale, decimals: 1))),
            ],
          ),
        ],
      ],
    );
  }

  Future<void> _customColor(BuildContext context) async {
    var hsv = HSVColor.fromColor(Color(skin.color));
    final result = await showDialog<Color>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Custom colour'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(height: 48, decoration: BoxDecoration(color: hsv.toColor(), borderRadius: BorderRadius.circular(8))),
              _hsvSlider('Hue', hsv.hue, 0, 360, (v) => setLocal(() => hsv = hsv.withHue(v))),
              _hsvSlider('Saturation', hsv.saturation, 0, 1, (v) => setLocal(() => hsv = hsv.withSaturation(v))),
              _hsvSlider('Brightness', hsv.value, 0, 1, (v) => setLocal(() => hsv = hsv.withValue(v))),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, hsv.toColor()), child: const Text('Use')),
          ],
        ),
      ),
    );
    if (result != null) _update(() => skin.color = result.toARGB32());
  }

  Widget _hsvSlider(String label, double value, double min, double max, ValueChanged<double> onChanged) {
    return Row(
      children: [
        SizedBox(width: 84, child: Text(label)),
        Expanded(child: Slider(value: value, min: min, max: max, onChanged: onChanged)),
      ],
    );
  }
}

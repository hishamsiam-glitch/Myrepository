import 'package:flutter/material.dart';

import '../model/plan.dart';
import 'skin_editor.dart';

/// Bottom sheet for editing one wall: length, height, thickness, openings
/// and (optionally) its 3D skin.
Future<void> showWallSheet(
  BuildContext context, {
  required FloorPlan plan,
  required Wall wall,
  required VoidCallback onChanged,
  bool showSkin = false,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: showSkin ? 0.75 : 0.6,
      maxChildSize: 0.95,
      builder: (context, controller) => SingleChildScrollView(
        controller: controller,
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
        child: WallEditor(plan: plan, wall: wall, onChanged: onChanged, showSkin: showSkin),
      ),
    ),
  );
}

class WallEditor extends StatefulWidget {
  const WallEditor({
    super.key,
    required this.plan,
    required this.wall,
    required this.onChanged,
    this.showSkin = false,
  });

  final FloorPlan plan;
  final Wall wall;
  final VoidCallback onChanged;
  final bool showSkin;

  @override
  State<WallEditor> createState() => _WallEditorState();
}

class _WallEditorState extends State<WallEditor> {
  Wall get wall => widget.wall;
  FloorPlan get plan => widget.plan;

  void _changed() {
    setState(() {});
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final len = plan.wallLength(wall);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Text('Wall', style: Theme.of(context).textTheme.titleLarge),
            const Spacer(),
            IconButton(
              tooltip: 'Delete wall',
              onPressed: () {
                plan.removeWall(wall.id);
                widget.onChanged();
                Navigator.of(context).pop();
              },
              icon: const Icon(Icons.delete_outline),
            ),
          ],
        ),
        Row(
          children: [
            Expanded(
              child: NumberField(
                key: ValueKey('len${len.toStringAsFixed(3)}'),
                label: 'Length (m)',
                value: len,
                min: 0.05,
                onSubmitted: (v) {
                  plan.setWallLength(wall, v);
                  _changed();
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: NumberField(
                label: 'Height (m)',
                value: wall.height,
                min: 0.1,
                onSubmitted: (v) {
                  wall.height = v;
                  _changed();
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: NumberField(
                label: 'Thickness (m)',
                value: wall.thickness,
                min: 0.02,
                onSubmitted: (v) {
                  wall.thickness = v;
                  _changed();
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text('Height', style: Theme.of(context).textTheme.labelLarge),
        Slider(
          value: wall.height.clamp(1.0, 6.0),
          min: 1.0,
          max: 6.0,
          divisions: 50,
          label: fmtMeters(wall.height, decimals: 1),
          onChanged: (v) {
            wall.height = (v * 10).round() / 10;
            _changed();
          },
        ),
        const Divider(),
        Row(
          children: [
            Text('Openings', style: Theme.of(context).textTheme.titleMedium),
            const Spacer(),
            PopupMenuButton<OpeningType>(
              tooltip: 'Add opening',
              onSelected: (t) {
                final width = switch (t) {
                  OpeningType.door => 0.9,
                  OpeningType.window => 1.2,
                  OpeningType.opening => 1.0,
                };
                final offset = ((len - width) / 2).clamp(0.0, len);
                plan.addOpening(wall, t, offset, width);
                _changed();
              },
              itemBuilder: (context) => [
                for (final t in OpeningType.values) PopupMenuItem(value: t, child: Text('Add ${t.label.toLowerCase()}')),
              ],
              child: const Chip(avatar: Icon(Icons.add, size: 18), label: Text('Add')),
            ),
          ],
        ),
        if (wall.openings.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('No doors or windows on this wall yet.'),
          ),
        for (final o in wall.openings) _OpeningRow(plan: plan, wall: wall, opening: o, onChanged: _changed),
        if (widget.showSkin) ...[
          const Divider(),
          Row(
            children: [
              Text('Wall skin', style: Theme.of(context).textTheme.titleMedium),
              const Spacer(),
              if (wall.skin != null)
                TextButton(
                  onPressed: () {
                    wall.skin = null;
                    _changed();
                  },
                  child: const Text('Use default'),
                ),
            ],
          ),
          if (wall.skin == null)
            FilledButton.tonalIcon(
              onPressed: () {
                wall.skin = plan.wallSkin.copy();
                _changed();
              },
              icon: const Icon(Icons.brush),
              label: const Text('Customise this wall'),
            )
          else
            SkinEditor(
              key: ValueKey(wall.id),
              plan: plan,
              skin: wall.skin!,
              onChanged: _changed,
            ),
        ],
      ],
    );
  }
}

class _OpeningRow extends StatelessWidget {
  const _OpeningRow({required this.plan, required this.wall, required this.opening, required this.onChanged});

  final FloorPlan plan;
  final Wall wall;
  final Opening opening;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final len = plan.wallLength(wall);
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          children: [
            Row(
              children: [
                DropdownButton<OpeningType>(
                  value: opening.type,
                  underline: const SizedBox.shrink(),
                  items: [for (final t in OpeningType.values) DropdownMenuItem(value: t, child: Text(t.label))],
                  onChanged: (t) {
                    if (t == null) return;
                    opening.type = t;
                    opening.height = Opening.defaultHeight(t);
                    opening.sill = Opening.defaultSill(t);
                    onChanged();
                  },
                ),
                const Spacer(),
                IconButton(
                  onPressed: () {
                    wall.openings.remove(opening);
                    onChanged();
                  },
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: NumberField(
                    key: ValueKey('off${opening.offset.toStringAsFixed(3)}'),
                    label: 'From start (m)',
                    value: opening.offset,
                    min: 0,
                    onSubmitted: (v) {
                      opening.offset = v.clamp(0.0, (len - opening.width).clamp(0.0, len));
                      onChanged();
                    },
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: NumberField(
                    key: ValueKey('w${opening.width.toStringAsFixed(3)}'),
                    label: 'Width (m)',
                    value: opening.width,
                    min: 0.05,
                    onSubmitted: (v) {
                      opening.width = v.clamp(0.05, (len - opening.offset).clamp(0.05, len));
                      onChanged();
                    },
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: NumberField(
                    label: 'Height (m)',
                    value: opening.height,
                    min: 0.05,
                    onSubmitted: (v) {
                      opening.height = v;
                      onChanged();
                    },
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: NumberField(
                    label: 'Sill (m)',
                    value: opening.sill,
                    min: 0,
                    onSubmitted: (v) {
                      opening.sill = v;
                      onChanged();
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A compact numeric text field that commits on submit or focus loss.
class NumberField extends StatefulWidget {
  const NumberField({
    super.key,
    required this.label,
    required this.value,
    required this.onSubmitted,
    this.min = 0,
    this.decimals = 2,
  });

  final String label;
  final double value;
  final double min;
  final int decimals;
  final ValueChanged<double> onSubmitted;

  @override
  State<NumberField> createState() => _NumberFieldState();
}

class _NumberFieldState extends State<NumberField> {
  late final TextEditingController _c = TextEditingController(text: widget.value.toStringAsFixed(widget.decimals));
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus) _commit();
    });
  }

  void _commit() {
    final v = double.tryParse(_c.text.replaceAll(',', '.'));
    if (v == null || v < widget.min) {
      _c.text = widget.value.toStringAsFixed(widget.decimals);
      return;
    }
    if ((v - widget.value).abs() < 1e-9) return;
    widget.onSubmitted(v);
  }

  @override
  void dispose() {
    _c.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _c,
      focusNode: _focus,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: widget.label, isDense: true, border: const OutlineInputBorder()),
      onSubmitted: (_) => _commit(),
    );
  }
}

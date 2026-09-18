import 'package:flutter/material.dart';

import '../chess/pieces.dart';
import '../engine/difficulty.dart';
import 'piece_glyph.dart';

/// What the new-game sheet returns.
class NewGameChoice {
  const NewGameChoice({required this.difficulty, required this.playerColor});

  final Difficulty difficulty;
  final PieceColor playerColor;
}

/// Bottom sheet for picking strength and colour. Returns null if dismissed.
Future<NewGameChoice?> showNewGameSheet(
  BuildContext context, {
  Difficulty initialDifficulty = Difficulty.medium,
  PieceColor initialColor = PieceColor.white,
}) {
  return showModalBottomSheet<NewGameChoice>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => _NewGameSheet(
      initialDifficulty: initialDifficulty,
      initialColor: initialColor,
    ),
  );
}

class _NewGameSheet extends StatefulWidget {
  const _NewGameSheet({
    required this.initialDifficulty,
    required this.initialColor,
  });

  final Difficulty initialDifficulty;
  final PieceColor initialColor;

  @override
  State<_NewGameSheet> createState() => _NewGameSheetState();
}

class _NewGameSheetState extends State<_NewGameSheet> {
  late Difficulty _difficulty = widget.initialDifficulty;
  late PieceColor _color = widget.initialColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // The options are taller than a phone screen, so the sheet is capped and
    // the list scrolls inside it — with "Start game" pinned to the bottom, so
    // it is never the thing that falls off the edge.
    final maxHeight = MediaQuery.sizeOf(context).height * 0.86;

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Text('New game', style: theme.textTheme.headlineSmall),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Difficulty', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    for (final level in Difficulty.values)
                      _DifficultyOption(
                        level: level,
                        selected: level == _difficulty,
                        onTap: () => setState(() => _difficulty = level),
                      ),
                    const SizedBox(height: 12),
                    Text('You play', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    Row(
                      spacing: 10,
                      children: [
                        for (final color in PieceColor.values)
                          Expanded(
                            child: _ColorOption(
                              color: color,
                              selected: color == _color,
                              onTap: () => setState(() => _color = color),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _color == PieceColor.white
                          ? 'You move first.'
                          : 'The computer moves first.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: FilledButton.icon(
                onPressed: () => Navigator.of(context).pop(
                  NewGameChoice(difficulty: _difficulty, playerColor: _color),
                ),
                icon: const Icon(Icons.play_arrow_rounded),
                label: Text('Start as ${_color.label} · ${_difficulty.label}'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A tappable difficulty row: the label, what to expect from it, and a tick.
class _DifficultyOption extends StatelessWidget {
  const _DifficultyOption({
    required this.level,
    required this.selected,
    required this.onTap,
  });

  final Difficulty level;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color:
            selected ? scheme.secondaryContainer : scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 2 : 1,
          ),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        level.label,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(level.blurb, style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (selected)
                  Icon(Icons.check_circle, color: scheme.primary)
                else
                  Icon(Icons.circle_outlined, color: scheme.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }
}


/// Which colour to play, shown as the king you would be moving.
class _ColorOption extends StatelessWidget {
  const _ColorOption({
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final PieceColor color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Material(
      color: selected ? scheme.secondaryContainer : scheme.surfaceContainerLow,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: selected ? scheme.primary : scheme.outlineVariant,
          width: selected ? 2 : 1,
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(
            children: [
              PieceGlyph(
                piece: Piece(color, PieceType.king),
                size: 40,
              ),
              Text(
                color.label,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

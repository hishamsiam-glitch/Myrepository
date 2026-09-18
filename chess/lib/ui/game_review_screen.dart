import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../chess/game.dart';
import '../chess/position.dart';
import '../storage/game_record.dart';
import 'board_view.dart';
import 'formatting.dart';

/// Replays a logged game move by move, so a game in the log is something you
/// can actually look back through rather than just a line of text.
class GameReviewScreen extends StatefulWidget {
  const GameReviewScreen({super.key, required this.record});

  final GameRecord record;

  @override
  State<GameReviewScreen> createState() => _GameReviewScreenState();
}

class _GameReviewScreenState extends State<GameReviewScreen> {
  late final ChessGame _game = widget.record.toGame();

  /// 0 = starting position, n = after the nth move.
  late int _ply = _game.history.length;

  Position get _position =>
      _ply == 0 ? _game.initial : _game.history[_ply - 1].after;

  void _goTo(int ply) {
    setState(() => _ply = ply.clamp(0, _game.history.length));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final record = widget.record;
    final history = _game.history;

    return Scaffold(
      appBar: AppBar(title: const Text('Game review')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          children: [
            // Half the screen at most, so the step controls stay in view.
            Center(
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * 0.5,
                ),
                child: BoardView(
                  position: _position,
                  orientation: record.playerColor,
                  lastMove: _ply == 0 ? null : history[_ply - 1].move,
                ),
              ),
            ),
            const SizedBox(height: 12),
            // The label goes on its own line: four buttons plus a move name
            // does not fit across a phone.
            Text(
              _ply == 0
                  ? 'Starting position'
                  : 'Move ${(_ply + 1) ~/ 2}'
                      '${_ply.isOdd ? '.' : '…'} '
                      '${history[_ply - 1].san}',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              spacing: 12,
              children: [
                IconButton.filledTonal(
                  tooltip: 'Start',
                  onPressed: _ply == 0 ? null : () => _goTo(0),
                  icon: const Icon(Icons.first_page),
                ),
                IconButton.filledTonal(
                  tooltip: 'Previous move',
                  onPressed: _ply == 0 ? null : () => _goTo(_ply - 1),
                  icon: const Icon(Icons.chevron_left),
                ),
                IconButton.filledTonal(
                  tooltip: 'Next move',
                  onPressed:
                      _ply >= history.length ? null : () => _goTo(_ply + 1),
                  icon: const Icon(Icons.chevron_right),
                ),
                IconButton.filledTonal(
                  tooltip: 'End',
                  onPressed: _ply >= history.length
                      ? null
                      : () => _goTo(history.length),
                  icon: const Icon(Icons.last_page),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      record.outcome.description,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    _detail('Result', record.outcome.scoreLine),
                    _detail('Difficulty', record.difficulty.label),
                    _detail('You played', record.playerColor.label),
                    _detail('Moves', '${record.fullMoveCount}'),
                    _detail('Started', formatDateTime(record.createdAt)),
                    _detail('Finished', formatDateTime(record.updatedAt)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Moves',
                            style: theme.textTheme.titleMedium,
                          ),
                        ),
                        if (history.isNotEmpty)
                          TextButton.icon(
                            onPressed: () => _copyMoves(context),
                            icon: const Icon(Icons.copy_rounded, size: 18),
                            label: const Text('Copy'),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    if (history.isEmpty)
                      Text(
                        'No moves were played.',
                        style: theme.textTheme.bodyMedium,
                      )
                    else
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          for (var i = 0; i < history.length; i++)
                            _MoveChip(
                              label: i.isEven
                                  ? '${i ~/ 2 + 1}. ${history[i].san}'
                                  : history[i].san,
                              selected: _ply == i + 1,
                              onTap: () => _goTo(i + 1),
                            ),
                        ],
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Puts the game on the clipboard as `1. e4 e5 2. Nf3 ... 1-0`, so it can
  /// be pasted into an analysis board elsewhere.
  Future<void> _copyMoves(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final text = '${_game.movesText} ${widget.record.outcome.scoreLine}';
    await Clipboard.setData(ClipboardData(text: text));
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      const SnackBar(content: Text('Moves copied')),
    );
  }

  Widget _detail(String label, String value) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _MoveChip extends StatelessWidget {
  const _MoveChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InputChip(
      label: Text(label),
      selected: selected,
      showCheckmark: false,
      visualDensity: VisualDensity.compact,
      onPressed: onTap,
    );
  }
}

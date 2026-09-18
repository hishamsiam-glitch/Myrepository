import 'package:flutter/material.dart';

import '../chess/game.dart';
import '../chess/pieces.dart';
import '../game_session.dart';
import '../storage/game_library.dart';
import '../storage/game_record.dart';
import 'board_view.dart';
import 'piece_glyph.dart';

/// The board screen: play a game, take moves back, resign. Every move is
/// written to the library as it happens, so leaving at any point is safe.
class GameScreen extends StatefulWidget {
  const GameScreen({
    super.key,
    required this.record,
    required this.library,
    this.searchRunner,
  });

  final GameRecord record;
  final GameLibrary library;

  /// Injected by tests so no isolate is spawned.
  final SearchRunner? searchRunner;

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  late final GameSession _session = GameSession(
    record: widget.record,
    library: widget.library,
    searchRunner: widget.searchRunner,
  );

  /// Tracks which outcome we have already announced, so the dialog shows once.
  GameOutcome? _announced;

  @override
  void initState() {
    super.initState();
    _session.addListener(_onSessionChanged);
  }

  @override
  void dispose() {
    _session.removeListener(_onSessionChanged);
    _session.dispose();
    super.dispose();
  }

  void _onSessionChanged() {
    final outcome = _session.outcome;
    if (outcome.isOver && _announced != outcome) {
      _announced = outcome;
      // Wait for the move that ended the game to be painted first.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showOutcomeDialog(outcome);
      });
    }
    if (!outcome.isOver) _announced = null;
  }

  Future<void> _showOutcomeDialog(GameOutcome outcome) async {
    final result = _session.record.playerResult;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        icon: Icon(
          switch (result) {
            GameResultForPlayer.win => Icons.emoji_events,
            GameResultForPlayer.loss => Icons.sentiment_dissatisfied,
            _ => Icons.handshake,
          },
          size: 40,
        ),
        title: Text(
          switch (result) {
            GameResultForPlayer.win => 'You win!',
            GameResultForPlayer.loss => 'You lost',
            _ => 'Draw',
          },
        ),
        content: Text(
          '${outcome.description}.\n\n'
          'The game has been saved to your game log.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Stay on board'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop();
              Navigator.of(context).pop();
            },
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmResign() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Resign this game?'),
        content: const Text(
          'The game is recorded as a loss and moves to your game log. '
          'You can still review it there.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep playing'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Resign'),
          ),
        ],
      ),
    );
    if (confirmed == true) _session.resign();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _session,
      builder: (context, _) {
        final theme = Theme.of(context);
        final pending = _session.pendingPromotion;
        return Scaffold(
          appBar: AppBar(
            title: Text('${_session.difficulty.label} · '
                'you are ${_session.playerColor.label}'),
            actions: [
              IconButton(
                tooltip: 'Take back move',
                onPressed: _session.canUndo ? _session.undoPlayerMove : null,
                icon: const Icon(Icons.undo_rounded),
              ),
              IconButton(
                tooltip: 'Resign',
                onPressed: _session.outcome.isOver ? null : _confirmResign,
                icon: const Icon(Icons.flag_outlined),
              ),
            ],
          ),
          body: SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth > constraints.maxHeight;
                final board = Padding(
                  padding: const EdgeInsets.all(12),
                  child: Center(
                    child: BoardView(
                      position: _session.position,
                      orientation: _session.playerColor,
                      selectedSquare: _session.selectedSquare,
                      moveTargets: _session.moveTargets,
                      lastMove: _session.lastMove,
                      checkedSquare: _session.checkedKingSquare,
                      onTapSquare: _session.tapSquare,
                    ),
                  ),
                );
                final panel = Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _StatusBar(session: _session),
                    if (pending != null)
                      _PromotionPicker(
                        color: _session.playerColor,
                        options: pending.options,
                        onPick: _session.choosePromotion,
                        onCancel: _session.cancelPromotion,
                      ),
                    Expanded(child: _MoveList(game: _session.game)),
                  ],
                );

                if (wide) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      AspectRatio(aspectRatio: 1, child: board),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 12),
                          child: panel,
                        ),
                      ),
                    ],
                  );
                }
                return Column(
                  children: [
                    // Cap the board so the status line and move list always
                    // have room, however short the screen is.
                    ConstrainedBox(
                      constraints: BoxConstraints(
                        maxHeight: constraints.maxHeight * 0.64,
                      ),
                      child: board,
                    ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: DefaultTextStyle.merge(
                          style: theme.textTheme.bodyMedium!,
                          child: panel,
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }
}

/// Whose turn it is, whether the computer is thinking, or how the game ended.
class _StatusBar extends StatelessWidget {
  const _StatusBar({required this.session});

  final GameSession session;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final outcome = session.outcome;

    final String message;
    final IconData icon;
    if (outcome.isOver) {
      message = outcome.description;
      icon = Icons.flag_circle_outlined;
    } else if (session.isThinking) {
      message = 'Computer is thinking…';
      icon = Icons.psychology_outlined;
    } else if (session.isPlayerTurn) {
      message = session.position.isCheck
          ? 'Your move — you are in check'
          : 'Your move';
      icon = session.position.isCheck
          ? Icons.warning_amber_rounded
          : Icons.touch_app_outlined;
    } else {
      message = "Computer's move";
      icon = Icons.computer_outlined;
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          if (session.isThinking)
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            )
          else
            Icon(icon, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (!outcome.isOver && session.game.position.halfmoveClock >= 80)
            Tooltip(
              message: 'Moves since the last capture or pawn move — '
                  'the game is a draw at 50.',
              child: Chip(
                visualDensity: VisualDensity.compact,
                label: Text(
                  '${session.game.position.halfmoveClock ~/ 2}/50',
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The promotion choice, shown inline under the board rather than as a modal
/// so the board stays visible.
class _PromotionPicker extends StatelessWidget {
  const _PromotionPicker({
    required this.color,
    required this.options,
    required this.onPick,
    required this.onCancel,
  });

  final PieceColor color;
  final List<PieceType> options;
  final ValueChanged<PieceType> onPick;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            const Expanded(child: Text('Promote your pawn to:')),
            for (final type in options)
              IconButton(
                tooltip: type.name,
                onPressed: () => onPick(type),
                icon: PieceGlyph(piece: Piece(color, type), size: 34),
              ),
            IconButton(
              tooltip: 'Cancel',
              onPressed: onCancel,
              icon: const Icon(Icons.close),
            ),
          ],
        ),
      ),
    );
  }
}

/// The scrolling move list, newest pair kept in view.
class _MoveList extends StatelessWidget {
  const _MoveList({required this.game});

  final ChessGame game;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sans = game.moveSans;
    if (sans.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(
          'Tap one of your pieces to see where it can go.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }

    final rows = <_MoveRow>[];
    for (var i = 0; i < sans.length; i += 2) {
      rows.add(
        _MoveRow(
          number: i ~/ 2 + 1,
          white: sans[i],
          black: i + 1 < sans.length ? sans[i + 1] : null,
        ),
      );
    }

    return Card(
      child: ListView.builder(
        reverse: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: rows.length,
        itemBuilder: (context, index) {
          final row = rows[rows.length - 1 - index];
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Row(
              children: [
                SizedBox(
                  width: 34,
                  child: Text(
                    '${row.number}.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(
                    row.white,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                Expanded(
                  child: Text(
                    row.black ?? '',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _MoveRow {
  const _MoveRow({required this.number, required this.white, this.black});

  final int number;
  final String white;
  final String? black;
}

import 'package:flutter/material.dart';

import '../chess/pieces.dart';
import '../game_session.dart';
import '../storage/game_library.dart';
import '../storage/game_record.dart';
import 'formatting.dart';
import 'game_review_screen.dart';
import 'game_screen.dart';

/// Saved games and the game log, in two tabs over the same library.
///
/// Both tabs delete the same way — swipe a row, or use its delete button —
/// and every delete offers an undo, since the alternative is losing a game
/// for good.
class LibraryScreen extends StatefulWidget {
  const LibraryScreen({
    super.key,
    required this.library,
    this.initialTab = 0,
    this.searchRunner,
  });

  final GameLibrary library;

  /// 0 = saved games, 1 = finished games.
  final int initialTab;

  final SearchRunner? searchRunner;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(
    length: 2,
    initialIndex: widget.initialTab,
    vsync: this,
  )..addListener(() => setState(() {}));

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  bool get _onLogTab => _tabs.index == 1;

  /// Clears the whole visible tab at once, with a single undo covering all of
  /// it. Handy for a log that has built up; guarded by a dialog that names how
  /// many games are going.
  Future<void> _deleteVisible(List<GameRecord> records) async {
    if (records.isEmpty) return;
    final count = records.length;
    final noun = count == 1 ? 'game' : 'games';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          _onLogTab ? 'Clear the game log?' : 'Delete all saved games?',
        ),
        content: Text(
          _onLogTab
              ? 'All $count logged $noun will be removed. Games still in '
                  'progress are not touched.'
              : 'All $count unfinished $noun will be deleted, so you will not '
                  'be able to carry on with them.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text('Delete $count'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    final removed =
        await widget.library.deleteAll(records.map((r) => r.id));
    if (removed.isEmpty) return;
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text('${removed.length} $noun deleted'),
        action: SnackBarAction(
          label: 'Undo',
          onPressed: () => widget.library.restore(removed),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.library,
      builder: (context, _) {
        final unfinished = widget.library.unfinished;
        final finished = widget.library.finished;
        final visible = _onLogTab ? finished : unfinished;
        return Scaffold(
          appBar: AppBar(
            title: const Text('Your games'),
            actions: [
              PopupMenuButton<void>(
                tooltip: 'More',
                itemBuilder: (context) => [
                  PopupMenuItem<void>(
                    enabled: visible.isNotEmpty,
                    onTap: () => _deleteVisible(visible),
                    child: Text(
                      _onLogTab ? 'Clear game log' : 'Delete all saved games',
                    ),
                  ),
                ],
              ),
            ],
            bottom: TabBar(
              controller: _tabs,
              tabs: [
                Tab(text: 'Saved (${unfinished.length})'),
                Tab(text: 'Log (${finished.length})'),
              ],
            ),
          ),
          body: TabBarView(
            controller: _tabs,
            children: [
              _GameList(
                library: widget.library,
                records: unfinished,
                searchRunner: widget.searchRunner,
                emptyTitle: 'No games in progress',
                emptyBody: 'Games you leave part-finished show up here, '
                    'ready to pick up whenever you like.',
              ),
              _GameList(
                library: widget.library,
                records: finished,
                searchRunner: widget.searchRunner,
                emptyTitle: 'No finished games yet',
                emptyBody: 'Every game you finish is logged here with its '
                    'result and full move list.',
              ),
            ],
          ),
        );
      },
    );
  }
}

class _GameList extends StatelessWidget {
  const _GameList({
    required this.library,
    required this.records,
    required this.emptyTitle,
    required this.emptyBody,
    this.searchRunner,
  });

  final GameLibrary library;
  final List<GameRecord> records;
  final String emptyTitle;
  final String emptyBody;
  final SearchRunner? searchRunner;

  @override
  Widget build(BuildContext context) {
    if (records.isEmpty) {
      return _EmptyState(title: emptyTitle, body: emptyBody);
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
      itemCount: records.length,
      itemBuilder: (context, index) {
        final record = records[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Dismissible(
            key: ValueKey(record.id),
            direction: DismissDirection.endToStart,
            background: _deleteBackground(context),
            confirmDismiss: (_) => confirmDeleteGame(context, record),
            onDismissed: (_) => deleteGameWithUndo(context, library, record),
            child: GameLibraryTile(
              record: record,
              onOpen: () => openGame(
                context,
                library: library,
                record: record,
                searchRunner: searchRunner,
              ),
              onDelete: () async {
                if (await confirmDeleteGame(context, record)) {
                  if (context.mounted) {
                    await deleteGameWithUndo(context, library, record);
                  }
                }
              },
            ),
          ),
        );
      },
    );
  }

  Widget _deleteBackground(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Icon(Icons.delete_outline, color: scheme.onErrorContainer),
    );
  }
}

/// Resumes an unfinished game, or opens a finished one for review.
Future<void> openGame(
  BuildContext context, {
  required GameLibrary library,
  required GameRecord record,
  SearchRunner? searchRunner,
}) {
  if (record.isFinished) {
    return Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => GameReviewScreen(record: record),
      ),
    );
  }
  return Navigator.of(context).push(
    MaterialPageRoute(
      builder: (context) => GameScreen(
        record: record,
        library: library,
        searchRunner: searchRunner,
      ),
    ),
  );
}

/// Asks before deleting. Unfinished games get a stronger warning, because
/// deleting one throws away a game that is still playable.
Future<bool> confirmDeleteGame(BuildContext context, GameRecord record) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(
        record.isFinished ? 'Delete this log entry?' : 'Delete this saved game?',
      ),
      content: Text(
        record.isFinished
            ? 'The game from ${formatDate(record.updatedAt)} will be removed '
                'from your log.'
            : 'This game is still in progress. Deleting it means you '
                "can't carry on with it.",
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

/// Deletes one entry and shows an undo snackbar.
Future<void> deleteGameWithUndo(
  BuildContext context,
  GameLibrary library,
  GameRecord record,
) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final removed = await library.delete(record.id);
  if (removed == null || messenger == null) return;
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      content: const Text('Game deleted'),
      action: SnackBarAction(
        label: 'Undo',
        onPressed: () => library.restore([removed]),
      ),
    ),
  );
}

/// One row in the saved-games or log list.
class GameLibraryTile extends StatelessWidget {
  const GameLibraryTile({
    super.key,
    required this.record,
    required this.onOpen,
    this.onDelete,
  });

  final GameRecord record;
  final VoidCallback onOpen;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final result = record.playerResult;

    final (Color badgeColor, Color badgeText, String badgeLabel) =
        switch (result) {
      GameResultForPlayer.win => (
          scheme.primaryContainer,
          scheme.onPrimaryContainer,
          'WIN',
        ),
      GameResultForPlayer.loss => (
          scheme.errorContainer,
          scheme.onErrorContainer,
          'LOSS',
        ),
      GameResultForPlayer.draw => (
          scheme.tertiaryContainer,
          scheme.onTertiaryContainer,
          'DRAW',
        ),
      GameResultForPlayer.unfinished => (
          scheme.secondaryContainer,
          scheme.onSecondaryContainer,
          '${record.fullMoveCount}',
        ),
    };

    return Card(
      child: ListTile(
        onTap: onOpen,
        leading: Container(
          width: 52,
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: badgeColor,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            badgeLabel,
            style: TextStyle(
              color: badgeText,
              fontWeight: FontWeight.w800,
              fontSize: badgeLabel.length > 3 ? 11 : 13,
            ),
          ),
        ),
        title: Text(
          '${record.difficulty.label} · '
          '${record.playerColor == PieceColor.white ? 'White' : 'Black'}',
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          record.isFinished
              ? '${record.outcome.description}\n'
                  '${record.fullMoveCount} moves · '
                  '${formatRelative(record.updatedAt)}'
              : '${record.fullMoveCount} moves played\n'
                  'Last played ${formatRelative(record.updatedAt)}',
        ),
        isThreeLine: true,
        trailing: onDelete == null
            ? const Icon(Icons.chevron_right)
            : IconButton(
                tooltip: 'Delete',
                onPressed: onDelete,
                icon: const Icon(Icons.delete_outline),
              ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.inbox_outlined,
              size: 56,
              color: theme.colorScheme.outline,
            ),
            const SizedBox(height: 16),
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

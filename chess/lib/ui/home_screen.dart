import 'package:flutter/material.dart';

import '../chess/pieces.dart';
import '../engine/difficulty.dart';
import '../game_session.dart';
import '../storage/game_library.dart';
import '../storage/game_record.dart';
import 'formatting.dart';
import 'game_screen.dart';
import 'library_screen.dart';
import 'new_game_sheet.dart';

/// Landing screen: carry on where you left off, start something new, or go
/// through what you have played.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.library, this.searchRunner});

  final GameLibrary library;

  /// Injected by tests so no isolate is spawned.
  final SearchRunner? searchRunner;

  Future<void> _startNewGame(BuildContext context) async {
    // Default to whatever was played last, which is usually what you want
    // again.
    final previous = library.all.isEmpty ? null : library.all.first;
    final choice = await showNewGameSheet(
      context,
      initialDifficulty: previous?.difficulty ?? Difficulty.medium,
      initialColor: previous?.playerColor ?? PieceColor.white,
    );
    if (choice == null || !context.mounted) return;

    final record = GameRecord.newGame(
      difficulty: choice.difficulty,
      playerColor: choice.playerColor,
    );
    await library.put(record);
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => GameScreen(
          record: record,
          library: library,
          searchRunner: searchRunner,
        ),
      ),
    );
  }

  void _openLibrary(BuildContext context, int tab) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => LibraryScreen(
          library: library,
          initialTab: tab,
          searchRunner: searchRunner,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: library,
      builder: (context, _) {
        final theme = Theme.of(context);
        final stats = library.stats;
        final resumable = library.mostRecentUnfinished;

        return Scaffold(
          appBar: AppBar(
            title: const Text('Chess'),
            actions: [
              IconButton(
                tooltip: 'Your games',
                onPressed: () => _openLibrary(context, 0),
                icon: const Icon(Icons.inventory_2_outlined),
              ),
            ],
          ),
          body: SafeArea(
            child: !library.isLoaded
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                    children: [
                      _StatsRow(stats: stats),
                      const SizedBox(height: 20),
                      if (resumable != null) ...[
                        Text(
                          'Carry on',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        GameLibraryTile(
                          record: resumable,
                          onOpen: () => openGame(
                            context,
                            library: library,
                            record: resumable,
                            searchRunner: searchRunner,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Saved automatically after every move — '
                          'last played ${formatRelative(resumable.updatedAt)}.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 24),
                      ],
                      FilledButton.icon(
                        onPressed: () => _startNewGame(context),
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('New game'),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () => _openLibrary(context, 0),
                        icon: const Icon(Icons.bookmark_border_rounded),
                        label: Text('Saved games (${stats.unfinished})'),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () => _openLibrary(context, 1),
                        icon: const Icon(Icons.history_rounded),
                        label: Text('Game log (${stats.finished})'),
                      ),
                      const SizedBox(height: 28),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Five levels, from Beginner to Expert',
                                style: theme.textTheme.titleSmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 10),
                              for (final level in Difficulty.values)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      SizedBox(
                                        width: 78,
                                        child: Text(
                                          level.label,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                      Expanded(
                                        child: Text(
                                          level.blurb,
                                          style: theme.textTheme.bodySmall
                                              ?.copyWith(
                                            color: theme
                                                .colorScheme.onSurfaceVariant,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
        );
      },
    );
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats});

  final LibraryStats stats;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _StatTile(label: 'Won', value: stats.wins),
        const SizedBox(width: 10),
        _StatTile(label: 'Drawn', value: stats.draws),
        const SizedBox(width: 10),
        _StatTile(label: 'Lost', value: stats.losses),
        const SizedBox(width: 10),
        _StatTile(label: 'Saved', value: stats.unfinished),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          children: [
            Text(
              '$value',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            Text(
              label,
              style: theme.textTheme.labelMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

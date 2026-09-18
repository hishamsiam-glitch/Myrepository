import 'package:flutter/foundation.dart';

import 'game_record.dart';
import 'game_storage.dart';

/// The app's single source of truth for saved and finished games.
///
/// Every change writes the whole library straight back to disk, so a game is
/// never lost to the app being swiped away mid-game — which is what makes
/// picking a game back up days later work.
class GameLibrary extends ChangeNotifier {
  GameLibrary(this._storage);

  final GameStorage _storage;
  final List<GameRecord> _records = [];
  bool _loaded = false;

  bool get isLoaded => _loaded;

  /// Newest activity first — the order both lists are shown in.
  List<GameRecord> get all {
    final sorted = List<GameRecord>.of(_records)
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return List.unmodifiable(sorted);
  }

  List<GameRecord> get unfinished =>
      List.unmodifiable(all.where((record) => !record.isFinished));

  List<GameRecord> get finished =>
      List.unmodifiable(all.where((record) => record.isFinished));

  /// The game "Continue" resumes: the most recently touched unfinished one.
  GameRecord? get mostRecentUnfinished =>
      unfinished.isEmpty ? null : unfinished.first;

  GameRecord? byId(String id) {
    for (final record in _records) {
      if (record.id == id) return record;
    }
    return null;
  }

  Future<void> load() async {
    final loaded = await _storage.load();
    _records
      ..clear()
      ..addAll(loaded);
    _loaded = true;
    notifyListeners();
  }

  /// Inserts [record], or replaces the existing one with the same id.
  Future<void> put(GameRecord record) async {
    final index = _records.indexWhere((entry) => entry.id == record.id);
    if (index >= 0) {
      _records[index] = record;
    } else {
      _records.add(record);
    }
    notifyListeners();
    await _persist();
  }

  /// Deletes one entry. Returns it so the caller can offer an undo.
  Future<GameRecord?> delete(String id) async {
    final index = _records.indexWhere((entry) => entry.id == id);
    if (index < 0) return null;
    final removed = _records.removeAt(index);
    notifyListeners();
    await _persist();
    return removed;
  }

  /// Deletes several entries at once (the log's "delete finished games").
  Future<List<GameRecord>> deleteAll(Iterable<String> ids) async {
    final wanted = ids.toSet();
    final removed = _records.where((entry) => wanted.contains(entry.id)).toList();
    if (removed.isEmpty) return const [];
    _records.removeWhere((entry) => wanted.contains(entry.id));
    notifyListeners();
    await _persist();
    return removed;
  }

  /// Puts deleted records back, for undo.
  Future<void> restore(List<GameRecord> records) async {
    if (records.isEmpty) return;
    for (final record in records) {
      if (_records.every((entry) => entry.id != record.id)) {
        _records.add(record);
      }
    }
    notifyListeners();
    await _persist();
  }

  Future<void> _persist() => _storage.save(List.of(_records));

  /// Games played, won, drawn and lost — the header of the log screen.
  LibraryStats get stats {
    var wins = 0;
    var losses = 0;
    var draws = 0;
    var open = 0;
    for (final record in _records) {
      switch (record.playerResult) {
        case GameResultForPlayer.win:
          wins++;
        case GameResultForPlayer.loss:
          losses++;
        case GameResultForPlayer.draw:
          draws++;
        case GameResultForPlayer.unfinished:
          open++;
      }
    }
    return LibraryStats(
      wins: wins,
      losses: losses,
      draws: draws,
      unfinished: open,
    );
  }
}

class LibraryStats {
  const LibraryStats({
    required this.wins,
    required this.losses,
    required this.draws,
    required this.unfinished,
  });

  final int wins;
  final int losses;
  final int draws;
  final int unfinished;

  int get finished => wins + losses + draws;

  int get total => finished + unfinished;
}

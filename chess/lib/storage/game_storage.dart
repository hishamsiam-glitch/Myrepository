import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'game_record.dart';

/// Where the game library lives. Abstracted so the rules/state tests can run
/// against an in-memory store instead of the device filesystem.
abstract class GameStorage {
  Future<List<GameRecord>> load();

  Future<void> save(List<GameRecord> records);
}

/// Stores the library as a single JSON document in the app's private
/// documents directory. Games are small (a FEN plus a list of moves), so one
/// file is both simpler and faster than a database here.
class FileGameStorage implements GameStorage {
  FileGameStorage({this.fileName = 'chess_games.json'});

  final String fileName;

  /// Serialises writes so two quick moves can't interleave and corrupt the
  /// file.
  Future<void> _pending = Future.value();

  Future<File> _file() async {
    final directory = await getApplicationDocumentsDirectory();
    return File('${directory.path}/$fileName');
  }

  @override
  Future<List<GameRecord>> load() async {
    try {
      final file = await _file();
      if (!await file.exists()) return [];
      final text = await file.readAsString();
      return decodeLibrary(text);
    } on Object {
      // A missing or unreadable library is not worth crashing over; the user
      // gets an empty list and can keep playing.
      return [];
    }
  }

  @override
  Future<void> save(List<GameRecord> records) {
    final chained = _pending.then((_) => _write(records));
    // Swallow failures here so one bad write doesn't poison the chain.
    _pending = chained.catchError((_) {});
    return chained;
  }

  Future<void> _write(List<GameRecord> records) async {
    final file = await _file();
    // Write beside the target and rename, so an interrupted write can't leave
    // a half-written library behind.
    final temp = File('${file.path}.tmp');
    await temp.writeAsString(encodeLibrary(records), flush: true);
    await temp.rename(file.path);
  }
}

/// Test/preview double.
class MemoryGameStorage implements GameStorage {
  MemoryGameStorage([List<GameRecord> initial = const []])
      : _records = List.of(initial);

  List<GameRecord> _records;

  @override
  Future<List<GameRecord>> load() async => List.of(_records);

  @override
  Future<void> save(List<GameRecord> records) async {
    _records = List.of(records);
  }
}

const int _libraryVersion = 1;

String encodeLibrary(List<GameRecord> records) => jsonEncode({
      'version': _libraryVersion,
      'games': [for (final record in records) record.toJson()],
    });

List<GameRecord> decodeLibrary(String text) {
  final decoded = jsonDecode(text);
  if (decoded is! Map) return [];
  final games = decoded['games'];
  if (games is! List) return [];
  final records = <GameRecord>[];
  for (final entry in games) {
    if (entry is! Map) continue;
    final record = GameRecord.tryFromJson(entry.cast<String, Object?>());
    if (record != null) records.add(record);
  }
  return records;
}

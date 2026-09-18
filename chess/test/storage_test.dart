import 'package:chess/chess/game.dart';
import 'package:chess/chess/pieces.dart';
import 'package:chess/chess/position.dart';
import 'package:chess/engine/difficulty.dart';
import 'package:chess/storage/game_library.dart';
import 'package:chess/storage/game_record.dart';
import 'package:chess/storage/game_storage.dart';
import 'package:flutter_test/flutter_test.dart';

GameRecord sampleRecord({
  String id = 'g1',
  Difficulty difficulty = Difficulty.medium,
  PieceColor playerColor = PieceColor.white,
  List<String> moves = const ['e2e4', 'e7e5'],
  GameOutcome outcome = GameOutcome.inProgress,
  DateTime? updatedAt,
}) {
  final created = DateTime(2026, 3, 1, 9);
  return GameRecord(
    id: id,
    createdAt: created,
    updatedAt: updatedAt ?? created,
    difficulty: difficulty,
    playerColor: playerColor,
    startFen: Position.startingFen,
    moveUcis: moves,
    outcome: outcome,
  );
}

void main() {
  group('GameRecord', () {
    test('a new game starts empty and unfinished', () {
      final record = GameRecord.newGame(
        difficulty: Difficulty.hard,
        playerColor: PieceColor.black,
      );
      expect(record.moveUcis, isEmpty);
      expect(record.isFinished, isFalse);
      expect(record.playerResult, GameResultForPlayer.unfinished);
      expect(record.startFen, Position.startingFen);
      expect(record.id, isNotEmpty);
    });

    test('counts full moves, not plies', () {
      expect(sampleRecord(moves: const []).fullMoveCount, 0);
      expect(sampleRecord(moves: const ['e2e4']).fullMoveCount, 1);
      expect(sampleRecord(moves: const ['e2e4', 'e7e5']).fullMoveCount, 1);
      expect(
        sampleRecord(moves: const ['e2e4', 'e7e5', 'g1f3']).fullMoveCount,
        2,
      );
    });

    test('reads the result from the player point of view', () {
      expect(
        sampleRecord(
          playerColor: PieceColor.white,
          outcome: GameOutcome.whiteWinsByCheckmate,
        ).playerResult,
        GameResultForPlayer.win,
      );
      expect(
        sampleRecord(
          playerColor: PieceColor.black,
          outcome: GameOutcome.whiteWinsByCheckmate,
        ).playerResult,
        GameResultForPlayer.loss,
      );
      expect(
        sampleRecord(outcome: GameOutcome.drawByStalemate).playerResult,
        GameResultForPlayer.draw,
      );
    });

    test('replays into a live game', () {
      final game = sampleRecord().toGame();
      expect(game.moveSans, ['e4', 'e5']);
      expect(game.position.turn, PieceColor.white);
    });

    test('survives a JSON round-trip', () {
      final record = sampleRecord(
        difficulty: Difficulty.expert,
        playerColor: PieceColor.black,
        outcome: GameOutcome.blackWinsByResignation,
      );
      final restored = GameRecord.tryFromJson(record.toJson());
      expect(restored, isNotNull);
      expect(restored!.id, record.id);
      expect(restored.difficulty, Difficulty.expert);
      expect(restored.playerColor, PieceColor.black);
      expect(restored.moveUcis, record.moveUcis);
      expect(restored.outcome, GameOutcome.blackWinsByResignation);
      expect(restored.createdAt, record.createdAt);
      expect(restored.updatedAt, record.updatedAt);
    });

    test('rejects entries with no id, and tolerates missing fields', () {
      expect(GameRecord.tryFromJson({'moves': 'e2e4'}), isNull);
      expect(GameRecord.tryFromJson({'id': ''}), isNull);

      final sparse = GameRecord.tryFromJson({'id': 'x'});
      expect(sparse, isNotNull);
      expect(sparse!.moveUcis, isEmpty);
      expect(sparse.difficulty, Difficulty.medium);
      expect(sparse.playerColor, PieceColor.white);
      expect(sparse.outcome, GameOutcome.inProgress);
      expect(sparse.startFen, Position.startingFen);
    });

    test('rejects an unusable starting position', () {
      expect(
        GameRecord.tryFromJson({'id': 'x', 'startFen': 'nonsense'}),
        isNull,
      );
    });

    test('falls back to sane values for unknown enum names', () {
      final record = GameRecord.tryFromJson({
        'id': 'x',
        'difficulty': 'grandmaster',
        'outcome': 'abandonedByCat',
      });
      expect(record!.difficulty, Difficulty.medium);
      expect(record.outcome, GameOutcome.inProgress);
    });
  });

  group('library encoding', () {
    test('round-trips a library', () {
      final records = [
        sampleRecord(id: 'a'),
        sampleRecord(id: 'b', outcome: GameOutcome.whiteWinsByCheckmate),
      ];
      final decoded = decodeLibrary(encodeLibrary(records));
      expect(decoded.map((r) => r.id), ['a', 'b']);
      expect(decoded[1].outcome, GameOutcome.whiteWinsByCheckmate);
    });

    test('an empty library round-trips', () {
      expect(decodeLibrary(encodeLibrary([])), isEmpty);
    });

    test('skips unreadable entries instead of failing the whole file', () {
      const text = '{"version":1,"games":['
          '{"id":"good","moves":"e2e4"},'
          '{"nope":true},'
          '"not even an object"'
          ']}';
      final decoded = decodeLibrary(text);
      expect(decoded.map((r) => r.id), ['good']);
    });

    test('ignores a document that is not a library', () {
      expect(decodeLibrary('[]'), isEmpty);
      expect(decodeLibrary('{"version":1}'), isEmpty);
      expect(decodeLibrary('{"version":1,"games":"nope"}'), isEmpty);
    });
  });

  group('GameLibrary', () {
    late GameLibrary library;
    late MemoryGameStorage storage;

    setUp(() async {
      storage = MemoryGameStorage();
      library = GameLibrary(storage);
      await library.load();
    });

    test('starts empty and loaded', () {
      expect(library.isLoaded, isTrue);
      expect(library.all, isEmpty);
      expect(library.stats.total, 0);
    });

    test('adds a game and writes it through to storage', () async {
      await library.put(sampleRecord(id: 'a'));
      expect(library.all.map((r) => r.id), ['a']);
      expect((await storage.load()).map((r) => r.id), ['a']);
    });

    test('replaces a game with the same id rather than duplicating it',
        () async {
      await library.put(sampleRecord(id: 'a', moves: const ['e2e4']));
      await library.put(
        sampleRecord(id: 'a', moves: const ['e2e4', 'e7e5', 'g1f3']),
      );
      expect(library.all.length, 1);
      expect(library.byId('a')!.moveUcis.length, 3);
    });

    test('sorts newest activity first', () async {
      await library.put(
        sampleRecord(id: 'old', updatedAt: DateTime(2026, 1, 1)),
      );
      await library.put(
        sampleRecord(id: 'new', updatedAt: DateTime(2026, 6, 1)),
      );
      expect(library.all.map((r) => r.id), ['new', 'old']);
    });

    test('splits unfinished games from the log', () async {
      await library.put(sampleRecord(id: 'open'));
      await library.put(
        sampleRecord(
          id: 'done',
          outcome: GameOutcome.whiteWinsByCheckmate,
          updatedAt: DateTime(2026, 5, 1),
        ),
      );
      expect(library.unfinished.map((r) => r.id), ['open']);
      expect(library.finished.map((r) => r.id), ['done']);
      expect(library.mostRecentUnfinished!.id, 'open');
    });

    test('mostRecentUnfinished is the latest one touched', () async {
      await library.put(
        sampleRecord(id: 'older', updatedAt: DateTime(2026, 1, 1)),
      );
      await library.put(
        sampleRecord(id: 'newer', updatedAt: DateTime(2026, 2, 1)),
      );
      expect(library.mostRecentUnfinished!.id, 'newer');
    });

    test('deletes one entry and persists the deletion', () async {
      await library.put(sampleRecord(id: 'a'));
      await library.put(sampleRecord(id: 'b'));
      final removed = await library.delete('a');
      expect(removed!.id, 'a');
      expect(library.all.map((r) => r.id), ['b']);
      expect((await storage.load()).map((r) => r.id), ['b']);
    });

    test('deleting an unknown id changes nothing', () async {
      await library.put(sampleRecord(id: 'a'));
      expect(await library.delete('nope'), isNull);
      expect(library.all.length, 1);
    });

    test('deletes several entries at once', () async {
      await library.put(sampleRecord(id: 'a'));
      await library.put(sampleRecord(id: 'b'));
      await library.put(sampleRecord(id: 'c'));
      final removed = await library.deleteAll(['a', 'c', 'missing']);
      expect(removed.map((r) => r.id), ['a', 'c']);
      expect(library.all.map((r) => r.id), ['b']);
    });

    test('restores deleted entries, for undo', () async {
      await library.put(sampleRecord(id: 'a'));
      final removed = await library.delete('a');
      expect(library.all, isEmpty);
      await library.restore([removed!]);
      expect(library.byId('a'), isNotNull);
      expect((await storage.load()).map((r) => r.id), ['a']);
    });

    test('restoring an entry that is already there does not duplicate it',
        () async {
      final record = sampleRecord(id: 'a');
      await library.put(record);
      await library.restore([record]);
      expect(library.all.length, 1);
    });

    test('notifies listeners on every change', () async {
      var notifications = 0;
      library.addListener(() => notifications++);
      await library.put(sampleRecord(id: 'a'));
      await library.delete('a');
      await library.restore([sampleRecord(id: 'a')]);
      expect(notifications, 3);
    });

    test('counts wins, losses, draws and saved games', () async {
      await library.put(
        sampleRecord(id: 'w', outcome: GameOutcome.whiteWinsByCheckmate),
      );
      await library.put(
        sampleRecord(id: 'l', outcome: GameOutcome.blackWinsByCheckmate),
      );
      await library.put(
        sampleRecord(id: 'd', outcome: GameOutcome.drawByThreefoldRepetition),
      );
      await library.put(sampleRecord(id: 'open'));

      final stats = library.stats;
      expect(stats.wins, 1);
      expect(stats.losses, 1);
      expect(stats.draws, 1);
      expect(stats.unfinished, 1);
      expect(stats.finished, 3);
      expect(stats.total, 4);
    });

    test('reads an existing library back on load', () async {
      final seeded = GameLibrary(MemoryGameStorage([sampleRecord(id: 'seed')]));
      await seeded.load();
      expect(seeded.all.map((r) => r.id), ['seed']);
    });
  });
}

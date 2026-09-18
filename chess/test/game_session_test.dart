import 'package:chess/chess/game.dart';
import 'package:chess/chess/move.dart';
import 'package:chess/chess/pieces.dart';
import 'package:chess/engine/difficulty.dart';
import 'package:chess/engine/search.dart';
import 'package:chess/game_session.dart';
import 'package:chess/storage/game_library.dart';
import 'package:chess/storage/game_record.dart';
import 'package:chess/storage/game_storage.dart';
import 'package:flutter_test/flutter_test.dart';

/// Runs the real search on the calling isolate, so tests stay deterministic
/// and don't pay isolate startup.
SearchRunner inlineSearch({int seed = 1}) => (request) async => Search.run(
      SearchRequest(
        fen: request.fen,
        difficulty: request.difficulty,
        seed: seed,
        repeatedKeys: request.repeatedKeys,
      ),
    );

/// A runner that plays a fixed move, for testing the plumbing rather than the
/// engine.
SearchRunner fixedSearch(String uci) => (request) async => SearchResult(
      move: Move.tryParseUci(uci),
      score: 0,
      depth: 1,
      nodes: 1,
      elapsed: Duration.zero,
    );

Future<(GameSession, GameLibrary)> newSession({
  PieceColor playerColor = PieceColor.white,
  Difficulty difficulty = Difficulty.beginner,
  SearchRunner? runner,
  List<String> moves = const [],
}) async {
  final library = GameLibrary(MemoryGameStorage());
  await library.load();
  var record = GameRecord.newGame(
    difficulty: difficulty,
    playerColor: playerColor,
    id: 'test-game',
  );
  if (moves.isNotEmpty) record = record.copyWith(moveUcis: moves);
  await library.put(record);
  final session = GameSession(
    record: record,
    library: library,
    searchRunner: runner ?? inlineSearch(),
    autoStartAi: false,
  );
  return (session, library);
}

void main() {
  group('selection', () {
    test('tapping your own piece selects it and shows its moves', () async {
      final (session, _) = await newSession();
      session.tapSquare(parseSquare('e2')!);
      expect(session.selectedSquare, parseSquare('e2'));
      expect(
        session.moveTargets,
        {parseSquare('e3')!, parseSquare('e4')!},
      );
    });

    test('tapping an empty square clears the selection', () async {
      final (session, _) = await newSession();
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('a5')!);
      expect(session.selectedSquare, isNull);
      expect(session.moveTargets, isEmpty);
    });

    test('tapping an opponent piece does not select it', () async {
      final (session, _) = await newSession();
      session.tapSquare(parseSquare('e7')!);
      expect(session.selectedSquare, isNull);
    });

    test('tapping a highlighted square plays the move', () async {
      final (session, _) = await newSession(runner: fixedSearch('e7e5'));
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      expect(session.game.moveSans.first, 'e4');
      expect(session.selectedSquare, isNull);
    });

    test('taps are ignored when it is not your turn', () async {
      final (session, _) = await newSession(playerColor: PieceColor.black);
      session.tapSquare(parseSquare('e7')!);
      expect(session.selectedSquare, isNull);
    });
  });

  group('promotion', () {
    test('asks which piece to promote to, then plays it', () async {
      // White pawn one step from promoting, with the AI to reply.
      final (session, _) = await newSession(
        moves: const [
          'h2h4', 'a7a5', 'h4h5', 'a5a4', 'h5h6', 'a4a3', //
          'h6g7', 'a3b2',
        ],
        runner: fixedSearch('b2a1q'),
      );
      session.tapSquare(parseSquare('g7')!);
      session.tapSquare(parseSquare('h8')!);

      final pending = session.pendingPromotion;
      expect(pending, isNotNull);
      expect(pending!.options.length, 4);
      // Nothing is played until the piece is chosen.
      expect(session.game.moveUcis.length, 8);

      session.choosePromotion(PieceType.knight);
      expect(session.pendingPromotion, isNull);
      expect(session.game.moveUcis.last, 'g7h8n');
      expect(
        session.position.pieceAt(parseSquare('h8')!),
        const Piece(PieceColor.white, PieceType.knight),
      );
    });

    test('cancelling leaves the board untouched', () async {
      final (session, _) = await newSession(
        moves: const [
          'h2h4', 'a7a5', 'h4h5', 'a5a4', 'h5h6', 'a4a3', //
          'h6g7', 'a3b2',
        ],
      );
      final before = session.position.fen;
      session.tapSquare(parseSquare('g7')!);
      session.tapSquare(parseSquare('h8')!);
      expect(session.pendingPromotion, isNotNull);
      session.cancelPromotion();
      expect(session.pendingPromotion, isNull);
      expect(session.position.fen, before);
    });
  });

  group('the computer taking its turn', () {
    test('replies after your move and saves both', () async {
      final (session, library) = await newSession(runner: fixedSearch('e7e5'));
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      await pumpEventQueue();

      expect(session.game.moveUcis, ['e2e4', 'e7e5']);
      expect(session.isThinking, isFalse);
      expect(session.isPlayerTurn, isTrue);
      expect(library.byId('test-game')!.moveUcis, ['e2e4', 'e7e5']);
    });

    test('moves first when you play Black', () async {
      final library = GameLibrary(MemoryGameStorage());
      await library.load();
      final record = GameRecord.newGame(
        difficulty: Difficulty.beginner,
        playerColor: PieceColor.black,
        id: 'black-game',
      );
      await library.put(record);
      final session = GameSession(
        record: record,
        library: library,
        searchRunner: fixedSearch('d2d4'),
      );
      await pumpEventQueue();
      expect(session.game.moveUcis, ['d2d4']);
      expect(session.isPlayerTurn, isTrue);
    });

    test('falls back to a legal move if the search returns nothing', () async {
      final (session, _) = await newSession(
        runner: (request) async => const SearchResult(
          move: null,
          score: 0,
          depth: 0,
          nodes: 0,
          elapsed: Duration.zero,
        ),
      );
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      await pumpEventQueue();
      expect(session.game.moveUcis.length, 2);
    });

    test('falls back to a legal move if the search throws', () async {
      final (session, _) = await newSession(
        runner: (request) async => throw StateError('boom'),
      );
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      await pumpEventQueue();
      expect(session.game.moveUcis.length, 2);
      expect(session.isThinking, isFalse);
    });

    test('ignores an illegal move from the search', () async {
      final (session, _) = await newSession(runner: fixedSearch('a1a8'));
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      await pumpEventQueue();
      expect(session.game.moveUcis.length, 2);
      expect(session.game.moveUcis.last, isNot('a1a8'));
    });
  });

  group('take back', () {
    test('undoes your move and the reply, leaving you to move', () async {
      final (session, library) = await newSession(runner: fixedSearch('e7e5'));
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      await pumpEventQueue();
      expect(session.game.moveUcis.length, 2);

      await session.undoPlayerMove();
      await pumpEventQueue();
      expect(session.game.moveUcis, isEmpty);
      expect(session.isPlayerTurn, isTrue);
      expect(library.byId('test-game')!.moveUcis, isEmpty);
    });

    test('is unavailable before anything has been played', () async {
      final (session, _) = await newSession();
      expect(session.canUndo, isFalse);
      await session.undoPlayerMove();
      expect(session.game.moveUcis, isEmpty);
    });

    test('discards an AI reply that lands after a take-back', () async {
      // A slow search whose answer arrives after the player has undone.
      Future<SearchResult> slow(SearchRequest request) async {
        await Future<void>.delayed(const Duration(milliseconds: 40));
        return SearchResult(
          move: Move.tryParseUci('e7e5'),
          score: 0,
          depth: 1,
          nodes: 1,
          elapsed: Duration.zero,
        );
      }
      final (session, _) = await newSession(runner: slow);
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      expect(session.isThinking, isTrue);

      await session.undoPlayerMove();
      await Future<void>.delayed(const Duration(milliseconds: 120));
      await pumpEventQueue();

      expect(session.game.moveUcis, isEmpty);
      expect(session.isThinking, isFalse);
    });
  });

  group('ending the game', () {
    test('resigning records a loss and saves it', () async {
      final (session, library) = await newSession();
      session.resign();
      expect(session.outcome, GameOutcome.blackWinsByResignation);
      expect(library.byId('test-game')!.isFinished, isTrue);
      expect(
        library.byId('test-game')!.playerResult,
        GameResultForPlayer.loss,
      );
    });

    test('a checkmate you deliver is recorded as a win', () async {
      final (session, library) = await newSession(
        moves: const ['e2e4', 'a7a5', 'f1c4', 'a5a4', 'd1f3', 'a4a3'],
        runner: fixedSearch('b2a3'),
      );
      // Qf3xf7 is mate.
      session.tapSquare(parseSquare('f3')!);
      session.tapSquare(parseSquare('f7')!);
      await pumpEventQueue();

      expect(session.outcome, GameOutcome.whiteWinsByCheckmate);
      expect(session.game.moveSans.last, 'Qxf7#');
      final saved = library.byId('test-game')!;
      expect(saved.isFinished, isTrue);
      expect(saved.playerResult, GameResultForPlayer.win);
    });

    test('taps are ignored once the game is over', () async {
      final (session, _) = await newSession();
      session.resign();
      session.tapSquare(parseSquare('e2')!);
      expect(session.selectedSquare, isNull);
    });
  });

  group('board hints', () {
    test('reports the last move and the checked king', () async {
      final (session, _) = await newSession(
        moves: const ['e2e4', 'a7a5', 'f1c4', 'a5a4', 'd1f3', 'a4a3'],
        runner: fixedSearch('b2a3'),
      );
      expect(session.lastMove, Move.tryParseUci('a4a3'));
      expect(session.checkedKingSquare, isNull);

      session.tapSquare(parseSquare('f3')!);
      session.tapSquare(parseSquare('f7')!);
      expect(session.checkedKingSquare, parseSquare('e8'));
      expect(session.lastMove, Move.tryParseUci('f3f7'));
    });
  });

  group('resuming', () {
    test('a saved game comes back with its moves and whose turn it is',
        () async {
      final library = GameLibrary(MemoryGameStorage());
      await library.load();
      final record = GameRecord.newGame(
        difficulty: Difficulty.medium,
        playerColor: PieceColor.white,
        id: 'resume',
      ).copyWith(moveUcis: const ['e2e4', 'e7e5', 'g1f3']);
      await library.put(record);

      final session = GameSession(
        record: record,
        library: library,
        searchRunner: fixedSearch('b8c6'),
        autoStartAi: false,
      );
      expect(session.game.moveSans, ['e4', 'e5', 'Nf3']);
      expect(session.position.turn, PieceColor.black);
      expect(session.difficulty, Difficulty.medium);
      expect(session.playerColor, PieceColor.white);
      expect(session.aiColor, PieceColor.black);
    });
  });

  group('the real engine', () {
    test('answers a real opening move with a legal reply', () async {
      final (session, _) = await newSession(
        difficulty: Difficulty.medium,
        runner: inlineSearch(seed: 5),
      );
      session.tapSquare(parseSquare('e2')!);
      session.tapSquare(parseSquare('e4')!);
      await pumpEventQueue();
      expect(session.game.moveUcis.length, 2);
      expect(session.lastSearch, isNotNull);
      expect(session.lastSearch!.depth, greaterThan(0));
    });
  });
}

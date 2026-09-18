import 'package:chess/chess/move.dart';
import 'package:chess/chess/pieces.dart';
import 'package:chess/chess/position.dart';
import 'package:chess/engine/difficulty.dart';
import 'package:chess/engine/evaluation.dart';
import 'package:chess/engine/search.dart';
import 'package:flutter_test/flutter_test.dart';

SearchResult think(
  String fen, {
  Difficulty difficulty = Difficulty.hard,
  int seed = 7,
  List<String> repeatedKeys = const [],
}) {
  return Search.run(
    SearchRequest(
      fen: fen,
      difficulty: difficulty,
      seed: seed,
      repeatedKeys: repeatedKeys,
    ),
  );
}

void main() {
  group('evaluation', () {
    test('is symmetric at the start', () {
      expect(evaluate(Position.initial()), 0);
    });

    test('counts material from White\'s point of view', () {
      // Black is a whole queen down.
      final position =
          Position.fromFen('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
      expect(evaluate(position), greaterThan(800));
      // And the mirror image is the same magnitude the other way.
      final mirrored =
          Position.fromFen('3qk3/8/8/8/8/8/8/4K3 w - - 0 1');
      expect(evaluate(mirrored), lessThan(-800));
    });

    test('prefers a centralised knight to one in the corner', () {
      final centre = evaluate(
        Position.fromFen('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1'),
      );
      final corner = evaluate(
        Position.fromFen('4k3/8/8/8/8/8/8/N3K3 w - - 0 1'),
      );
      expect(centre, greaterThan(corner));
    });

    test('rewards the bishop pair', () {
      final pair = evaluate(
        Position.fromFen('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1'),
      );
      final single = evaluate(
        Position.fromFen('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'),
      );
      expect(pair - single, greaterThan(pieceValues[PieceType.bishop.index]));
    });
  });

  group('tactics', () {
    test('plays mate in one', () {
      final result = think('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
      expect(result.move, Move(parseSquare('a1')!, parseSquare('a8')!));
    });

    test('finds a mate in two', () {
      // Two rooks against a bare king. Rg1 is the only move that forces mate
      // in two (1. Rg1 Kh7 2. Rh2#), and it is not even a check — so the
      // search has to look three plies ahead to see it.
      final result = think(
        '7k/8/8/8/8/8/1R6/1R5K w - - 0 1',
        difficulty: Difficulty.expert,
      );
      expect(result.move, Move(parseSquare('b1')!, parseSquare('g1')!));
      expect(result.score, greaterThan(10000));
    });

    test('takes a free queen', () {
      final result = think('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
      expect(result.move, Move(parseSquare('e4')!, parseSquare('d5')!));
    });

    test('does not walk into a losing recapture', () {
      // The pawn on d5 is defended by the c6 pawn, so Nxd5 loses a knight for
      // a pawn. Quiescence is what stops the search from liking it.
      const fen = '4k3/8/2p5/3p4/8/4N3/8/4K3 w - - 0 1';
      final result = think(fen);
      expect(result.move, isNot(Move(parseSquare('e3')!, parseSquare('d5')!)));
    });

    test('escapes check rather than ignoring it', () {
      const fen = '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1';
      final result = think(fen);
      final after = Position.fromFen(fen).applyMove(result.move!);
      expect(after.isCheck, isFalse);
    });
  });

  group('difficulty', () {
    test('every level returns a legal move', () {
      const fen =
          'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4';
      final legal = Position.fromFen(fen).legalMoves();
      for (final level in Difficulty.values) {
        final result = think(fen, difficulty: level, seed: 3);
        expect(result.move, isNotNull, reason: level.label);
        expect(legal, contains(result.move), reason: level.label);
      }
    });

    test('stronger levels search deeper', () {
      const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5';
      final easy = think(fen, difficulty: Difficulty.easy);
      final hard = think(fen, difficulty: Difficulty.hard);
      expect(hard.depth, greaterThan(easy.depth));
      expect(hard.nodes, greaterThan(easy.nodes));
    });

    test('the same seed gives the same move', () {
      const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      final first = think(fen, difficulty: Difficulty.beginner, seed: 42);
      final second = think(fen, difficulty: Difficulty.beginner, seed: 42);
      expect(first.move, second.move);
    });

    test('beginner varies its opening move across seeds', () {
      const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      final moves = {
        for (var seed = 0; seed < 12; seed++)
          think(fen, difficulty: Difficulty.beginner, seed: seed).move,
      };
      expect(moves.length, greaterThan(1));
    });

    test('expert still finds mate in one despite no randomness', () {
      final result = think(
        '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        difficulty: Difficulty.expert,
      );
      expect(result.move, Move(parseSquare('a1')!, parseSquare('a8')!));
    });

    test('stays inside its time budget', () {
      final result = think(
        'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
        difficulty: Difficulty.medium,
      );
      // Iterative deepening only stops between passes, so allow generous
      // slack for one overshooting pass; the point is that it terminates.
      expect(
        result.elapsed.inMilliseconds,
        lessThan(Difficulty.medium.timeBudgetMs * 8),
      );
    });
  });

  group('edge cases', () {
    test('returns no move when the game is already over', () {
      // Black is checkmated on the back rank, so there is nothing to search.
      final result = think('1R4k1/5ppp/8/8/8/8/8/6RK b - - 1 1');
      expect(result.move, isNull);
      expect(result.depth, 0);
    });

    test('avoids repeating a position it has already reached when winning', () {
      // White is a queen up. Qd4-d1 returns to a position already seen, so the
      // search should prefer literally anything else.
      const fen = '7k/8/8/8/3Q4/8/8/7K w - - 10 40';
      final repeatKey =
          Position.fromFen('7k/8/8/8/8/8/8/3Q3K b - - 11 40').repetitionKey;
      final result = think(
        fen,
        difficulty: Difficulty.hard,
        repeatedKeys: [repeatKey],
      );
      expect(result.move, isNot(Move(parseSquare('d4')!, parseSquare('d1')!)));
    });

    test('takes the repetition when it is losing', () {
      // White has a queen against a queen and two rooks, so a repetition draw
      // is far better than anything else on offer.
      const fen = 'rqr4k/8/8/8/3Q4/8/8/7K w - - 10 40';
      final repeatKey =
          Position.fromFen('rqr4k/8/8/8/8/8/8/3Q3K b - - 11 40').repetitionKey;
      final result = think(
        fen,
        difficulty: Difficulty.hard,
        repeatedKeys: [repeatKey],
      );
      expect(result.score, 0);
      expect(result.move, Move(parseSquare('d4')!, parseSquare('d1')!));
    });
  });
}

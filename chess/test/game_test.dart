import 'package:chess/chess/game.dart';
import 'package:chess/chess/move.dart';
import 'package:chess/chess/pieces.dart';
import 'package:chess/chess/position.dart';
import 'package:flutter_test/flutter_test.dart';

/// Plays a list of SAN moves, failing the test if any of them is illegal.
void playSans(ChessGame game, List<String> sans) {
  for (final san in sans) {
    final move = game.position.moveFromSan(san);
    expect(move, isNotNull, reason: 'illegal SAN "$san" in ${game.position.fen}');
    game.play(move!);
  }
}

void main() {
  group('playing moves', () {
    test('records SAN and advances the position', () {
      final game = ChessGame();
      expect(game.play(Move(parseSquare('e2')!, parseSquare('e4')!)), 'e4');
      expect(game.position.turn, PieceColor.black);
      expect(game.moveUcis, ['e2e4']);
      expect(game.moveSans, ['e4']);
      expect(game.outcome, GameOutcome.inProgress);
    });

    test('rejects an illegal move', () {
      final game = ChessGame();
      expect(
        () => game.play(Move(parseSquare('e2')!, parseSquare('e5')!)),
        throwsArgumentError,
      );
    });

    test('refuses to play on once the game is over', () {
      final game = ChessGame();
      playSans(game, ['f3', 'e5', 'g4', 'Qh4']);
      expect(game.outcome, GameOutcome.blackWinsByCheckmate);
      expect(
        () => game.play(Move(parseSquare('e1')!, parseSquare('f2')!)),
        throwsStateError,
      );
      expect(game.legalMoves(), isEmpty);
    });
  });

  group('outcomes', () {
    test('detects the fastest checkmate', () {
      final game = ChessGame();
      playSans(game, ['f3', 'e5', 'g4', 'Qh4']);
      expect(game.isOver, isTrue);
      expect(game.outcome.winner, PieceColor.black);
      expect(game.outcome.scoreLine, '0-1');
      expect(game.moveSans.last, 'Qh4#');
    });

    test('detects stalemate', () {
      final game = ChessGame();
      playSans(game, [
        'e3', 'a5', 'Qh5', 'Ra6', 'Qxa5', 'h5', 'Qxc7', 'Rah6', //
        'h4', 'f6', 'Qxd7+', 'Kf7', 'Qxb7', 'Qd3', 'Qxb8', 'Qh7', //
        'Qxc8', 'Kg6', 'Qe6',
      ]);
      expect(game.outcome, GameOutcome.drawByStalemate);
      expect(game.outcome.isDraw, isTrue);
      expect(game.outcome.scoreLine, '1/2-1/2');
    });

    test('declares a draw on the third repetition', () {
      final game = ChessGame();
      // Knights out and back, twice, returns the start position twice more.
      playSans(game, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']);
      expect(game.outcome, GameOutcome.inProgress);
      playSans(game, ['Ng8']);
      expect(game.currentRepetitionCount, 3);
      expect(game.outcome, GameOutcome.drawByThreefoldRepetition);
    });

    test('declares a draw at the fifty-move mark', () {
      // The clock is already at 99 plies, so one more quiet move hits 100.
      final game = ChessGame(
        start: Position.fromFen('r3k3/8/8/8/8/8/8/4K2R w - - 99 80'),
      );
      expect(game.outcome, GameOutcome.inProgress);
      game.play(Move(parseSquare('h1')!, parseSquare('h2')!));
      expect(game.position.halfmoveClock, 100);
      expect(game.outcome, GameOutcome.drawByFiftyMoveRule);
    });

    test('declares a draw when only kings are left', () {
      final game = ChessGame(
        start: Position.fromFen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'),
      );
      game.play(Move(parseSquare('e1')!, parseSquare('e2')!));
      expect(game.outcome, GameOutcome.drawByInsufficientMaterial);
    });

    test('resignation ends the game for the resigning side', () {
      final game = ChessGame();
      playSans(game, ['e4', 'e5']);
      game.resign(PieceColor.white);
      expect(game.outcome, GameOutcome.blackWinsByResignation);
      expect(game.outcome.winner, PieceColor.black);
      expect(game.isOver, isTrue);
    });
  });

  group('undo', () {
    test('restores the previous position and clears the outcome', () {
      final game = ChessGame();
      playSans(game, ['f3', 'e5', 'g4', 'Qh4']);
      expect(game.isOver, isTrue);
      game.undo();
      expect(game.isOver, isFalse);
      expect(game.history.length, 3);
      expect(game.position.turn, PieceColor.black);
    });

    test('rolls back repetition counts', () {
      final game = ChessGame();
      playSans(game, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
      expect(game.outcome, GameOutcome.drawByThreefoldRepetition);
      game.undo();
      expect(game.outcome, GameOutcome.inProgress);
      expect(game.currentRepetitionCount, 2);
    });

    test('undoing more moves than were played is harmless', () {
      final game = ChessGame();
      playSans(game, ['e4']);
      game.undo(5);
      expect(game.history, isEmpty);
      expect(game.position.fen, Position.startingFen);
    });
  });

  group('replay', () {
    test('rebuilds a game from its stored moves', () {
      final original = ChessGame();
      playSans(original, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);

      final replayed = ChessGame.replay(
        startFen: Position.startingFen,
        moveUcis: original.moveUcis,
      );
      expect(replayed.position.fen, original.position.fen);
      expect(replayed.moveSans, original.moveSans);
    });

    test('stops at the first move that does not fit, rather than throwing', () {
      final game = ChessGame.replay(
        startFen: Position.startingFen,
        moveUcis: ['e2e4', 'e7e5', 'e4e5', 'garbage', 'd2d4'],
      );
      // e4e5 is blocked by the black pawn, so replay stops after two moves.
      expect(game.moveUcis, ['e2e4', 'e7e5']);
    });

    test('re-applies a stored resignation', () {
      final game = ChessGame.replay(
        startFen: Position.startingFen,
        moveUcis: ['e2e4', 'e7e5'],
        resolution: GameOutcome.blackWinsByResignation,
      );
      expect(game.outcome, GameOutcome.blackWinsByResignation);
    });

    test('a stored resignation never overrides a real result', () {
      final game = ChessGame.replay(
        startFen: Position.startingFen,
        moveUcis: ['f2f3', 'e7e5', 'g2g4', 'd8h4'],
        resolution: GameOutcome.whiteWinsByResignation,
      );
      expect(game.outcome, GameOutcome.blackWinsByCheckmate);
    });
  });

  group('move text', () {
    test('numbers the moves in pairs', () {
      final game = ChessGame();
      playSans(game, ['e4', 'e5', 'Nf3']);
      expect(game.movesText, '1. e4 e5 2. Nf3');
    });

    test('handles a game that starts with Black to move', () {
      final game = ChessGame(
        start: Position.fromFen(
          'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        ),
      );
      playSans(game, ['e5', 'Nf3']);
      expect(game.movesText, '1... e5 2. Nf3');
    });

    test('is empty before any move', () {
      expect(ChessGame().movesText, '');
    });
  });

  group('movesFrom', () {
    test('lists only the moves of the piece on that square', () {
      final game = ChessGame();
      final knight = game.movesFrom(parseSquare('g1')!);
      expect(
        knight.map((move) => squareName(move.to)).toSet(),
        {'f3', 'h3'},
      );
      expect(game.movesFrom(parseSquare('e4')!), isEmpty);
    });
  });
}

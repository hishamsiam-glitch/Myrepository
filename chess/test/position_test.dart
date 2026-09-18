import 'package:chess/chess/move.dart';
import 'package:chess/chess/pieces.dart';
import 'package:chess/chess/position.dart';
import 'package:flutter_test/flutter_test.dart';

/// Counts leaf nodes of the legal move tree. `perft` is the standard way to
/// prove a move generator correct: the numbers below are the published values
/// for these positions, so any rules bug (castling, en passant, pinned
/// pieces, promotion) shows up as a mismatch.
int perft(Position position, int depth) {
  if (depth == 0) return 1;
  final moves = position.legalMoves();
  if (depth == 1) return moves.length;
  var total = 0;
  for (final move in moves) {
    total += perft(position.applyMove(move), depth - 1);
  }
  return total;
}

void main() {
  group('square helpers', () {
    test('index layout puts a1 at 0 and h8 at 63', () {
      expect(squareOf(0, 0), 0);
      expect(squareName(0), 'a1');
      expect(squareName(63), 'h8');
      expect(parseSquare('e4'), squareOf(4, 3));
      expect(parseSquare('x9'), isNull);
      expect(parseSquare('e'), isNull);
    });
  });

  group('FEN', () {
    test('round-trips the starting position', () {
      expect(Position.initial().fen, Position.startingFen);
    });

    test('round-trips a position with castling and en passant', () {
      const fen =
          'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
      expect(Position.fromFen(fen).fen, fen);
    });

    test('round-trips an en-passant target', () {
      const fen = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3';
      final position = Position.fromFen(fen);
      expect(position.enPassantSquare, parseSquare('e3'));
      expect(position.fen, fen);
    });

    test('rejects malformed input', () {
      expect(() => Position.fromFen('not a fen'), throwsFormatException);
      expect(
        () => Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1'),
        throwsFormatException,
      );
      expect(
        () => Position.fromFen(
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
        ),
        throwsFormatException,
      );
    });

    test('reads the board back piece by piece', () {
      final position = Position.initial();
      expect(position.pieceAt(0), const Piece(PieceColor.white, PieceType.rook));
      expect(
        position.pieceAt(parseSquare('e1')!),
        const Piece(PieceColor.white, PieceType.king),
      );
      expect(
        position.pieceAt(parseSquare('d8')!),
        const Piece(PieceColor.black, PieceType.queen),
      );
      expect(position.pieceAt(parseSquare('e4')!), isNull);
    });
  });

  group('perft', () {
    test('starting position', () {
      final start = Position.initial();
      expect(perft(start, 1), 20);
      expect(perft(start, 2), 400);
      expect(perft(start, 3), 8902);
    });

    test('kiwipete (castling, pins and en passant all at once)', () {
      final position = Position.fromFen(
        'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      );
      expect(perft(position, 1), 48);
      expect(perft(position, 2), 2039);
      expect(perft(position, 3), 97862);
    });

    test('endgame position with an en-passant discovery', () {
      final position =
          Position.fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
      expect(perft(position, 1), 14);
      expect(perft(position, 2), 191);
      expect(perft(position, 3), 2812);
      expect(perft(position, 4), 43238);
    });

    test('promotion-heavy position', () {
      final position = Position.fromFen(
        'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
      );
      expect(perft(position, 1), 6);
      expect(perft(position, 2), 264);
      expect(perft(position, 3), 9467);
    });

    test('position 5', () {
      final position = Position.fromFen(
        'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
      );
      expect(perft(position, 1), 44);
      expect(perft(position, 2), 1486);
      expect(perft(position, 3), 62379);
    });
  });

  group('castling', () {
    test('white castles both ways and the rook comes with it', () {
      final position =
          Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
      final kingSide = Move(parseSquare('e1')!, parseSquare('g1')!);
      expect(position.legalMoves(), contains(kingSide));
      expect(position.isCastling(kingSide), isTrue);

      final after = position.applyMove(kingSide);
      expect(
        after.pieceAt(parseSquare('g1')!),
        const Piece(PieceColor.white, PieceType.king),
      );
      expect(
        after.pieceAt(parseSquare('f1')!),
        const Piece(PieceColor.white, PieceType.rook),
      );
      expect(after.pieceAt(parseSquare('h1')!), isNull);
      // Both white rights are gone once the king has moved.
      expect(after.castlingRights & castleWhiteKing, 0);
      expect(after.castlingRights & castleWhiteQueen, 0);

      final queenSide = Move(parseSquare('e1')!, parseSquare('c1')!);
      final afterQueenSide = position.applyMove(queenSide);
      expect(
        afterQueenSide.pieceAt(parseSquare('d1')!),
        const Piece(PieceColor.white, PieceType.rook),
      );
      expect(afterQueenSide.pieceAt(parseSquare('a1')!), isNull);
    });

    test('cannot castle out of check', () {
      final position =
          Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
      final inCheck = Position.fromFen('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1');
      expect(
        position.legalMoves(),
        contains(Move(parseSquare('e1')!, parseSquare('g1')!)),
      );
      expect(inCheck.isCheck, isTrue);
      expect(
        inCheck.legalMoves(),
        isNot(contains(Move(parseSquare('e1')!, parseSquare('g1')!))),
      );
    });

    test('cannot castle through an attacked square', () {
      // A black rook on f8 covers f1, the square the king would cross.
      final position =
          Position.fromFen('r4rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
      expect(
        position.legalMoves(),
        isNot(contains(Move(parseSquare('e1')!, parseSquare('g1')!))),
      );
      expect(
        position.legalMoves(),
        contains(Move(parseSquare('e1')!, parseSquare('c1')!)),
      );
    });

    test('moving a rook forfeits that side only', () {
      final position =
          Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
      final after =
          position.applyMove(Move(parseSquare('h1')!, parseSquare('h5')!));
      expect(after.castlingRights & castleWhiteKing, 0);
      expect(after.castlingRights & castleWhiteQueen, isNot(0));
    });

    test('capturing a rook on its corner forfeits that right', () {
      final position =
          Position.fromFen('r3k2r/8/8/8/8/8/8/R3K1bR b KQkq - 0 1');
      final after =
          position.applyMove(Move(parseSquare('g1')!, parseSquare('h2')!));
      expect(after.castlingRights & castleWhiteKing, isNot(0));
      final capture =
          Position.fromFen('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1')
              .applyMove(Move(parseSquare('g2')!, parseSquare('h1')!));
      expect(capture.castlingRights & castleWhiteKing, 0);
      expect(capture.castlingRights & castleWhiteQueen, isNot(0));
    });
  });

  group('en passant', () {
    test('a double pawn push sets the target square', () {
      final after = Position.initial()
          .applyMove(Move(parseSquare('e2')!, parseSquare('e4')!));
      expect(after.enPassantSquare, parseSquare('e3'));
    });

    test('capturing en passant removes the pawn beside the target', () {
      final position = Position.fromFen(
        'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
      );
      final move = Move(parseSquare('e5')!, parseSquare('d6')!);
      expect(position.isEnPassant(move), isTrue);
      expect(position.isCapture(move), isTrue);
      final after = position.applyMove(move);
      expect(after.pieceAt(parseSquare('d5')!), isNull);
      expect(
        after.pieceAt(parseSquare('d6')!),
        const Piece(PieceColor.white, PieceType.pawn),
      );
    });

    test('the target expires after one move', () {
      final afterPush = Position.initial()
          .applyMove(Move(parseSquare('e2')!, parseSquare('e4')!));
      expect(afterPush.enPassantSquare, parseSquare('e3'));
      final afterReply =
          afterPush.applyMove(Move(parseSquare('a7')!, parseSquare('a6')!));
      expect(afterReply.enPassantSquare, isNull);
    });

    test('en passant that would expose the king is illegal', () {
      // Taking on c6 would clear both b5 and c5, opening the fifth rank from
      // the rook on h5 to White's king on a5. Both pawns leave the rank at
      // once, which is the case a naive legality check misses.
      final position =
          Position.fromFen('7k/8/8/KPp4r/8/8/8/8 w - c6 0 1');
      final capture = Move(parseSquare('b5')!, parseSquare('c6')!);
      expect(position.isEnPassant(capture), isTrue);
      expect(position.legalMoves(), isNot(contains(capture)));
      // The same pawn pushing straight ahead is fine.
      expect(
        position.legalMoves(),
        contains(Move(parseSquare('b5')!, parseSquare('b6')!)),
      );
    });
  });

  group('promotion', () {
    test('a pawn reaching the last rank offers four pieces', () {
      final position = Position.fromFen('8/4P3/8/8/8/8/8/K6k w - - 0 1');
      final promotions = position
          .legalMoves()
          .where((move) => move.from == parseSquare('e7'))
          .toList();
      expect(promotions.length, 4);
      expect(
        promotions.map((move) => move.promotion).toSet(),
        {PieceType.queen, PieceType.rook, PieceType.bishop, PieceType.knight},
      );
      final after = position.applyMove(
        Move(parseSquare('e7')!, parseSquare('e8')!, promotion: PieceType.knight),
      );
      expect(
        after.pieceAt(parseSquare('e8')!),
        const Piece(PieceColor.white, PieceType.knight),
      );
    });

    test('UCI notation round-trips the promotion piece', () {
      final move = Move(
        parseSquare('e7')!,
        parseSquare('e8')!,
        promotion: PieceType.queen,
      );
      expect(move.uci, 'e7e8q');
      expect(Move.tryParseUci('e7e8q'), move);
      expect(Move.tryParseUci('e2e4'), Move(parseSquare('e2')!, parseSquare('e4')!));
      expect(Move.tryParseUci('e2e'), isNull);
      expect(Move.tryParseUci('e2e4x'), isNull);
      expect(Move.tryParseUci('z9z9'), isNull);
    });
  });

  group('checks and mates', () {
    test('a pinned piece cannot move off the pin line', () {
      // The white knight on e2 is pinned by the rook on e8.
      final position = Position.fromFen('4r3/8/8/8/8/8/4N3/4K3 w - - 0 1');
      final knightMoves = position
          .legalMoves()
          .where((move) => move.from == parseSquare('e2'))
          .toList();
      expect(knightMoves, isEmpty);
    });

    test('detects back-rank mate', () {
      final position = Position.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
      final mate = Move(parseSquare('a1')!, parseSquare('a8')!);
      final after = position.applyMove(mate);
      expect(after.isCheck, isTrue);
      expect(after.legalMoves(), isEmpty);
      expect(position.sanFor(mate), 'Ra8#');
    });

    test('detects stalemate', () {
      final position = Position.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
      expect(position.isCheck, isFalse);
      expect(position.legalMoves(), isEmpty);
    });

    test('insufficient material covers bare and single-minor endings', () {
      expect(
        Position.fromFen('8/8/4k3/8/8/4K3/8/8 w - - 0 1').isInsufficientMaterial,
        isTrue,
      );
      expect(
        Position.fromFen('8/8/4k3/8/8/4K1N1/8/8 w - - 0 1')
            .isInsufficientMaterial,
        isTrue,
      );
      expect(
        Position.fromFen('8/8/4k3/8/8/4K1R1/8/8 w - - 0 1')
            .isInsufficientMaterial,
        isFalse,
      );
      expect(
        Position.fromFen('8/8/4k3/8/8/4K1P1/8/8 w - - 0 1')
            .isInsufficientMaterial,
        isFalse,
      );
    });
  });

  group('SAN', () {
    test('writes ordinary moves, captures and castling', () {
      final start = Position.initial();
      expect(start.sanFor(Move(parseSquare('e2')!, parseSquare('e4')!)), 'e4');
      expect(start.sanFor(Move(parseSquare('g1')!, parseSquare('f3')!)), 'Nf3');

      final castle =
          Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
      expect(
        castle.sanFor(Move(parseSquare('e1')!, parseSquare('g1')!)),
        'O-O',
      );
      expect(
        castle.sanFor(Move(parseSquare('e1')!, parseSquare('c1')!)),
        'O-O-O',
      );
    });

    test('disambiguates two knights reaching the same square', () {
      final position = Position.fromFen('4k3/8/8/8/8/8/8/K1N1N3 w - - 0 1');
      expect(
        position.sanFor(Move(parseSquare('c1')!, parseSquare('d3')!)),
        'Ncd3',
      );
      expect(
        position.sanFor(Move(parseSquare('e1')!, parseSquare('d3')!)),
        'Ned3',
      );
    });

    test('disambiguates by rank when the file is shared', () {
      final position = Position.fromFen('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
      expect(
        position.sanFor(Move(parseSquare('a1')!, parseSquare('a3')!)),
        'R1a3',
      );
      expect(
        position.sanFor(Move(parseSquare('a5')!, parseSquare('a3')!)),
        'R5a3',
      );
    });

    test('writes pawn captures with the origin file and marks checks', () {
      final position = Position.fromFen(
        'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
      );
      expect(
        position.sanFor(Move(parseSquare('e4')!, parseSquare('d5')!)),
        'exd5',
      );

      final check = Position.fromFen('4k3/8/8/8/8/8/8/4KQ2 w - - 0 1');
      expect(
        check.sanFor(Move(parseSquare('f1')!, parseSquare('f7')!)),
        'Qf7+',
      );
    });

    test('writes promotions, including capturing promotions', () {
      final position = Position.fromFen('3r1k2/4P3/8/8/8/8/8/4K3 w - - 0 1');
      expect(
        position.sanFor(
          Move(parseSquare('e7')!, parseSquare('e8')!,
              promotion: PieceType.queen),
        ),
        'e8=Q+',
      );
      expect(
        position.sanFor(
          Move(parseSquare('e7')!, parseSquare('d8')!,
              promotion: PieceType.knight),
        ),
        'exd8=N',
      );
    });

    test('resolves SAN back into a move', () {
      final start = Position.initial();
      expect(
        start.moveFromSan('e4'),
        Move(parseSquare('e2')!, parseSquare('e4')!),
      );
      expect(
        start.moveFromSan('Nf3'),
        Move(parseSquare('g1')!, parseSquare('f3')!),
      );
      expect(start.moveFromSan('Qh5'), isNull);
    });
  });

  group('clocks', () {
    test('the halfmove clock resets on a pawn move or capture', () {
      final quiet = Position.fromFen('4k3/8/8/8/8/8/8/4K1N1 w - - 7 20')
          .applyMove(Move(parseSquare('g1')!, parseSquare('f3')!));
      expect(quiet.halfmoveClock, 8);

      final pawn = Position.fromFen('4k3/8/8/8/8/8/6P1/4K3 w - - 7 20')
          .applyMove(Move(parseSquare('g2')!, parseSquare('g3')!));
      expect(pawn.halfmoveClock, 0);
    });

    test('the fullmove number advances after Black moves', () {
      final afterWhite = Position.initial()
          .applyMove(Move(parseSquare('e2')!, parseSquare('e4')!));
      expect(afterWhite.fullmoveNumber, 1);
      final afterBlack =
          afterWhite.applyMove(Move(parseSquare('e7')!, parseSquare('e5')!));
      expect(afterBlack.fullmoveNumber, 2);
    });

    test('the repetition key ignores the clocks', () {
      final a = Position.fromFen(
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      );
      final b = Position.fromFen(
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 9 40',
      );
      expect(a.repetitionKey, b.repetitionKey);
      expect(
        a.repetitionKey,
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      );
    });
  });
}

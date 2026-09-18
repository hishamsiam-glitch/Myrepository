import 'dart:typed_data';

import 'move.dart';
import 'pieces.dart';

/// Castling-right bit flags.
const int castleWhiteKing = 1;
const int castleWhiteQueen = 2;
const int castleBlackKing = 4;
const int castleBlackQueen = 8;

const List<List<int>> _knightDeltas = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const List<List<int>> _bishopDeltas = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const List<List<int>> _rookDeltas = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const List<List<int>> _kingDeltas = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/// An immutable chess position: the board, whose turn it is, castling rights,
/// the en-passant target square and the move clocks.
///
/// Playing a move produces a brand new [Position] ([applyMove]), which keeps
/// the search in [lib/engine/search.dart] free of make/unmake bookkeeping and
/// makes undo in the UI a matter of dropping the last position.
class Position {
  Position._(
    this._squares,
    this.turn,
    this.castlingRights,
    this.enPassantSquare,
    this.halfmoveClock,
    this.fullmoveNumber,
  );

  /// The standard starting position.
  factory Position.initial() =>
      Position.fromFen(startingFen);

  /// Parses a FEN string. Throws [FormatException] on anything malformed, so
  /// callers loading saved games can fall back to a fresh board.
  factory Position.fromFen(String fen) {
    final fields = fen.trim().split(RegExp(r'\s+'));
    if (fields.length < 4) {
      throw FormatException('FEN needs at least 4 fields', fen);
    }

    final squares = Uint8List(64);
    final ranks = fields[0].split('/');
    if (ranks.length != 8) {
      throw FormatException('FEN board must have 8 ranks', fen);
    }
    for (var i = 0; i < 8; i++) {
      // FEN lists rank 8 first, but square indices start at rank 1.
      final rank = 7 - i;
      var file = 0;
      for (final ch in ranks[i].split('')) {
        final digit = int.tryParse(ch);
        if (digit != null) {
          file += digit;
          continue;
        }
        final type = PieceType.fromLetter(ch);
        if (type == null || file > 7) {
          throw FormatException('Bad FEN rank "${ranks[i]}"', fen);
        }
        final color = ch.toUpperCase() == ch
            ? PieceColor.white
            : PieceColor.black;
        squares[squareOf(file, rank)] = _encode(color, type);
        file++;
      }
      if (file != 8) {
        throw FormatException('FEN rank "${ranks[i]}" is not 8 squares', fen);
      }
    }

    final turn = switch (fields[1]) {
      'w' => PieceColor.white,
      'b' => PieceColor.black,
      _ => throw FormatException('Bad FEN side to move "${fields[1]}"', fen),
    };

    var rights = 0;
    if (fields[2] != '-') {
      for (final ch in fields[2].split('')) {
        switch (ch) {
          case 'K':
            rights |= castleWhiteKing;
          case 'Q':
            rights |= castleWhiteQueen;
          case 'k':
            rights |= castleBlackKing;
          case 'q':
            rights |= castleBlackQueen;
          default:
            throw FormatException('Bad FEN castling "${fields[2]}"', fen);
        }
      }
    }

    int? ep;
    if (fields[3] != '-') {
      ep = parseSquare(fields[3]);
      if (ep == null) {
        throw FormatException('Bad FEN en passant "${fields[3]}"', fen);
      }
    }

    final halfmove = fields.length > 4 ? int.tryParse(fields[4]) ?? 0 : 0;
    final fullmove = fields.length > 5 ? int.tryParse(fields[5]) ?? 1 : 1;

    return Position._(squares, turn, rights, ep, halfmove, fullmove);
  }

  static const String startingFen =
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  final Uint8List _squares;

  /// Side to move.
  final PieceColor turn;

  /// Bitmask of [castleWhiteKing] and friends.
  final int castlingRights;

  /// The square a pawn could capture onto en passant, or null.
  final int? enPassantSquare;

  /// Plies since the last capture or pawn move (the fifty-move rule counter).
  final int halfmoveClock;

  final int fullmoveNumber;

  static int _encode(PieceColor color, PieceType type) =>
      (color == PieceColor.white ? 0 : 6) + type.index + 1;

  Piece? pieceAt(int square) {
    final code = _squares[square];
    if (code == 0) return null;
    final index = code - 1;
    return Piece(
      index < 6 ? PieceColor.white : PieceColor.black,
      PieceType.values[index % 6],
    );
  }

  /// FEN for this position, including both clocks.
  String get fen {
    final board = StringBuffer();
    for (var i = 0; i < 8; i++) {
      final rank = 7 - i;
      var gap = 0;
      for (var file = 0; file < 8; file++) {
        final piece = pieceAt(squareOf(file, rank));
        if (piece == null) {
          gap++;
          continue;
        }
        if (gap > 0) {
          board.write(gap);
          gap = 0;
        }
        board.write(piece.fenChar);
      }
      if (gap > 0) board.write(gap);
      if (rank > 0) board.write('/');
    }

    final rights = StringBuffer();
    if (castlingRights & castleWhiteKing != 0) rights.write('K');
    if (castlingRights & castleWhiteQueen != 0) rights.write('Q');
    if (castlingRights & castleBlackKing != 0) rights.write('k');
    if (castlingRights & castleBlackQueen != 0) rights.write('q');

    return '$board '
        '${turn == PieceColor.white ? 'w' : 'b'} '
        '${rights.isEmpty ? '-' : rights} '
        '${enPassantSquare == null ? '-' : squareName(enPassantSquare!)} '
        '$halfmoveClock $fullmoveNumber';
  }

  /// Everything that defines a repetition: the board, the side to move,
  /// castling rights and the en-passant square, but not the clocks.
  String get repetitionKey {
    final full = fen;
    return full.substring(0, full.lastIndexOf(' ', full.lastIndexOf(' ') - 1));
  }

  int? _kingSquare(PieceColor color) {
    final code = _encode(color, PieceType.king);
    for (var square = 0; square < 64; square++) {
      if (_squares[square] == code) return square;
    }
    return null;
  }

  /// Whether [square] is attacked by any piece of colour [by]. Used for both
  /// check detection and for the squares a king passes over when castling.
  bool isAttackedBy(int square, PieceColor by) {
    final file = fileOf(square);
    final rank = rankOf(square);

    // Pawns attack diagonally forward, so look diagonally *backward* from the
    // target square to find them.
    final pawnRank = by == PieceColor.white ? rank - 1 : rank + 1;
    final pawnCode = _encode(by, PieceType.pawn);
    for (final df in const [-1, 1]) {
      if (onBoard(file + df, pawnRank) &&
          _squares[squareOf(file + df, pawnRank)] == pawnCode) {
        return true;
      }
    }

    if (_anyAt(file, rank, _knightDeltas, _encode(by, PieceType.knight))) {
      return true;
    }
    if (_anyAt(file, rank, _kingDeltas, _encode(by, PieceType.king))) {
      return true;
    }

    final queen = _encode(by, PieceType.queen);
    if (_slidingHits(file, rank, _bishopDeltas, _encode(by, PieceType.bishop),
        queen)) {
      return true;
    }
    if (_slidingHits(file, rank, _rookDeltas, _encode(by, PieceType.rook),
        queen)) {
      return true;
    }
    return false;
  }

  bool _anyAt(int file, int rank, List<List<int>> deltas, int code) {
    for (final delta in deltas) {
      final f = file + delta[0];
      final r = rank + delta[1];
      if (onBoard(f, r) && _squares[squareOf(f, r)] == code) return true;
    }
    return false;
  }

  bool _slidingHits(
    int file,
    int rank,
    List<List<int>> deltas,
    int code,
    int queenCode,
  ) {
    for (final delta in deltas) {
      var f = file + delta[0];
      var r = rank + delta[1];
      while (onBoard(f, r)) {
        final occupant = _squares[squareOf(f, r)];
        if (occupant != 0) {
          if (occupant == code || occupant == queenCode) return true;
          break;
        }
        f += delta[0];
        r += delta[1];
      }
    }
    return false;
  }

  /// Whether the side to move is in check.
  bool get isCheck {
    final king = _kingSquare(turn);
    return king != null && isAttackedBy(king, turn.opponent);
  }

  /// Moves that are legal in the strict sense: pseudo-legal moves that do not
  /// leave one's own king attacked.
  List<Move> legalMoves() {
    final result = <Move>[];
    for (final move in _pseudoLegalMoves()) {
      if (!applyMove(move)._leavesKingAttacked(turn)) result.add(move);
    }
    return result;
  }

  /// Captures and promotions only — the quiescence-search move list.
  List<Move> legalCapturesAndPromotions() {
    final result = <Move>[];
    for (final move in _pseudoLegalMoves()) {
      if (!isCapture(move) && move.promotion == null) continue;
      if (!applyMove(move)._leavesKingAttacked(turn)) result.add(move);
    }
    return result;
  }

  bool _leavesKingAttacked(PieceColor color) {
    final king = _kingSquare(color);
    return king != null && isAttackedBy(king, color.opponent);
  }

  List<Move> _pseudoLegalMoves() {
    final moves = <Move>[];
    for (var square = 0; square < 64; square++) {
      final piece = pieceAt(square);
      if (piece == null || piece.color != turn) continue;
      switch (piece.type) {
        case PieceType.pawn:
          _pawnMoves(square, moves);
        case PieceType.knight:
          _stepMoves(square, _knightDeltas, moves);
        case PieceType.bishop:
          _slideMoves(square, _bishopDeltas, moves);
        case PieceType.rook:
          _slideMoves(square, _rookDeltas, moves);
        case PieceType.queen:
          _slideMoves(square, _kingDeltas, moves);
        case PieceType.king:
          _stepMoves(square, _kingDeltas, moves);
          _castlingMoves(square, moves);
      }
    }
    return moves;
  }

  void _pawnMoves(int from, List<Move> moves) {
    final file = fileOf(from);
    final rank = rankOf(from);
    final forward = turn == PieceColor.white ? 1 : -1;
    final startRank = turn == PieceColor.white ? 1 : 6;
    final promotionRank = turn == PieceColor.white ? 7 : 0;

    void add(int to) {
      if (rankOf(to) == promotionRank) {
        for (final type in const [
          PieceType.queen,
          PieceType.rook,
          PieceType.bishop,
          PieceType.knight,
        ]) {
          moves.add(Move(from, to, promotion: type));
        }
      } else {
        moves.add(Move(from, to));
      }
    }

    final oneUp = rank + forward;
    if (onBoard(file, oneUp) && _squares[squareOf(file, oneUp)] == 0) {
      add(squareOf(file, oneUp));
      final twoUp = rank + 2 * forward;
      if (rank == startRank && _squares[squareOf(file, twoUp)] == 0) {
        moves.add(Move(from, squareOf(file, twoUp)));
      }
    }

    for (final df in const [-1, 1]) {
      final f = file + df;
      if (!onBoard(f, oneUp)) continue;
      final to = squareOf(f, oneUp);
      final target = pieceAt(to);
      if (target != null && target.color != turn) {
        add(to);
      } else if (target == null && to == enPassantSquare) {
        moves.add(Move(from, to));
      }
    }
  }

  void _stepMoves(int from, List<List<int>> deltas, List<Move> moves) {
    final file = fileOf(from);
    final rank = rankOf(from);
    for (final delta in deltas) {
      final f = file + delta[0];
      final r = rank + delta[1];
      if (!onBoard(f, r)) continue;
      final to = squareOf(f, r);
      final target = pieceAt(to);
      if (target == null || target.color != turn) moves.add(Move(from, to));
    }
  }

  void _slideMoves(int from, List<List<int>> deltas, List<Move> moves) {
    final file = fileOf(from);
    final rank = rankOf(from);
    for (final delta in deltas) {
      var f = file + delta[0];
      var r = rank + delta[1];
      while (onBoard(f, r)) {
        final to = squareOf(f, r);
        final target = pieceAt(to);
        if (target == null) {
          moves.add(Move(from, to));
        } else {
          if (target.color != turn) moves.add(Move(from, to));
          break;
        }
        f += delta[0];
        r += delta[1];
      }
    }
  }

  void _castlingMoves(int kingSquare, List<Move> moves) {
    final homeRank = turn == PieceColor.white ? 0 : 7;
    if (kingSquare != squareOf(4, homeRank)) return;
    // Castling out of check is illegal, and so is passing through an attacked
    // square; the destination square is covered by the normal legality filter.
    if (isAttackedBy(kingSquare, turn.opponent)) return;

    final kingSide = turn == PieceColor.white
        ? castleWhiteKing
        : castleBlackKing;
    final queenSide = turn == PieceColor.white
        ? castleWhiteQueen
        : castleBlackQueen;

    if (castlingRights & kingSide != 0 &&
        _squares[squareOf(5, homeRank)] == 0 &&
        _squares[squareOf(6, homeRank)] == 0 &&
        !isAttackedBy(squareOf(5, homeRank), turn.opponent)) {
      moves.add(Move(kingSquare, squareOf(6, homeRank)));
    }
    if (castlingRights & queenSide != 0 &&
        _squares[squareOf(3, homeRank)] == 0 &&
        _squares[squareOf(2, homeRank)] == 0 &&
        _squares[squareOf(1, homeRank)] == 0 &&
        !isAttackedBy(squareOf(3, homeRank), turn.opponent)) {
      moves.add(Move(kingSquare, squareOf(2, homeRank)));
    }
  }

  /// Whether [move] moves the king two files, i.e. is a castling move.
  bool isCastling(Move move) =>
      pieceAt(move.from)?.type == PieceType.king &&
      (fileOf(move.to) - fileOf(move.from)).abs() == 2;

  /// Whether [move] captures a pawn en passant.
  bool isEnPassant(Move move) =>
      pieceAt(move.from)?.type == PieceType.pawn &&
      move.to == enPassantSquare &&
      _squares[move.to] == 0;

  bool isCapture(Move move) => _squares[move.to] != 0 || isEnPassant(move);

  /// Returns the position after [move]. The move is assumed to come from
  /// [legalMoves] (or to at least be pseudo-legal for this position).
  Position applyMove(Move move) {
    final squares = Uint8List.fromList(_squares);
    final moving = pieceAt(move.from);
    if (moving == null) {
      throw ArgumentError('No piece on ${squareName(move.from)}');
    }

    final captured = pieceAt(move.to);
    final enPassant = isEnPassant(move);

    squares[move.from] = 0;
    squares[move.to] = move.promotion == null
        ? _encode(moving.color, moving.type)
        : _encode(moving.color, move.promotion!);

    if (enPassant) {
      // The captured pawn sits beside the destination square, not on it.
      final capturedRank =
          rankOf(move.to) + (moving.color == PieceColor.white ? -1 : 1);
      squares[squareOf(fileOf(move.to), capturedRank)] = 0;
    }

    if (isCastling(move)) {
      final homeRank = rankOf(move.from);
      final kingSide = fileOf(move.to) == 6;
      final rookFrom = squareOf(kingSide ? 7 : 0, homeRank);
      final rookTo = squareOf(kingSide ? 5 : 3, homeRank);
      squares[rookTo] = squares[rookFrom];
      squares[rookFrom] = 0;
    }

    var rights = castlingRights;
    if (moving.type == PieceType.king) {
      rights &= moving.color == PieceColor.white
          ? ~(castleWhiteKing | castleWhiteQueen)
          : ~(castleBlackKing | castleBlackQueen);
    }
    // A rook leaving — or being captured on — a corner kills that right.
    rights &= ~_rightsForCorner(move.from);
    rights &= ~_rightsForCorner(move.to);

    int? nextEnPassant;
    if (moving.type == PieceType.pawn &&
        (rankOf(move.to) - rankOf(move.from)).abs() == 2) {
      nextEnPassant = squareOf(
        fileOf(move.from),
        (rankOf(move.from) + rankOf(move.to)) ~/ 2,
      );
    }

    final resetsClock =
        moving.type == PieceType.pawn || captured != null || enPassant;

    return Position._(
      squares,
      turn.opponent,
      rights,
      nextEnPassant,
      resetsClock ? 0 : halfmoveClock + 1,
      turn == PieceColor.black ? fullmoveNumber + 1 : fullmoveNumber,
    );
  }

  static int _rightsForCorner(int square) => switch (square) {
        0 => castleWhiteQueen,
        7 => castleWhiteKing,
        56 => castleBlackQueen,
        63 => castleBlackKing,
        _ => 0,
      };

  /// Neither side has enough material left to force a mate.
  bool get isInsufficientMaterial {
    final minors = <PieceType>[];
    for (var square = 0; square < 64; square++) {
      final piece = pieceAt(square);
      if (piece == null || piece.type == PieceType.king) continue;
      if (piece.type == PieceType.pawn ||
          piece.type == PieceType.rook ||
          piece.type == PieceType.queen) {
        return false;
      }
      minors.add(piece.type);
      if (minors.length > 1) return false;
    }
    // Bare kings, or a lone knight/bishop against a bare king.
    return true;
  }

  /// Standard algebraic notation for [move], including `+`/`#`. [legal] can be
  /// passed in when the caller already has the move list, to avoid
  /// regenerating it for disambiguation.
  String sanFor(Move move, {List<Move>? legal}) {
    final moving = pieceAt(move.from);
    if (moving == null) {
      throw ArgumentError('No piece on ${squareName(move.from)}');
    }
    final moves = legal ?? legalMoves();
    final buffer = StringBuffer();

    if (isCastling(move)) {
      buffer.write(fileOf(move.to) == 6 ? 'O-O' : 'O-O-O');
    } else if (moving.type == PieceType.pawn) {
      if (isCapture(move)) {
        buffer.write(String.fromCharCode(97 + fileOf(move.from)));
        buffer.write('x');
      }
      buffer.write(squareName(move.to));
      if (move.promotion != null) buffer.write('=${move.promotion!.letter}');
    } else {
      buffer.write(moving.type.letter);
      // Disambiguate against other same-type pieces reaching the same square:
      // by file if that is unique, else by rank, else by both.
      final rivals = moves
          .where((m) =>
              m.to == move.to &&
              m.from != move.from &&
              pieceAt(m.from)?.type == moving.type)
          .toList();
      if (rivals.isNotEmpty) {
        final sameFile =
            rivals.any((m) => fileOf(m.from) == fileOf(move.from));
        final sameRank =
            rivals.any((m) => rankOf(m.from) == rankOf(move.from));
        if (!sameFile) {
          buffer.write(String.fromCharCode(97 + fileOf(move.from)));
        } else if (!sameRank) {
          buffer.write(rankOf(move.from) + 1);
        } else {
          buffer.write(squareName(move.from));
        }
      }
      if (isCapture(move)) buffer.write('x');
      buffer.write(squareName(move.to));
    }

    final after = applyMove(move);
    if (after.isCheck) {
      buffer.write(after.legalMoves().isEmpty ? '#' : '+');
    }
    return buffer.toString();
  }

  /// Resolves a SAN string against this position. Returns null if no legal
  /// move matches, which keeps PGN-ish input handling non-throwing.
  Move? moveFromSan(String san) {
    final cleaned = san.replaceAll(RegExp(r'[+#!?]'), '').trim();
    final moves = legalMoves();
    for (final move in moves) {
      if (sanFor(move, legal: moves).replaceAll(RegExp(r'[+#]'), '') ==
          cleaned) {
        return move;
      }
    }
    return null;
  }
}

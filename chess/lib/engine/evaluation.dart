import '../chess/pieces.dart';
import '../chess/position.dart';

/// Centipawn values. The king is scored by the piece-square tables only —
/// mate is handled by the search, not by the evaluation.
const List<int> pieceValues = [100, 320, 330, 500, 900, 0];

/// Piece-square tables, written the way a board is drawn (a8 first, h1 last)
/// so they can be read at a glance, and indexed through [_pst].
const List<int> _pawnTable = [
  0, 0, 0, 0, 0, 0, 0, 0, //
  50, 50, 50, 50, 50, 50, 50, 50, //
  10, 10, 20, 30, 30, 20, 10, 10, //
  5, 5, 10, 25, 25, 10, 5, 5, //
  0, 0, 0, 20, 20, 0, 0, 0, //
  5, -5, -10, 0, 0, -10, -5, 5, //
  5, 10, 10, -20, -20, 10, 10, 5, //
  0, 0, 0, 0, 0, 0, 0, 0, //
];

const List<int> _knightTable = [
  -50, -40, -30, -30, -30, -30, -40, -50, //
  -40, -20, 0, 0, 0, 0, -20, -40, //
  -30, 0, 10, 15, 15, 10, 0, -30, //
  -30, 5, 15, 20, 20, 15, 5, -30, //
  -30, 0, 15, 20, 20, 15, 0, -30, //
  -30, 5, 10, 15, 15, 10, 5, -30, //
  -40, -20, 0, 5, 5, 0, -20, -40, //
  -50, -40, -30, -30, -30, -30, -40, -50, //
];

const List<int> _bishopTable = [
  -20, -10, -10, -10, -10, -10, -10, -20, //
  -10, 0, 0, 0, 0, 0, 0, -10, //
  -10, 0, 5, 10, 10, 5, 0, -10, //
  -10, 5, 5, 10, 10, 5, 5, -10, //
  -10, 0, 10, 10, 10, 10, 0, -10, //
  -10, 10, 10, 10, 10, 10, 10, -10, //
  -10, 5, 0, 0, 0, 0, 5, -10, //
  -20, -10, -10, -10, -10, -10, -10, -20, //
];

const List<int> _rookTable = [
  0, 0, 0, 0, 0, 0, 0, 0, //
  5, 10, 10, 10, 10, 10, 10, 5, //
  -5, 0, 0, 0, 0, 0, 0, -5, //
  -5, 0, 0, 0, 0, 0, 0, -5, //
  -5, 0, 0, 0, 0, 0, 0, -5, //
  -5, 0, 0, 0, 0, 0, 0, -5, //
  -5, 0, 0, 0, 0, 0, 0, -5, //
  0, 0, 0, 5, 5, 0, 0, 0, //
];

const List<int> _queenTable = [
  -20, -10, -10, -5, -5, -10, -10, -20, //
  -10, 0, 0, 0, 0, 0, 0, -10, //
  -10, 0, 5, 5, 5, 5, 0, -10, //
  -5, 0, 5, 5, 5, 5, 0, -5, //
  0, 0, 5, 5, 5, 5, 0, -5, //
  -10, 5, 5, 5, 5, 5, 0, -10, //
  -10, 0, 5, 0, 0, 0, 0, -10, //
  -20, -10, -10, -5, -5, -10, -10, -20, //
];

/// The king wants shelter in the middlegame...
const List<int> _kingMiddlegameTable = [
  -30, -40, -40, -50, -50, -40, -40, -30, //
  -30, -40, -40, -50, -50, -40, -40, -30, //
  -30, -40, -40, -50, -50, -40, -40, -30, //
  -30, -40, -40, -50, -50, -40, -40, -30, //
  -20, -30, -30, -40, -40, -30, -30, -20, //
  -10, -20, -20, -20, -20, -20, -20, -10, //
  20, 20, 0, 0, 0, 0, 20, 20, //
  20, 30, 10, 0, 0, 10, 30, 20, //
];

/// ...and activity once the queens and rooks are gone.
const List<int> _kingEndgameTable = [
  -50, -40, -30, -20, -20, -30, -40, -50, //
  -30, -20, -10, 0, 0, -10, -20, -30, //
  -30, -10, 20, 30, 30, 20, -10, -30, //
  -30, -10, 30, 40, 40, 30, -10, -30, //
  -30, -10, 30, 40, 40, 30, -10, -30, //
  -30, -10, 20, 30, 30, 20, -10, -30, //
  -30, -30, 0, 0, 0, 0, -30, -30, //
  -50, -30, -30, -30, -30, -30, -30, -50, //
];

/// Reads a board-order table for [square] as seen by [color]: White reads the
/// table mirrored vertically (its a1 is the table's bottom-left), Black reads
/// it straight.
int _pst(List<int> table, int square, PieceColor color) {
  final file = fileOf(square);
  final rank = rankOf(square);
  final row = color == PieceColor.white ? 7 - rank : rank;
  return table[row * 8 + file];
}

/// A rough "how far into the endgame are we" measure in 0..1, from the
/// non-pawn material still on the board. Used to blend the two king tables.
double _endgameWeight(List<int> nonPawnMaterial) {
  const openingMaterial = 2 * (320 + 330 + 500 + 900); // one side's pieces
  final remaining = nonPawnMaterial[0] + nonPawnMaterial[1];
  final weight = 1.0 - remaining / (2 * openingMaterial);
  return weight.clamp(0.0, 1.0);
}

/// Static evaluation in centipawns, from White's point of view (positive is
/// good for White).
int evaluate(Position position) {
  final material = [0, 0];
  final nonPawnMaterial = [0, 0];
  final positional = [0, 0];
  final bishops = [0, 0];
  final pawnsByFile = [List.filled(8, 0), List.filled(8, 0)];
  final kingSquares = <PieceColor, int>{};

  for (var square = 0; square < 64; square++) {
    final piece = position.pieceAt(square);
    if (piece == null) continue;
    final side = piece.color.index;

    if (piece.type != PieceType.king) {
      material[side] += pieceValues[piece.type.index];
      if (piece.type != PieceType.pawn) {
        nonPawnMaterial[side] += pieceValues[piece.type.index];
      }
    }

    switch (piece.type) {
      case PieceType.pawn:
        positional[side] += _pst(_pawnTable, square, piece.color);
        pawnsByFile[side][fileOf(square)]++;
      case PieceType.knight:
        positional[side] += _pst(_knightTable, square, piece.color);
      case PieceType.bishop:
        positional[side] += _pst(_bishopTable, square, piece.color);
        bishops[side]++;
      case PieceType.rook:
        positional[side] += _pst(_rookTable, square, piece.color);
      case PieceType.queen:
        positional[side] += _pst(_queenTable, square, piece.color);
      case PieceType.king:
        kingSquares[piece.color] = square;
    }
  }

  final endgame = _endgameWeight(nonPawnMaterial);
  for (final color in PieceColor.values) {
    final square = kingSquares[color];
    if (square == null) continue;
    final middle = _pst(_kingMiddlegameTable, square, color);
    final end = _pst(_kingEndgameTable, square, color);
    positional[color.index] +=
        (middle * (1 - endgame) + end * endgame).round();
  }

  var score = 0;
  for (final color in PieceColor.values) {
    final side = color.index;
    final sign = color == PieceColor.white ? 1 : -1;
    var own = material[side] + positional[side];

    // Two bishops cover both colour complexes, which is worth a little.
    if (bishops[side] >= 2) own += 30;

    for (var file = 0; file < 8; file++) {
      final count = pawnsByFile[side][file];
      if (count == 0) continue;
      // Doubled pawns.
      if (count > 1) own -= 12 * (count - 1);
      // Isolated pawns: no friendly pawn on either neighbouring file.
      final left = file > 0 ? pawnsByFile[side][file - 1] : 0;
      final right = file < 7 ? pawnsByFile[side][file + 1] : 0;
      if (left == 0 && right == 0) own -= 15;
    }

    score += sign * own;
  }

  return score;
}

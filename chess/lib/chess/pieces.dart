/// Core piece vocabulary shared by the rules engine, the AI and the UI.
library;

enum PieceColor {
  white,
  black;

  PieceColor get opponent =>
      this == PieceColor.white ? PieceColor.black : PieceColor.white;

  String get label => this == PieceColor.white ? 'White' : 'Black';
}

enum PieceType {
  pawn,
  knight,
  bishop,
  rook,
  queen,
  king;

  /// Single-letter code as used by FEN/SAN (uppercase; pawns have no SAN
  /// letter but keep 'P' for FEN).
  String get letter => const ['P', 'N', 'B', 'R', 'Q', 'K'][index];

  static PieceType? fromLetter(String letter) {
    switch (letter.toUpperCase()) {
      case 'P':
        return PieceType.pawn;
      case 'N':
        return PieceType.knight;
      case 'B':
        return PieceType.bishop;
      case 'R':
        return PieceType.rook;
      case 'Q':
        return PieceType.queen;
      case 'K':
        return PieceType.king;
    }
    return null;
  }
}

class Piece {
  const Piece(this.color, this.type);

  final PieceColor color;
  final PieceType type;

  /// FEN character: uppercase for white, lowercase for black.
  String get fenChar =>
      color == PieceColor.white ? type.letter : type.letter.toLowerCase();

  @override
  bool operator ==(Object other) =>
      other is Piece && other.color == color && other.type == type;

  @override
  int get hashCode => Object.hash(color, type);

  @override
  String toString() => fenChar;
}

/// Board squares are indexed 0..63 with `index = rank * 8 + file`, where
/// rank 0 is White's first rank and file 0 is the a-file. So 0 == a1 and
/// 63 == h8.
int squareOf(int file, int rank) => rank * 8 + file;

int fileOf(int square) => square & 7;

int rankOf(int square) => square >> 3;

bool onBoard(int file, int rank) =>
    file >= 0 && file < 8 && rank >= 0 && rank < 8;

String squareName(int square) =>
    '${String.fromCharCode(97 + fileOf(square))}${rankOf(square) + 1}';

/// Parses algebraic square names such as `e4`. Returns null when malformed.
int? parseSquare(String name) {
  if (name.length != 2) return null;
  final file = name.codeUnitAt(0) - 97;
  final rank = name.codeUnitAt(1) - 49;
  if (!onBoard(file, rank)) return null;
  return squareOf(file, rank);
}

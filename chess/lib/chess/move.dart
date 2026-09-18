import 'pieces.dart';

/// A move, identified only by where it starts, where it ends and what a pawn
/// promotes to. Everything else (captures, castling, en passant) is derived
/// from the [Position] the move is played in, so a [Move] is cheap to store
/// and cheap to serialise.
class Move {
  const Move(this.from, this.to, {this.promotion});

  final int from;
  final int to;
  final PieceType? promotion;

  /// Long algebraic ("UCI") notation, e.g. `e2e4` or `e7e8q`. This is what
  /// gets written to disk for saved games.
  String get uci =>
      '${squareName(from)}${squareName(to)}'
      '${promotion == null ? '' : promotion!.letter.toLowerCase()}';

  static Move? tryParseUci(String text) {
    if (text.length < 4 || text.length > 5) return null;
    final from = parseSquare(text.substring(0, 2));
    final to = parseSquare(text.substring(2, 4));
    if (from == null || to == null) return null;
    PieceType? promotion;
    if (text.length == 5) {
      promotion = PieceType.fromLetter(text[4]);
      if (promotion == null) return null;
    }
    return Move(from, to, promotion: promotion);
  }

  @override
  bool operator ==(Object other) =>
      other is Move &&
      other.from == from &&
      other.to == to &&
      other.promotion == promotion;

  @override
  int get hashCode => Object.hash(from, to, promotion);

  @override
  String toString() => uci;
}

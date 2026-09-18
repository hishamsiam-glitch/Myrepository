import 'package:flutter/material.dart';

import '../chess/pieces.dart';
import 'board_theme.dart';

/// Draws a piece using the *solid* Unicode chess glyphs (U+265A..U+265F) for
/// both colours, then colours them: a filled glyph plus a stroked copy on top.
///
/// Using one set of shapes for both sides — rather than the hollow glyphs for
/// White — keeps the two colours the same silhouette and the same visual
/// weight, and means only six code points have to be present in the font.
class PieceGlyph extends StatelessWidget {
  const PieceGlyph({
    super.key,
    required this.piece,
    required this.size,
    this.palette = BoardPalette.warm,
  });

  final Piece piece;
  final double size;
  final BoardPalette palette;

  static const List<String> _solidGlyphs = [
    '♟', // pawn
    '♞', // knight
    '♝', // bishop
    '♜', // rook
    '♛', // queen
    '♚', // king
  ];

  @override
  Widget build(BuildContext context) {
    final glyph = _solidGlyphs[piece.type.index];
    final fill = piece.color == PieceColor.white
        ? palette.whitePiece
        : palette.blackPiece;
    final outline = piece.color == PieceColor.white
        ? palette.pieceOutline
        : palette.blackPiece;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Text(
            glyph,
            style: TextStyle(
              fontSize: size * 0.82,
              height: 1.0,
              color: fill,
            ),
          ),
          Text(
            glyph,
            style: TextStyle(
              fontSize: size * 0.82,
              height: 1.0,
              foreground: Paint()
                ..style = PaintingStyle.stroke
                ..strokeWidth = size * 0.035
                ..color = outline,
            ),
          ),
        ],
      ),
    );
  }
}

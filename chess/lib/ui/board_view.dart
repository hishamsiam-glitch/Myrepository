import 'package:flutter/material.dart';

import '../chess/move.dart';
import '../chess/pieces.dart';
import '../chess/position.dart';
import 'board_theme.dart';
import 'piece_glyph.dart';

/// The chessboard. Purely presentational: it renders a [Position] plus a set
/// of highlights and reports taps back by square index.
class BoardView extends StatelessWidget {
  const BoardView({
    super.key,
    required this.position,
    this.orientation = PieceColor.white,
    this.selectedSquare,
    this.moveTargets = const {},
    this.lastMove,
    this.checkedSquare,
    this.onTapSquare,
    this.palette = BoardPalette.warm,
    this.showCoordinates = true,
  });

  final Position position;

  /// Which side is at the bottom.
  final PieceColor orientation;

  final int? selectedSquare;
  final Set<int> moveTargets;
  final Move? lastMove;
  final int? checkedSquare;
  final ValueChanged<int>? onTapSquare;
  final BoardPalette palette;
  final bool showCoordinates;

  /// Maps a display cell (0 = top-left) to a board square, honouring
  /// [orientation].
  int _squareForCell(int cell) {
    final row = cell ~/ 8;
    final column = cell % 8;
    if (orientation == PieceColor.white) {
      return squareOf(column, 7 - row);
    }
    return squareOf(7 - column, row);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final side = constraints.biggest.shortestSide;
        final cellSize = side / 8;
        return SizedBox(
          width: side,
          height: side,
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: palette.dark, width: 2),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Column(
                children: [
                  for (var row = 0; row < 8; row++)
                    Row(
                      children: [
                        for (var column = 0; column < 8; column++)
                          _buildCell(context, row * 8 + column, cellSize),
                      ],
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildCell(BuildContext context, int cell, double cellSize) {
    final square = _squareForCell(cell);
    final isDark = (fileOf(square) + rankOf(square)) % 2 == 0;
    final base = isDark ? palette.dark : palette.light;
    final piece = position.pieceAt(square);

    final overlays = <Color>[
      if (lastMove != null &&
          (square == lastMove!.from || square == lastMove!.to))
        palette.lastMove,
      if (square == checkedSquare) palette.check,
      if (square == selectedSquare) palette.selected,
    ];

    return SizedBox(
      width: cellSize,
      height: cellSize,
      child: Material(
        color: base,
        child: InkWell(
          onTap: onTapSquare == null ? null : () => onTapSquare!(square),
          child: Stack(
            alignment: Alignment.center,
            children: [
              for (final overlay in overlays)
                Positioned.fill(child: ColoredBox(color: overlay)),
              if (showCoordinates && _isCornerCell(cell))
                _coordinateLabel(cell, square, cellSize, isDark),
              if (moveTargets.contains(square))
                _moveHint(cellSize, occupied: piece != null),
              if (piece != null)
                PieceGlyph(piece: piece, size: cellSize, palette: palette),
            ],
          ),
        ),
      ),
    );
  }

  bool _isCornerCell(int cell) => cell % 8 == 0 || cell ~/ 8 == 7;

  /// Rank numbers down the left edge, file letters along the bottom.
  Widget _coordinateLabel(int cell, int square, double cellSize, bool isDark) {
    final color =
        isDark ? palette.coordinateOnDark : palette.coordinateOnLight;
    final style = TextStyle(
      fontSize: cellSize * 0.22,
      fontWeight: FontWeight.w700,
      color: color,
    );
    return Stack(
      children: [
        if (cell % 8 == 0)
          Positioned(
            left: cellSize * 0.06,
            top: cellSize * 0.04,
            child: Text('${rankOf(square) + 1}', style: style),
          ),
        if (cell ~/ 8 == 7)
          Positioned(
            right: cellSize * 0.08,
            bottom: cellSize * 0.02,
            child: Text(
              String.fromCharCode(97 + fileOf(square)),
              style: style,
            ),
          ),
      ],
    );
  }

  /// A dot on empty destination squares, a ring on ones holding a capture, so
  /// the hint never hides the piece being taken.
  Widget _moveHint(double cellSize, {required bool occupied}) {
    if (occupied) {
      return Container(
        width: cellSize * 0.92,
        height: cellSize * 0.92,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: palette.target, width: cellSize * 0.09),
        ),
      );
    }
    return Container(
      width: cellSize * 0.3,
      height: cellSize * 0.3,
      decoration: BoxDecoration(shape: BoxShape.circle, color: palette.target),
    );
  }
}

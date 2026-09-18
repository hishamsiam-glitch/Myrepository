import 'package:flutter/material.dart';

/// Board colours, kept out of the widget so light and dark themes can share
/// one definition and the review screen matches the game screen exactly.
class BoardPalette {
  const BoardPalette({
    required this.light,
    required this.dark,
    required this.lastMove,
    required this.selected,
    required this.target,
    required this.check,
    required this.whitePiece,
    required this.blackPiece,
    required this.pieceOutline,
    required this.coordinateOnLight,
    required this.coordinateOnDark,
  });

  final Color light;
  final Color dark;
  final Color lastMove;
  final Color selected;
  final Color target;
  final Color check;
  final Color whitePiece;
  final Color blackPiece;
  final Color pieceOutline;
  final Color coordinateOnLight;
  final Color coordinateOnDark;

  static const BoardPalette warm = BoardPalette(
    light: Color(0xFFEFD9B4),
    dark: Color(0xFFB07D4F),
    lastMove: Color(0x66FFD54F),
    selected: Color(0x8829B6F6),
    target: Color(0x5521C7A8),
    check: Color(0x99E53935),
    whitePiece: Color(0xFFFDFBF7),
    blackPiece: Color(0xFF2A2320),
    pieceOutline: Color(0xFF3E322B),
    coordinateOnLight: Color(0xFF8A6A47),
    coordinateOnDark: Color(0xFFF2E3C9),
  );
}

/// One Material 3 theme built from a seed, in both brightnesses.
ThemeData buildChessTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(
    seedColor: const Color(0xFF7A5230),
    brightness: brightness,
  );
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 2,
    ),
    cardTheme: CardThemeData(
      clipBehavior: Clip.antiAlias,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    listTileTheme: const ListTileThemeData(
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
  );
}

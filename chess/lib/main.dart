import 'package:flutter/material.dart';

import 'storage/game_library.dart';
import 'storage/game_storage.dart';
import 'ui/board_theme.dart';
import 'ui/home_screen.dart';

void main() {
  runApp(ChessApp(library: GameLibrary(FileGameStorage())));
}

class ChessApp extends StatefulWidget {
  const ChessApp({super.key, required this.library});

  final GameLibrary library;

  @override
  State<ChessApp> createState() => _ChessAppState();
}

class _ChessAppState extends State<ChessApp> {
  @override
  void initState() {
    super.initState();
    // Saved games are read once at launch; everything after that is served
    // from memory and written back on each change.
    widget.library.load();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Chess',
      debugShowCheckedModeBanner: false,
      theme: buildChessTheme(Brightness.light),
      darkTheme: buildChessTheme(Brightness.dark),
      home: HomeScreen(library: widget.library),
    );
  }
}

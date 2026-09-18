import 'package:flutter/foundation.dart';

import 'chess/game.dart';
import 'chess/move.dart';
import 'chess/pieces.dart';
import 'chess/position.dart';
import 'engine/difficulty.dart';
import 'engine/search.dart';
import 'storage/game_library.dart';
import 'storage/game_record.dart';

/// Runs the search. Swapped out in tests so they don't spawn isolates.
typedef SearchRunner = Future<SearchResult> Function(SearchRequest request);

/// The default runner: the search is pure Dart and can take seconds on Expert,
/// so it runs in a background isolate and the board stays responsive.
Future<SearchResult> runSearchInIsolate(SearchRequest request) =>
    compute(Search.run, request, debugLabel: 'chess-search');

/// One game being played: the rules state, the AI's turn, the board
/// selection, and saving after every move.
class GameSession extends ChangeNotifier {
  GameSession({
    required GameRecord record,
    required this.library,
    SearchRunner? searchRunner,
    this.autoStartAi = true,
  })  : _record = record,
        _searchRunner = searchRunner ?? runSearchInIsolate,
        _game = record.toGame() {
    if (autoStartAi) _maybeStartAiTurn();
  }

  /// Where moves are saved as they are played.
  final GameLibrary library;

  final SearchRunner _searchRunner;

  /// Lets tests drive the AI turn explicitly.
  final bool autoStartAi;

  GameRecord _record;
  final ChessGame _game;
  int? _selectedSquare;
  List<Move> _selectedMoves = const [];
  PendingPromotion? _pendingPromotion;
  bool _thinking = false;
  SearchResult? _lastSearch;
  int _aiTurnToken = 0;

  GameRecord get record => _record;

  ChessGame get game => _game;

  Position get position => _game.position;

  Difficulty get difficulty => _record.difficulty;

  PieceColor get playerColor => _record.playerColor;

  PieceColor get aiColor => _record.playerColor.opponent;

  GameOutcome get outcome => _game.outcome;

  bool get isPlayerTurn => !_game.isOver && position.turn == playerColor;

  /// True while the AI is searching, so the UI can show a progress hint and
  /// ignore board taps.
  bool get isThinking => _thinking;

  SearchResult? get lastSearch => _lastSearch;

  int? get selectedSquare => _selectedSquare;

  /// Squares the selected piece may move to, for the board's dots.
  Set<int> get moveTargets => {for (final move in _selectedMoves) move.to};

  /// Set while waiting for the user to choose a promotion piece.
  PendingPromotion? get pendingPromotion => _pendingPromotion;

  /// The last move played, so the board can highlight it.
  Move? get lastMove =>
      _game.history.isEmpty ? null : _game.history.last.move;

  /// The king's square when it is in check, for the warning highlight.
  int? get checkedKingSquare {
    if (!position.isCheck) return null;
    for (var square = 0; square < 64; square++) {
      final piece = position.pieceAt(square);
      if (piece != null &&
          piece.type == PieceType.king &&
          piece.color == position.turn) {
        return square;
      }
    }
    return null;
  }

  /// Whether taking back a move is possible. Deliberately true while the AI
  /// is still searching: on Expert that is several seconds, and having to wait
  /// them out before you can undo a misclick would be maddening. An in-flight
  /// search is cancelled by [undoPlayerMove] instead.
  bool get canUndo => _game.history.isNotEmpty;

  /// Handles a tap on [square]: select a piece, or play the selected piece's
  /// move to that square.
  void tapSquare(int square) {
    if (_game.isOver || _thinking || _pendingPromotion != null) return;
    if (position.turn != playerColor) return;

    final matching = _selectedMoves.where((move) => move.to == square).toList();
    if (matching.isNotEmpty) {
      if (matching.first.promotion != null) {
        // Several moves share this destination: it is a promotion, and the
        // user picks the piece.
        _pendingPromotion = PendingPromotion(
          from: matching.first.from,
          to: square,
          options: matching.map((move) => move.promotion!).toList(),
        );
        notifyListeners();
      } else {
        _playPlayerMove(matching.first);
      }
      return;
    }

    final piece = position.pieceAt(square);
    if (piece != null && piece.color == playerColor) {
      _selectedSquare = square;
      _selectedMoves = _game.movesFrom(square);
    } else {
      _clearSelection();
    }
    notifyListeners();
  }

  /// Completes the promotion the board is waiting on.
  void choosePromotion(PieceType type) {
    final pending = _pendingPromotion;
    if (pending == null) return;
    _pendingPromotion = null;
    _playPlayerMove(Move(pending.from, pending.to, promotion: type));
  }

  void cancelPromotion() {
    _pendingPromotion = null;
    _clearSelection();
    notifyListeners();
  }

  void _clearSelection() {
    _selectedSquare = null;
    _selectedMoves = const [];
  }

  void _playPlayerMove(Move move) {
    _game.play(move);
    _clearSelection();
    _syncRecord();
    notifyListeners();
    _maybeStartAiTurn();
  }

  /// Takes back the player's last move (and the AI's reply, if it has already
  /// answered), so the board is the player's to move again.
  Future<void> undoPlayerMove() async {
    if (!canUndo) return;
    // Cancel any AI turn in flight; its result is for a board that no longer
    // exists.
    _aiTurnToken++;
    _thinking = false;

    var taken = 0;
    while (_game.history.isNotEmpty && taken < 2) {
      final lastMover = _game.history.last.after.turn.opponent;
      _game.undo();
      taken++;
      if (lastMover == playerColor) break;
    }
    _clearSelection();
    _lastSearch = null;
    _syncRecord();
    notifyListeners();
    // If undoing landed on the AI's turn (e.g. the player is Black and took
    // back into the opening), let it move again.
    _maybeStartAiTurn();
  }

  void resign() {
    if (_game.isOver) return;
    _aiTurnToken++;
    _thinking = false;
    _game.resign(playerColor);
    _clearSelection();
    _syncRecord();
    notifyListeners();
  }

  /// Kicks off the AI's move when it is its turn. Safe to call at any time.
  void _maybeStartAiTurn() {
    if (_game.isOver || _thinking || position.turn != aiColor) return;
    _thinking = true;
    notifyListeners();
    final token = ++_aiTurnToken;
    _runAiTurn(token);
  }

  Future<void> _runAiTurn(int token) async {
    final request = SearchRequest(
      fen: position.fen,
      difficulty: difficulty,
      repeatedKeys: _repeatedKeys(),
    );
    SearchResult? result;
    try {
      result = await _searchRunner(request);
    } on Object catch (error, stack) {
      // A failed search must not wedge the game: fall back to a legal move.
      debugPrint('Chess search failed: $error\n$stack');
    }

    // The board may have moved on (undo, resign, new game) while we searched.
    if (token != _aiTurnToken) return;
    _thinking = false;

    final moves = _game.legalMoves();
    if (moves.isEmpty) {
      notifyListeners();
      return;
    }
    final move = result?.move;
    _lastSearch = result;
    _game.play(moves.contains(move) ? move! : moves.first);
    _syncRecord();
    notifyListeners();
  }

  /// Every position already reached in this game. The search scores a move
  /// landing on one of them as a draw, which is the behaviour you want at both
  /// ends: the AI won't repeat while it is winning, and it will happily repeat
  /// to hold a draw when it is losing.
  List<String> _repeatedKeys() => {
        _game.initial.repetitionKey,
        for (final played in _game.history) played.after.repetitionKey,
      }.toList();

  /// Mirrors the live game back into the stored record and saves it. Called
  /// after every move, so quitting the app mid-game loses nothing.
  void _syncRecord() {
    _record = _record.copyWith(
      updatedAt: DateTime.now(),
      moveUcis: _game.moveUcis,
      outcome: _game.outcome,
    );
    // Fire and forget: the UI should not wait on the filesystem, and the
    // library swallows write errors.
    library.put(_record);
  }

  @override
  void dispose() {
    _aiTurnToken++;
    super.dispose();
  }
}

/// A promotion the board is waiting on the user to resolve.
class PendingPromotion {
  const PendingPromotion({
    required this.from,
    required this.to,
    required this.options,
  });

  final int from;
  final int to;
  final List<PieceType> options;
}

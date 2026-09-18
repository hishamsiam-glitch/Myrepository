import 'move.dart';
import 'pieces.dart';
import 'position.dart';

/// Why a game is over (or that it isn't).
enum GameOutcome {
  inProgress,
  whiteWinsByCheckmate,
  blackWinsByCheckmate,
  drawByStalemate,
  drawByFiftyMoveRule,
  drawByThreefoldRepetition,
  drawByInsufficientMaterial,
  whiteWinsByResignation,
  blackWinsByResignation;

  bool get isOver => this != GameOutcome.inProgress;

  bool get isDraw => const {
        GameOutcome.drawByStalemate,
        GameOutcome.drawByFiftyMoveRule,
        GameOutcome.drawByThreefoldRepetition,
        GameOutcome.drawByInsufficientMaterial,
      }.contains(this);

  /// The winning side, or null for a draw or an unfinished game.
  PieceColor? get winner => switch (this) {
        GameOutcome.whiteWinsByCheckmate ||
        GameOutcome.whiteWinsByResignation =>
          PieceColor.white,
        GameOutcome.blackWinsByCheckmate ||
        GameOutcome.blackWinsByResignation =>
          PieceColor.black,
        _ => null,
      };

  /// PGN-style result token.
  String get scoreLine {
    if (!isOver) return '*';
    if (isDraw) return '1/2-1/2';
    return winner == PieceColor.white ? '1-0' : '0-1';
  }

  String get description => switch (this) {
        GameOutcome.inProgress => 'In progress',
        GameOutcome.whiteWinsByCheckmate => 'White wins by checkmate',
        GameOutcome.blackWinsByCheckmate => 'Black wins by checkmate',
        GameOutcome.drawByStalemate => 'Draw by stalemate',
        GameOutcome.drawByFiftyMoveRule => 'Draw by the fifty-move rule',
        GameOutcome.drawByThreefoldRepetition =>
          'Draw by threefold repetition',
        GameOutcome.drawByInsufficientMaterial =>
          'Draw by insufficient material',
        GameOutcome.whiteWinsByResignation => 'White wins — Black resigned',
        GameOutcome.blackWinsByResignation => 'Black wins — White resigned',
      };

  static GameOutcome fromName(String name) => GameOutcome.values.firstWhere(
        (value) => value.name == name,
        orElse: () => GameOutcome.inProgress,
      );
}

/// One played move, kept alongside the position it produced so the UI can
/// show the move list and step back through the game without replaying it.
class PlayedMove {
  PlayedMove({required this.move, required this.san, required this.after});

  final Move move;
  final String san;
  final Position after;
}

/// A game in progress: the move history plus the rules bookkeeping that spans
/// moves (repetition counts, resignations).
///
/// This is deliberately plain Dart with no Flutter dependency, so the whole
/// rules layer is unit-testable and can run inside a background isolate.
class ChessGame {
  ChessGame({Position? start})
      : initial = start ?? Position.initial(),
        _outcome = GameOutcome.inProgress {
    _positions.add(initial);
    _repetitions[initial.repetitionKey] = 1;
  }

  /// Rebuilds a game from its starting FEN and the list of moves played, which
  /// is exactly what gets persisted. Stops early (and reports how far it got)
  /// if a stored move turns out to be illegal, so a corrupted save degrades
  /// into a shorter game instead of an exception.
  factory ChessGame.replay({
    required String startFen,
    required List<String> moveUcis,
    GameOutcome resolution = GameOutcome.inProgress,
  }) {
    final game = ChessGame(start: Position.fromFen(startFen));
    for (final uci in moveUcis) {
      final move = Move.tryParseUci(uci);
      if (move == null || !game.isLegal(move)) break;
      game.play(move);
    }
    // A resignation or agreed draw is not derivable from the moves, so it is
    // stored separately and re-applied here.
    if (!game.outcome.isOver && resolution.isOver) {
      game._outcome = resolution;
    }
    return game;
  }

  final Position initial;
  final List<Position> _positions = [];
  final List<PlayedMove> _history = [];
  final Map<String, int> _repetitions = {};
  GameOutcome _outcome;

  Position get position => _positions.last;

  List<PlayedMove> get history => List.unmodifiable(_history);

  List<String> get moveUcis => _history.map((m) => m.move.uci).toList();

  List<String> get moveSans => _history.map((m) => m.san).toList();

  GameOutcome get outcome => _outcome;

  bool get isOver => _outcome.isOver;

  /// Legal moves in the current position, or none once the game has ended.
  List<Move> legalMoves() => isOver ? const [] : position.legalMoves();

  bool isLegal(Move move) => legalMoves().contains(move);

  /// Legal destinations for the piece on [from], for highlighting on the board.
  List<Move> movesFrom(int from) =>
      legalMoves().where((move) => move.from == from).toList();

  /// Plays [move], which must be legal. Returns the SAN that was recorded.
  String play(Move move) {
    if (isOver) {
      throw StateError('The game is already over (${_outcome.description})');
    }
    final legal = position.legalMoves();
    if (!legal.contains(move)) {
      throw ArgumentError('Illegal move ${move.uci} in ${position.fen}');
    }
    final san = position.sanFor(move, legal: legal);
    final after = position.applyMove(move);
    _positions.add(after);
    _history.add(PlayedMove(move: move, san: san, after: after));
    final key = after.repetitionKey;
    _repetitions[key] = (_repetitions[key] ?? 0) + 1;
    _outcome = _detectOutcome();
    return san;
  }

  /// Takes back the last [count] moves. Also clears a resignation or agreed
  /// draw, since taking a move back resumes play.
  void undo([int count = 1]) {
    for (var i = 0; i < count && _history.isNotEmpty; i++) {
      final removed = _history.removeLast();
      _positions.removeLast();
      final key = removed.after.repetitionKey;
      final seen = (_repetitions[key] ?? 1) - 1;
      if (seen <= 0) {
        _repetitions.remove(key);
      } else {
        _repetitions[key] = seen;
      }
    }
    _outcome = _detectOutcome();
  }

  /// Ends the game with [color] resigning.
  void resign(PieceColor color) {
    if (isOver) return;
    _outcome = color == PieceColor.white
        ? GameOutcome.blackWinsByResignation
        : GameOutcome.whiteWinsByResignation;
  }

  /// How many times the current position has occurred in this game.
  int get currentRepetitionCount => _repetitions[position.repetitionKey] ?? 1;

  /// A draw is claimable (but not automatic) at three repetitions or at the
  /// fifty-move mark; this engine claims both automatically, which is what a
  /// casual player expects.
  GameOutcome _detectOutcome() {
    if (position.legalMoves().isEmpty) {
      if (position.isCheck) {
        return position.turn == PieceColor.white
            ? GameOutcome.blackWinsByCheckmate
            : GameOutcome.whiteWinsByCheckmate;
      }
      return GameOutcome.drawByStalemate;
    }
    if (position.isInsufficientMaterial) {
      return GameOutcome.drawByInsufficientMaterial;
    }
    if (currentRepetitionCount >= 3) {
      return GameOutcome.drawByThreefoldRepetition;
    }
    if (position.halfmoveClock >= 100) return GameOutcome.drawByFiftyMoveRule;
    return GameOutcome.inProgress;
  }

  /// The move list rendered as `1. e4 e5 2. Nf3 ...`, for the game log.
  String get movesText {
    final buffer = StringBuffer();
    var moveNumber = initial.fullmoveNumber;
    var index = 0;
    if (initial.turn == PieceColor.black && _history.isNotEmpty) {
      buffer.write('$moveNumber... ${_history[0].san}');
      index = 1;
      moveNumber++;
      if (_history.length > 1) buffer.write(' ');
    }
    while (index < _history.length) {
      buffer.write('$moveNumber. ${_history[index].san}');
      if (index + 1 < _history.length) {
        buffer.write(' ${_history[index + 1].san}');
      }
      index += 2;
      moveNumber++;
      if (index < _history.length) buffer.write(' ');
    }
    return buffer.toString();
  }
}

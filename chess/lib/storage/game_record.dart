import '../chess/game.dart';
import '../chess/pieces.dart';
import '../chess/position.dart';
import '../engine/difficulty.dart';

/// One entry in the game library: everything needed to resume a game days
/// later, and everything shown in the log.
///
/// Only the starting position and the list of moves are stored — the board is
/// rebuilt by replaying them ([ChessGame.replay]). That keeps saves tiny and
/// means a save can never disagree with the rules engine.
class GameRecord {
  const GameRecord({
    required this.id,
    required this.createdAt,
    required this.updatedAt,
    required this.difficulty,
    required this.playerColor,
    required this.startFen,
    required this.moveUcis,
    required this.outcome,
  });

  /// A new record for a game that is about to be played.
  factory GameRecord.newGame({
    required Difficulty difficulty,
    required PieceColor playerColor,
    DateTime? now,
    String? id,
  }) {
    final timestamp = now ?? DateTime.now();
    return GameRecord(
      id: id ?? 'g${timestamp.microsecondsSinceEpoch}',
      createdAt: timestamp,
      updatedAt: timestamp,
      difficulty: difficulty,
      playerColor: playerColor,
      startFen: Position.startingFen,
      moveUcis: const [],
      outcome: GameOutcome.inProgress,
    );
  }

  final String id;
  final DateTime createdAt;
  final DateTime updatedAt;
  final Difficulty difficulty;

  /// The colour the human plays; the AI plays the other one.
  final PieceColor playerColor;

  final String startFen;
  final List<String> moveUcis;
  final GameOutcome outcome;

  bool get isFinished => outcome.isOver;

  int get moveCount => moveUcis.length;

  /// Full moves played, as shown in the log ("12 moves").
  int get fullMoveCount => (moveUcis.length + 1) ~/ 2;

  /// The result from the human player's point of view.
  GameResultForPlayer get playerResult {
    if (!outcome.isOver) return GameResultForPlayer.unfinished;
    if (outcome.isDraw) return GameResultForPlayer.draw;
    return outcome.winner == playerColor
        ? GameResultForPlayer.win
        : GameResultForPlayer.loss;
  }

  GameRecord copyWith({
    DateTime? updatedAt,
    List<String>? moveUcis,
    GameOutcome? outcome,
    Difficulty? difficulty,
    PieceColor? playerColor,
  }) {
    return GameRecord(
      id: id,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      difficulty: difficulty ?? this.difficulty,
      playerColor: playerColor ?? this.playerColor,
      startFen: startFen,
      moveUcis: moveUcis ?? this.moveUcis,
      outcome: outcome ?? this.outcome,
    );
  }

  /// Replays the stored moves into a live game.
  ChessGame toGame() => ChessGame.replay(
        startFen: startFen,
        moveUcis: moveUcis,
        resolution: outcome,
      );

  Map<String, Object?> toJson() => {
        'id': id,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'difficulty': difficulty.name,
        'playerColor': playerColor.name,
        'startFen': startFen,
        'moves': moveUcis.join(' '),
        'outcome': outcome.name,
      };

  /// Tolerant of missing or malformed fields: a save written by an older
  /// version (or a partially written file) should still load.
  static GameRecord? tryFromJson(Map<String, Object?> json) {
    final id = json['id'];
    if (id is! String || id.isEmpty) return null;
    final created =
        DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now();
    final moves = (json['moves'] as String? ?? '')
        .split(' ')
        .where((token) => token.isNotEmpty)
        .toList();
    final startFen = json['startFen'] as String? ?? Position.startingFen;
    try {
      Position.fromFen(startFen);
    } on FormatException {
      return null;
    }
    return GameRecord(
      id: id,
      createdAt: created,
      updatedAt:
          DateTime.tryParse(json['updatedAt'] as String? ?? '') ?? created,
      difficulty: Difficulty.fromName(json['difficulty'] as String? ?? ''),
      playerColor: json['playerColor'] == PieceColor.black.name
          ? PieceColor.black
          : PieceColor.white,
      startFen: startFen,
      moveUcis: moves,
      outcome: GameOutcome.fromName(json['outcome'] as String? ?? ''),
    );
  }
}

enum GameResultForPlayer {
  win,
  loss,
  draw,
  unfinished;

  String get label => switch (this) {
        GameResultForPlayer.win => 'Win',
        GameResultForPlayer.loss => 'Loss',
        GameResultForPlayer.draw => 'Draw',
        GameResultForPlayer.unfinished => 'Unfinished',
      };
}

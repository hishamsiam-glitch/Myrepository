import 'dart:math';

import '../chess/move.dart';
import '../chess/pieces.dart';
import '../chess/position.dart';
import 'difficulty.dart';
import 'evaluation.dart';

/// Score assigned to being checkmated, offset by ply so the search prefers
/// mating sooner and being mated later.
const int _mateScore = 1000000;

/// What the AI decided, plus enough detail to show "thinking" feedback and to
/// assert on in tests.
class SearchResult {
  const SearchResult({
    required this.move,
    required this.score,
    required this.depth,
    required this.nodes,
    required this.elapsed,
  });

  final Move? move;

  /// Centipawns from the searching side's point of view.
  final int score;
  final int depth;
  final int nodes;
  final Duration elapsed;
}

/// Everything the AI needs to pick a move, in a form that can be handed to a
/// background isolate.
class SearchRequest {
  const SearchRequest({
    required this.fen,
    required this.difficulty,
    this.seed,
    this.repeatedKeys = const [],
  });

  final String fen;
  final Difficulty difficulty;

  /// Fixes the random choices, so tests are deterministic.
  final int? seed;

  /// Repetition keys ([Position.repetitionKey]) already seen in the game.
  /// Moves landing on one of these are scored as a draw, which stops the AI
  /// from repeating a position when it has better available.
  final List<String> repeatedKeys;
}

/// Alpha-beta search with iterative deepening, quiescence and MVV-LVA move
/// ordering. One instance handles one move; it is not reused.
class Search {
  Search(this.difficulty, {int? seed, int? timeBudgetMs})
      : _random = Random(seed),
        timeBudgetMs = timeBudgetMs ?? difficulty.timeBudgetMs;

  final Difficulty difficulty;

  /// Wall-clock budget for this move. Defaults to the difficulty's own
  /// budget; overridable so tests can exercise the cut-short paths.
  final int timeBudgetMs;
  final Random _random;
  final Stopwatch _clock = Stopwatch();
  int _nodes = 0;
  bool _outOfTime = false;

  bool get _budgetSpent {
    if (_outOfTime) return true;
    if (_clock.elapsedMilliseconds >= timeBudgetMs) {
      _outOfTime = true;
    }
    return _outOfTime;
  }

  /// Runs the search for the given request. Returns a result whose [move] is
  /// null only when the position has no legal moves.
  static SearchResult run(SearchRequest request) {
    final search = Search(request.difficulty, seed: request.seed);
    return search.bestMove(
      Position.fromFen(request.fen),
      repeatedKeys: request.repeatedKeys.toSet(),
    );
  }

  SearchResult bestMove(
    Position position, {
    Set<String> repeatedKeys = const {},
  }) {
    _clock.start();
    final legal = position.legalMoves();
    if (legal.isEmpty) {
      return SearchResult(
        move: null,
        score: 0,
        depth: 0,
        nodes: 0,
        elapsed: _clock.elapsed,
      );
    }

    // The "didn't see it" blunder: easy levels sometimes skip the search.
    if (difficulty.blunderChance > 0 &&
        _random.nextDouble() < difficulty.blunderChance) {
      return SearchResult(
        move: legal[_random.nextInt(legal.length)],
        score: 0,
        depth: 0,
        nodes: 0,
        elapsed: _clock.elapsed,
      );
    }

    var scored = <_ScoredMove>[];
    Move? previousBest;

    // Iterative deepening: each pass is complete before its results are used,
    // so running out of time just means falling back to the last full depth.
    var completedDepth = 0;
    for (var depth = 1; depth <= difficulty.maxDepth; depth++) {
      final pass = _searchRoot(position, depth, previousBest, repeatedKeys);
      if (pass == null) break; // Ran out of time mid-pass; keep the last one.
      scored = pass;
      completedDepth = depth;
      previousBest = scored.first.move;
      if (scored.first.score >= _mateScore - 100) break; // Mate found.
      if (_budgetSpent) break;
    }

    if (scored.isEmpty) {
      // Only possible if the very first pass was cut short; fall back to a
      // static pick so a move is always returned.
      scored = [
        for (final move in legal)
          // _evaluateSigned scores from the child's side to move, which is
          // the opponent, so negate it back to our point of view.
          _ScoredMove(move, -_evaluateSigned(position.applyMove(move))),
      ]..sort((a, b) => b.score.compareTo(a.score));
      completedDepth = 1;
    }

    final chosen = _pickFromTop(scored);
    return SearchResult(
      move: chosen.move,
      score: chosen.score,
      depth: completedDepth,
      nodes: _nodes,
      elapsed: _clock.elapsed,
    );
  }

  /// Scores every root move. Returns null if the time budget ran out before
  /// the pass finished, so partial results are never mixed with full ones.
  List<_ScoredMove>? _searchRoot(
    Position position,
    int depth,
    Move? previousBest,
    Set<String> repeatedKeys,
  ) {
    final moves = _ordered(position, position.legalMoves(), previousBest);
    final scored = <_ScoredMove>[];

    // Levels that pick at random from the moves near the best one need every
    // root score to be *exact*, so each root move gets a full window. With
    // alpha-beta at the root, a move that fails low comes back with an upper
    // bound rather than its real score — which the noise window would happily
    // mistake for "nearly as good as the best move". Levels that always play
    // the best move don't care about the others' scores, so they keep the
    // cutoffs and search deeper in the same time.
    final needsExactScores = difficulty.moveNoise > 0;
    var alpha = -_mateScore * 2;

    for (final move in moves) {
      final child = position.applyMove(move);
      final int score;
      if (repeatedKeys.contains(child.repetitionKey)) {
        // Repeating is a draw; score it as one rather than searching it.
        score = 0;
      } else {
        score = -_negamax(
          child,
          depth - 1,
          -_mateScore * 2,
          needsExactScores ? _mateScore * 2 : -alpha,
          1,
        );
      }
      // Any pass cut short is discarded whole, even if it was the *first*
      // root move that ran over: past that point `_negamax` returns static
      // evaluations, and mixing those into a pass would let it overwrite a
      // perfectly good shallower result. An empty first pass is handled by
      // the static fallback in [bestMove].
      if (_outOfTime) return null;
      scored.add(_ScoredMove(move, score));
      if (score > alpha) alpha = score;
    }

    scored.sort((a, b) => b.score.compareTo(a.score));
    return scored;
  }

  /// Among the moves within [Difficulty.moveNoise] of the best, pick one at
  /// random. With noise 0 this is simply the best move.
  _ScoredMove _pickFromTop(List<_ScoredMove> scored) {
    if (difficulty.moveNoise <= 0 || scored.length == 1) return scored.first;
    final best = scored.first.score;
    // Never throw away a forced mate for the sake of variety.
    if (best >= _mateScore - 100) return scored.first;
    final candidates = scored
        .where((entry) => best - entry.score <= difficulty.moveNoise)
        .toList();
    return candidates[_random.nextInt(candidates.length)];
  }

  int _negamax(Position position, int depth, int alpha, int beta, int ply) {
    _nodes++;
    if (_budgetSpent) return _evaluateSigned(position);

    final moves = position.legalMoves();
    if (moves.isEmpty) {
      // Mate scores shrink with distance so the search races to deliver them.
      return position.isCheck ? -_mateScore + ply : 0;
    }
    if (position.halfmoveClock >= 100 || position.isInsufficientMaterial) {
      return 0;
    }
    if (depth <= 0) return _quiesce(position, alpha, beta, ply);

    var best = -_mateScore * 2;
    for (final move in _ordered(position, moves, null)) {
      final score =
          -_negamax(position.applyMove(move), depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // Opponent won't allow this line.
    }
    return best;
  }

  /// Searches on past the horizon while captures are still available, so the
  /// evaluation is never taken in the middle of a trade.
  int _quiesce(Position position, int alpha, int beta, int ply) {
    _nodes++;
    final standPat = _evaluateSigned(position);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (_budgetSpent || ply > 24) return alpha;

    for (final move in _ordered(
      position,
      position.legalCapturesAndPromotions(),
      null,
    )) {
      final score = -_quiesce(position.applyMove(move), -beta, -alpha, ply + 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  int _evaluateSigned(Position position) =>
      position.turn == PieceColor.white ? evaluate(position) : -evaluate(position);

  /// Most-valuable-victim / least-valuable-attacker ordering, with promotions
  /// and the previous iteration's best move pushed to the front. Good ordering
  /// is what makes alpha-beta actually prune.
  List<Move> _ordered(Position position, List<Move> moves, Move? first) {
    int rank(Move move) {
      if (move == first) return 1 << 20;
      var score = 0;
      final victim = position.pieceAt(move.to);
      if (victim != null) {
        final attacker = position.pieceAt(move.from);
        score += 10000 +
            pieceValues[victim.type.index] -
            (attacker == null ? 0 : pieceValues[attacker.type.index] ~/ 10);
      } else if (position.isEnPassant(move)) {
        score += 10000 + pieceValues[PieceType.pawn.index];
      }
      if (move.promotion != null) {
        score += 9000 + pieceValues[move.promotion!.index];
      }
      return score;
    }

    // Rank once per move rather than once per comparison: this runs at every
    // node in the tree.
    final ranked = [for (final move in moves) (rank(move), move)]
      ..sort((a, b) => b.$1.compareTo(a.$1));
    return [for (final entry in ranked) entry.$2];
  }
}

class _ScoredMove {
  const _ScoredMove(this.move, this.score);

  final Move move;
  final int score;
}

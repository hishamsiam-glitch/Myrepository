/// The five strength settings offered on the new-game screen.
///
/// Strength is shaped by three knobs rather than search depth alone: a weak
/// level that only searched shallowly would still play "correctly" and feel
/// robotic, so the easier levels also pick from near-best moves and
/// occasionally overlook something outright.
enum Difficulty {
  /// Sees one move ahead and blunders often — for a first game of chess.
  beginner(
    label: 'Beginner',
    blurb: 'Looks one move ahead and misses a lot.',
    maxDepth: 1,
    timeBudgetMs: 150,
    blunderChance: 0.35,
    moveNoise: 90,
  ),

  easy(
    label: 'Easy',
    blurb: 'Takes free material, but not much more.',
    maxDepth: 2,
    timeBudgetMs: 400,
    blunderChance: 0.15,
    moveNoise: 55,
  ),

  medium(
    label: 'Medium',
    blurb: 'Spots simple tactics a couple of moves deep.',
    maxDepth: 3,
    timeBudgetMs: 900,
    blunderChance: 0.05,
    moveNoise: 30,
  ),

  hard(
    label: 'Hard',
    blurb: 'Searches several moves ahead and rarely gives pieces away.',
    maxDepth: 4,
    timeBudgetMs: 2000,
    blunderChance: 0.0,
    moveNoise: 12,
  ),

  expert(
    label: 'Expert',
    blurb: 'Thinks as deeply as it can in a few seconds. Punishes mistakes.',
    maxDepth: 7,
    timeBudgetMs: 4500,
    blunderChance: 0.0,
    moveNoise: 0,
  );

  const Difficulty({
    required this.label,
    required this.blurb,
    required this.maxDepth,
    required this.timeBudgetMs,
    required this.blunderChance,
    required this.moveNoise,
  });

  final String label;
  final String blurb;

  /// Hard ceiling on iterative-deepening depth (in plies).
  final int maxDepth;

  /// Wall-clock budget for one move. Iterative deepening stops once this is
  /// spent, so slow phones simply search less deeply instead of hanging.
  final int timeBudgetMs;

  /// Probability of ignoring the search entirely and playing a random legal
  /// move — the "didn't see it" mistake that makes easy levels beatable.
  final double blunderChance;

  /// Centipawn window: any move scoring within this much of the best one is a
  /// candidate, chosen between at random. Also varies the opening play.
  final int moveNoise;

  static Difficulty fromName(String name) => Difficulty.values.firstWhere(
        (value) => value.name == name,
        orElse: () => Difficulty.medium,
      );
}

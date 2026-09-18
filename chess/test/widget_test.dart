import 'package:chess/chess/game.dart';
import 'package:chess/chess/move.dart';
import 'package:chess/chess/pieces.dart';
import 'package:chess/engine/difficulty.dart';
import 'package:chess/engine/search.dart';
import 'package:chess/game_session.dart';
import 'package:chess/main.dart';
import 'package:chess/storage/game_library.dart';
import 'package:chess/storage/game_record.dart';
import 'package:chess/storage/game_storage.dart';
import 'package:chess/ui/board_view.dart';
import 'package:chess/ui/game_review_screen.dart';
import 'package:chess/ui/game_screen.dart';
import 'package:chess/ui/home_screen.dart';
import 'package:chess/ui/library_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// A search that always answers with the same move, so widget tests never
/// depend on engine strength or timing.
SearchRunner fixedSearch(String uci) => (request) async => SearchResult(
      move: Move.tryParseUci(uci),
      score: 0,
      depth: 1,
      nodes: 1,
      elapsed: Duration.zero,
    );

GameRecord record({
  String id = 'g1',
  Difficulty difficulty = Difficulty.medium,
  PieceColor playerColor = PieceColor.white,
  List<String> moves = const [],
  GameOutcome outcome = GameOutcome.inProgress,
  DateTime? updatedAt,
}) {
  final created = DateTime(2026, 4, 2, 10, 30);
  return GameRecord(
    id: id,
    createdAt: created,
    updatedAt: updatedAt ?? created,
    difficulty: difficulty,
    playerColor: playerColor,
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moveUcis: moves,
    outcome: outcome,
  );
}

Future<GameLibrary> seededLibrary([List<GameRecord> records = const []]) async {
  final library = GameLibrary(MemoryGameStorage(records));
  await library.load();
  return library;
}

/// Taps something inside the new-game sheet, scrolling the sheet's option
/// list first: it is a scroll view, so a target can start out below the fold.
Future<void> tapInSheet(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

/// Finds the on-screen centre of a board square, for tapping.
Offset squareCenter(WidgetTester tester, int square, {PieceColor? orientation}) {
  final boardFinder = find.byType(BoardView).first;
  final board = tester.getRect(boardFinder);
  final view = tester.widget<BoardView>(boardFinder);
  final facing = orientation ?? view.orientation;
  final cell = board.width / 8;
  final int column;
  final int row;
  if (facing == PieceColor.white) {
    column = fileOf(square);
    row = 7 - rankOf(square);
  } else {
    column = 7 - fileOf(square);
    row = rankOf(square);
  }
  return Offset(
    board.left + (column + 0.5) * cell,
    board.top + (row + 0.5) * cell,
  );
}

Widget wrap(Widget child) => MaterialApp(home: child);

/// Pumps [child] on a phone-shaped viewport. The default 800x600 test surface
/// is landscape, which is not how this app is used and leaves the board
/// squeezing everything else off screen.
Future<void> pumpPhone(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(wrap(child));
  await tester.pumpAndSettle();
}

void main() {
  group('home screen', () {
    testWidgets('offers a new game and shows the difficulty list',
        (tester) async {
      final library = await seededLibrary();
      await pumpPhone(tester, HomeScreen(library: library));

      expect(find.text('New game'), findsOneWidget);
      expect(find.text('Saved games (0)'), findsOneWidget);
      expect(find.text('Game log (0)'), findsOneWidget);
      for (final level in Difficulty.values) {
        expect(find.text(level.label), findsWidgets);
      }
    });

    testWidgets('shows the win/draw/loss tally', (tester) async {
      final library = await seededLibrary([
        record(id: 'w', outcome: GameOutcome.whiteWinsByCheckmate),
        record(id: 'l', outcome: GameOutcome.blackWinsByCheckmate),
        record(id: 'o'),
      ]);
      await pumpPhone(tester, HomeScreen(library: library));

      expect(find.text('Won'), findsOneWidget);
      expect(find.text('Game log (2)'), findsOneWidget);
      expect(find.text('Saved games (1)'), findsOneWidget);
    });

    testWidgets('offers to carry on the most recent unfinished game',
        (tester) async {
      final library = await seededLibrary([
        record(
          id: 'open',
          moves: const ['e2e4', 'e7e5'],
          updatedAt: DateTime.now().subtract(const Duration(days: 2)),
        ),
      ]);
      await pumpPhone(tester, HomeScreen(library: library));

      expect(find.text('Carry on'), findsOneWidget);
      expect(find.textContaining('1 moves played'), findsOneWidget);
      expect(find.textContaining('2 days ago'), findsWidgets);
    });

    testWidgets('starting a new game opens the board and saves the game',
        (tester) async {
      final library = await seededLibrary();
      await pumpPhone(tester, HomeScreen(library: library, searchRunner: fixedSearch('e7e5')));

      await tester.tap(find.text('New game'));
      await tester.pumpAndSettle();
      expect(find.text('Hard'), findsWidgets);

      await tapInSheet(tester, find.text('Hard').last);
      await tapInSheet(tester, find.textContaining('Start as'));

      expect(find.byType(BoardView), findsOneWidget);
      expect(find.text('Hard · you are White'), findsOneWidget);
      expect(library.all.length, 1);
      expect(library.all.first.difficulty, Difficulty.hard);
    });
  });

  group('playing', () {
    testWidgets('tapping a pawn then its target plays the move and the reply',
        (tester) async {
      final library = await seededLibrary();
      await pumpPhone(tester, HomeScreen(library: library, searchRunner: fixedSearch('e7e5')));
      await tester.tap(find.text('New game'));
      await tester.pumpAndSettle();
      await tapInSheet(tester, find.textContaining('Start as'));

      expect(find.text('Your move'), findsOneWidget);

      await tester.tapAt(squareCenter(tester, parseSquare('e2')!));
      await tester.pumpAndSettle();
      await tester.tapAt(squareCenter(tester, parseSquare('e4')!));
      await tester.pumpAndSettle();

      // The move list shows both moves.
      expect(find.text('e4'), findsOneWidget);
      expect(find.text('e5'), findsOneWidget);
      expect(find.text('1.'), findsOneWidget);
      expect(library.all.first.moveUcis, ['e2e4', 'e7e5']);
    });

    testWidgets('the board is flipped when playing Black', (tester) async {
      final library = await seededLibrary();
      await pumpPhone(
        tester,
        HomeScreen(library: library, searchRunner: fixedSearch('d2d4')),
      );
      await tester.tap(find.text('New game'));
      await tester.pumpAndSettle();
      await tapInSheet(tester, find.text('Black'));
      await tapInSheet(tester, find.textContaining('Start as'));

      final view = tester.widget<BoardView>(find.byType(BoardView));
      expect(view.orientation, PieceColor.black);
      // The computer moved first.
      expect(library.all.first.moveUcis, ['d2d4']);
    });

    testWidgets('take back removes your move and the reply', (tester) async {
      final library = await seededLibrary();
      final game = record(id: 'g1');
      await library.put(game);
      await pumpPhone(tester, GameScreen(
            record: game,
            library: library,
            searchRunner: fixedSearch('e7e5'),
          ),);

      await tester.tapAt(squareCenter(tester, parseSquare('e2')!));
      await tester.pumpAndSettle();
      await tester.tapAt(squareCenter(tester, parseSquare('e4')!));
      await tester.pumpAndSettle();
      expect(find.text('e4'), findsOneWidget);

      await tester.tap(find.byTooltip('Take back move'));
      await tester.pumpAndSettle();
      expect(find.text('e4'), findsNothing);
      expect(library.byId('g1')!.moveUcis, isEmpty);
    });

    testWidgets('resigning asks first, then logs the loss', (tester) async {
      final library = await seededLibrary();
      final game = record(id: 'g1');
      await library.put(game);
      await pumpPhone(tester, GameScreen(
            record: game,
            library: library,
            searchRunner: fixedSearch('e7e5'),
          ),);

      await tester.tap(find.byTooltip('Resign'));
      await tester.pumpAndSettle();
      expect(find.text('Resign this game?'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Keep playing'));
      await tester.pumpAndSettle();
      expect(library.byId('g1')!.isFinished, isFalse);

      await tester.tap(find.byTooltip('Resign'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Resign'));
      await tester.pumpAndSettle();

      expect(library.byId('g1')!.isFinished, isTrue);
      expect(find.text('You lost'), findsOneWidget);
    });
  });

  group('library', () {
    testWidgets('lists saved games and logged games in separate tabs',
        (tester) async {
      final library = await seededLibrary([
        record(id: 'open', moves: const ['e2e4']),
        record(
          id: 'done',
          outcome: GameOutcome.whiteWinsByCheckmate,
          moves: const ['e2e4', 'e7e5'],
        ),
      ]);
      await pumpPhone(tester, LibraryScreen(library: library));

      expect(find.text('Saved (1)'), findsOneWidget);
      expect(find.text('Log (1)'), findsOneWidget);
      expect(find.textContaining('1 moves played'), findsOneWidget);

      await tester.tap(find.text('Log (1)'));
      await tester.pumpAndSettle();
      expect(find.textContaining('White wins by checkmate'), findsOneWidget);
      expect(find.text('WIN'), findsOneWidget);
    });

    testWidgets('an empty log explains itself', (tester) async {
      final library = await seededLibrary();
      await pumpPhone(tester, LibraryScreen(library: library, initialTab: 1));
      expect(find.text('No finished games yet'), findsOneWidget);
    });

    testWidgets('deleting an entry asks first and can be undone',
        (tester) async {
      final library = await seededLibrary([
        record(id: 'done', outcome: GameOutcome.drawByStalemate),
      ]);
      await pumpPhone(tester, LibraryScreen(library: library, initialTab: 1));

      await tester.tap(find.byTooltip('Delete'));
      await tester.pumpAndSettle();
      expect(find.text('Delete this log entry?'), findsOneWidget);

      // Cancelling keeps it.
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();
      expect(library.byId('done'), isNotNull);

      await tester.tap(find.byTooltip('Delete'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(library.byId('done'), isNull);
      expect(find.text('Game deleted'), findsOneWidget);

      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(library.byId('done'), isNotNull);
    });

    testWidgets('a saved game can be deleted too, with a stronger warning',
        (tester) async {
      final library = await seededLibrary([
        record(id: 'open', moves: const ['e2e4']),
      ]);
      await pumpPhone(tester, LibraryScreen(library: library));

      await tester.tap(find.byTooltip('Delete'));
      await tester.pumpAndSettle();
      expect(find.text('Delete this saved game?'), findsOneWidget);
      expect(find.textContaining('still in progress'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(library.byId('open'), isNull);
    });

    testWidgets('swiping a row deletes it after confirmation', (tester) async {
      final library = await seededLibrary([
        record(id: 'done', outcome: GameOutcome.drawByStalemate),
      ]);
      await pumpPhone(tester, LibraryScreen(library: library, initialTab: 1));

      await tester.drag(find.text('DRAW'), const Offset(-500, 0));
      await tester.pumpAndSettle();
      expect(find.text('Delete this log entry?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(library.byId('done'), isNull);
    });

    testWidgets('the log can be cleared in one go, and undone', (tester) async {
      final library = await seededLibrary([
        record(id: 'a', outcome: GameOutcome.whiteWinsByCheckmate),
        record(id: 'b', outcome: GameOutcome.drawByStalemate),
        record(id: 'open', moves: const ['e2e4']),
      ]);
      await pumpPhone(tester, LibraryScreen(library: library, initialTab: 1));

      await tester.tap(find.byTooltip('More'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Clear game log'));
      await tester.pumpAndSettle();
      expect(find.text('Clear the game log?'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Delete 2'));
      await tester.pumpAndSettle();

      // The two finished games go; the unfinished one stays.
      expect(library.finished, isEmpty);
      expect(library.unfinished.length, 1);
      expect(find.text('2 games deleted'), findsOneWidget);

      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(library.finished.length, 2);
    });

    testWidgets('clearing is offered but disabled when the tab is empty',
        (tester) async {
      final library = await seededLibrary();
      await pumpPhone(tester, LibraryScreen(library: library, initialTab: 1));

      await tester.tap(find.byTooltip('More'));
      await tester.pumpAndSettle();
      final item = tester.widget<PopupMenuItem<void>>(
        find.widgetWithText(PopupMenuItem<void>, 'Clear game log'),
      );
      expect(item.enabled, isFalse);
    });

    testWidgets('tapping a saved game resumes it on the board',
        (tester) async {
      final library = await seededLibrary([
        record(id: 'open', moves: const ['e2e4', 'e7e5']),
      ]);
      await pumpPhone(tester, LibraryScreen(library: library, searchRunner: fixedSearch('b8c6')),);

      await tester.tap(find.textContaining('Medium'));
      await tester.pumpAndSettle();

      expect(find.byType(BoardView), findsOneWidget);
      expect(find.text('e4'), findsOneWidget);
      expect(find.text('e5'), findsOneWidget);
    });

    testWidgets('tapping a logged game opens the review screen',
        (tester) async {
      final library = await seededLibrary([
        record(
          id: 'done',
          moves: const ['f2f3', 'e7e5', 'g2g4', 'd8h4'],
          outcome: GameOutcome.blackWinsByCheckmate,
        ),
      ]);
      await pumpPhone(tester, LibraryScreen(library: library, initialTab: 1));

      await tester.tap(find.textContaining('Medium'));
      await tester.pumpAndSettle();

      expect(find.byType(GameReviewScreen), findsOneWidget);
      expect(find.text('Black wins by checkmate'), findsOneWidget);
      expect(find.text('0-1'), findsOneWidget);
    });
  });

  group('review screen', () {
    testWidgets('steps back and forth through the game', (tester) async {
      final logged = record(
        id: 'done',
        moves: const ['e2e4', 'e7e5', 'g1f3'],
        outcome: GameOutcome.drawByStalemate,
      );
      await pumpPhone(tester, GameReviewScreen(record: logged));

      expect(find.text('Move 2. Nf3'), findsOneWidget);

      await tester.tap(find.byTooltip('Previous move'));
      await tester.pumpAndSettle();
      expect(find.text('Move 1… e5'), findsOneWidget);

      await tester.tap(find.byTooltip('Start'));
      await tester.pumpAndSettle();
      expect(find.text('Starting position'), findsOneWidget);

      await tester.tap(find.byTooltip('End'));
      await tester.pumpAndSettle();
      expect(find.text('Move 2. Nf3'), findsOneWidget);
    });

    testWidgets('copies the game to the clipboard', (tester) async {
      final logged = record(
        id: 'done',
        moves: const ['e2e4', 'e7e5', 'g1f3'],
        outcome: GameOutcome.whiteWinsByResignation,
      );
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = (call.arguments as Map)['text'] as String?;
          }
          return null;
        },
      );
      addTearDown(() => tester.binding.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));

      await pumpPhone(tester, GameReviewScreen(record: logged));
      await tester.scrollUntilVisible(
        find.text('Copy'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Copy'));
      await tester.pumpAndSettle();

      expect(copied, '1. e4 e5 2. Nf3 1-0');
      expect(find.text('Moves copied'), findsOneWidget);
    });

    testWidgets('jumping to a move from the move list works', (tester) async {
      final logged = record(
        id: 'done',
        moves: const ['e2e4', 'e7e5', 'g1f3'],
        outcome: GameOutcome.drawByStalemate,
      );
      await pumpPhone(tester, GameReviewScreen(record: logged));

      // The move list sits below the board, so scroll it into view first.
      await tester.scrollUntilVisible(
        find.text('1. e4'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('1. e4'));
      await tester.pumpAndSettle();
      expect(find.text('Move 1. e4'), findsOneWidget);
    });
  });

  group('app shell', () {
    testWidgets('boots into the home screen', (tester) async {
      final library = await seededLibrary();
      await tester.pumpWidget(ChessApp(library: library));
      await tester.pumpAndSettle();
      expect(find.text('Chess'), findsOneWidget);
      expect(find.text('New game'), findsOneWidget);
    });
  });
}

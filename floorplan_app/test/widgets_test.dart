import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:floorplan_tracer/model/plan.dart';
import 'package:floorplan_tracer/screens/plan_editor_screen.dart';
import 'package:floorplan_tracer/services/scene_export.dart';
import 'package:floorplan_tracer/widgets/wall_sheet.dart';

FloorPlan sampleRoom() {
  final p = FloorPlan.create('Living room');
  final a = p.addVertex(0, 0);
  final b = p.addVertex(4, 0);
  final c = p.addVertex(4, 3);
  final d = p.addVertex(0, 3);
  p.addWall(a.id, b.id);
  p.addWall(b.id, c.id);
  p.addWall(c.id, d.id);
  p.addWall(d.id, a.id);
  p.addOpening(p.walls.first, OpeningType.door, 1.5, 0.9);
  return p;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    // path_provider has no platform implementation in tests; answer with a
    // temp directory so ProjectStore.save() works.
    final tmp = Directory.systemTemp.createTempSync('fp_test');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (call) async => tmp.path,
    );
  });

  testWidgets('editor shows the plan, its wall count and the wall sheet', (tester) async {
    final plan = sampleRoom();
    await tester.pumpWidget(MaterialApp(home: PlanEditorScreen(plan: plan)));
    await tester.pumpAndSettle();
    expect(find.text('Living room'), findsOneWidget);
    expect(find.text('Trace with camera'), findsOneWidget);

    // Tap the middle of the top wall (a-b) in the select tool.
    final painter = find.byWidgetPredicate(
      (w) => w is CustomPaint && w.painter.runtimeType.toString() == '_PlanPainter',
    );
    expect(painter, findsOneWidget);
    final box = tester.renderObject(painter) as RenderBox;
    final size = box.size;
    // The plan is fitted: find the wall's screen position by tapping near the
    // top-centre of the bounding box. The fit centres the 4x3 room, so the
    // top wall is 1.5 m above the centre.
    final scale = (size.width / 4 < size.height / 3 ? size.width / 4 : size.height / 3) * 0.75;
    final tapAt = box.localToGlobal(Offset(size.width / 2, size.height / 2 - 1.5 * scale));
    await tester.tapAt(tapAt);
    await tester.pumpAndSettle();
    expect(find.text('Length (m)'), findsOneWidget);
    expect(find.byTooltip('Delete wall'), findsOneWidget);
    expect(find.text('From start (m)'), findsOneWidget); // the door row
  });

  testWidgets('wall editor changes the length and adds an opening', (tester) async {
    final plan = sampleRoom();
    final wall = plan.walls[1]; // b -> c, 3 m
    var changes = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: WallEditor(plan: plan, wall: wall, onChanged: () => changes++),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    final lengthField = find.widgetWithText(TextField, 'Length (m)');
    expect(lengthField, findsOneWidget);
    await tester.enterText(lengthField, '5');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(plan.wallLength(wall), closeTo(5, 1e-9));
    expect(changes, greaterThan(0));

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add window'));
    await tester.pumpAndSettle();
    expect(wall.openings.single.type, OpeningType.window);
    expect(find.text('Sill (m)'), findsOneWidget);
  });

  test('scene export produces walls, a floor loop and colours', () async {
    final plan = sampleRoom();
    plan.walls[2].skin = Skin(kind: SkinKind.pattern, pattern: 'tile', color: 0xFF112233);
    final scene = await SceneExporter(plan).build(selectedWall: plan.walls[0].id);
    final walls = scene['walls'] as List;
    expect(walls.length, 4);
    expect((walls[0] as Map)['openings'], hasLength(1));
    expect(((walls[2] as Map)['skin'] as Map)['color'], '#112233');
    expect(((walls[2] as Map)['skin'] as Map)['pattern'], 'tile');
    expect((scene['floors'] as List).single, hasLength(4));
    expect(scene['selected'], plan.walls[0].id);
  });
}

// Generates Play Store screenshots by rendering the real widget tree through
// Flutter's test Skia backend - no device or emulator required.
//
// Run with: flutter test tool/generate_screenshots.dart
// (kept out of test/ so it never runs as part of the normal test suite)
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scientific_calculator/main.dart';

const _outDir = 'store_assets/screenshots';

// flutter test's headless engine doesn't ship real fonts by default (text
// renders as placeholder boxes), so load the actual fonts used by the app
// straight from the Flutter SDK cache before rendering any screenshots.
Future<void> _loadRealFonts() async {
  await _loadFont(
    'Roboto',
    '/opt/flutter-sdk/flutter/engine/src/flutter/txt/third_party/fonts/Roboto-Regular.ttf',
  );
  await _loadFont(
    'MaterialIcons',
    '/opt/flutter-sdk/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
  );
}

Future<void> _loadFont(String family, String path) async {
  final bytes = File(path).readAsBytesSync();
  final loader = FontLoader(family)
    ..addFont(Future.value(bytes.buffer.asByteData()));
  await loader.load();
}

Future<void> _capture(
  WidgetTester tester, {
  required String filename,
  required Brightness brightness,
  required List<Future<void> Function(WidgetTester)> actions,
}) async {
  tester.platformDispatcher.platformBrightnessTestValue = brightness;
  await tester.binding.setSurfaceSize(const Size(1080, 2280));
  tester.view.physicalSize = const Size(1080, 2280);
  tester.view.devicePixelRatio = 1.0;

  final boundaryKey = GlobalKey();
  await tester.pumpWidget(
    RepaintBoundary(key: boundaryKey, child: const CalculatorApp()),
  );
  await tester.pumpAndSettle();

  for (final action in actions) {
    await action(tester);
  }
  await tester.pumpAndSettle();

  await tester.runAsync(() async {
    final boundary =
        boundaryKey.currentContext!.findRenderObject()
            as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 1.0);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('$_outDir/$filename');
    file.parent.createSync(recursive: true);
    file.writeAsBytesSync(byteData!.buffer.asUint8List());
  });

  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
    tester.platformDispatcher.clearPlatformBrightnessTestValue();
  });
}

Future<void> _tap(WidgetTester tester, String label) async {
  await tester.tap(find.byKey(Key(label)));
  await tester.pump();
}

void main() {
  setUpAll(_loadRealFonts);

  testWidgets('01 scientific mode - light', (tester) async {
    await _capture(
      tester,
      filename: '01_scientific_light.png',
      brightness: Brightness.light,
      actions: [
        (t) async {
          await _tap(t, '4');
          await _tap(t, '5');
          await _tap(t, '×');
          await _tap(t, '2');
          await _tap(t, '+');
          await _tap(t, '1');
          await _tap(t, '0');
          await _tap(t, '=');
        },
      ],
    );
  });

  testWidgets('02 scientific functions - light', (tester) async {
    await _capture(
      tester,
      filename: '02_functions_light.png',
      brightness: Brightness.light,
      actions: [
        (t) async {
          await _tap(t, 'sin');
          await _tap(t, '3');
          await _tap(t, '0');
          await _tap(t, ')');
        },
      ],
    );
  });

  testWidgets('03 basic mode - dark', (tester) async {
    await _capture(
      tester,
      filename: '03_basic_dark.png',
      brightness: Brightness.dark,
      actions: [
        (t) async {
          await t.tap(find.byIcon(Icons.calculate));
          await t.pump();
          await _tap(t, '9');
          await _tap(t, '9');
          await _tap(t, '9');
          await _tap(t, '−');
          await _tap(t, '1');
          await _tap(t, '=');
        },
      ],
    );
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:scientific_calculator/main.dart';

Future<void> _tapKey(WidgetTester tester, String label) async {
  await tester.tap(find.byKey(Key(label)));
  await tester.pump();
}

Text _displayText(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('display')));

void main() {
  testWidgets('performs 12 + 8 = 20 through the keypad', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const CalculatorApp());

    await _tapKey(tester, '1');
    await _tapKey(tester, '2');
    await _tapKey(tester, '+');
    await _tapKey(tester, '8');
    await _tapKey(tester, '=');

    expect(_displayText(tester).data, '20');
  });

  testWidgets('AC clears the expression back to 0', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const CalculatorApp());

    await _tapKey(tester, '5');
    expect(_displayText(tester).data, '5');

    await _tapKey(tester, 'AC');
    expect(_displayText(tester).data, '0');
  });

  testWidgets('scientific toggle shows and hides sin/cos/tan', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const CalculatorApp());

    expect(find.byKey(const Key('sin')), findsOneWidget);

    await tester.tap(find.byIcon(Icons.calculate));
    await tester.pump();
    expect(find.byKey(const Key('sin')), findsNothing);
  });

  testWidgets('division by zero shows an error instead of crashing', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const CalculatorApp());

    await _tapKey(tester, '5');
    await _tapKey(tester, '÷');
    await _tapKey(tester, '0');
    await _tapKey(tester, '=');

    expect(find.text('Cannot divide by zero'), findsOneWidget);
  });

  testWidgets('scientific sqrt(16) evaluates to 4', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const CalculatorApp());

    await _tapKey(tester, '√');
    await _tapKey(tester, '1');
    await _tapKey(tester, '6');
    await _tapKey(tester, ')');
    await _tapKey(tester, '=');

    expect(_displayText(tester).data, '4');
  });
}

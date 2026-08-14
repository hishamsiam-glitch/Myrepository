import 'package:flutter_test/flutter_test.dart';
import 'package:scientific_calculator/calculator_engine.dart';

void main() {
  group('basic arithmetic', () {
    final engine = CalculatorEngine();

    test('addition', () => expect(engine.evaluate('2+3'), 5));
    test('subtraction', () => expect(engine.evaluate('10-4'), 6));
    test('multiplication', () => expect(engine.evaluate('6*7'), 42));
    test('division', () => expect(engine.evaluate('9/2'), 4.5));
    test(
      'operator precedence',
      () => expect(engine.evaluate('2+3*4'), 14),
    );
    test(
      'parentheses override precedence',
      () => expect(engine.evaluate('(2+3)*4'), 20),
    );
    test('nested parentheses', () => expect(engine.evaluate('((1+2)*3)-1'), 8));
    test('unary minus', () => expect(engine.evaluate('-5+3'), -2));
    test(
      'unary minus before parens',
      () => expect(engine.evaluate('-(2+3)'), -5),
    );
    test('decimal numbers', () => expect(engine.evaluate('1.5+2.25'), 3.75));

    test('division by zero throws', () {
      expect(
        () => engine.evaluate('5/0'),
        throwsA(isA<CalculatorException>()),
      );
    });

    test('empty expression throws', () {
      expect(() => engine.evaluate(''), throwsA(isA<CalculatorException>()));
    });

    test('malformed expression throws', () {
      expect(
        () => engine.evaluate('2+*3'),
        throwsA(isA<CalculatorException>()),
      );
    });

    test('unbalanced parens throws', () {
      expect(
        () => engine.evaluate('(2+3'),
        throwsA(isA<CalculatorException>()),
      );
    });
  });

  group('percent and power', () {
    final engine = CalculatorEngine();

    test('percent postfix', () => expect(engine.evaluate('50%'), 0.5));
    test(
      'percent used in expression',
      () => expect(engine.evaluate('200+10%'), 200.1),
    );
    test('power', () => expect(engine.evaluate('2^10'), 1024));
    test(
      'right-associative power',
      () => expect(engine.evaluate('2^3^2'), 512), // 2^(3^2)
    );
    test('negative exponent', () => expect(engine.evaluate('2^-1'), 0.5));
  });

  group('factorial', () {
    final engine = CalculatorEngine();

    test('5! == 120', () => expect(engine.evaluate('5!'), 120));
    test('0! == 1', () => expect(engine.evaluate('0!'), 1));
    test('negative factorial throws', () {
      expect(
        () => engine.evaluate('(-1)!'),
        throwsA(isA<CalculatorException>()),
      );
    });
    test('non-integer factorial throws', () {
      expect(
        () => engine.evaluate('1.5!'),
        throwsA(isA<CalculatorException>()),
      );
    });
  });

  group('constants', () {
    final engine = CalculatorEngine();

    test('pi', () => expect(engine.evaluate('pi'), closeTo(3.14159265, 1e-6)));
    test('e', () => expect(engine.evaluate('e'), closeTo(2.71828182, 1e-6)));
    test(
      'unicode pi symbol',
      () => expect(engine.evaluate('π'), closeTo(3.14159265, 1e-6)),
    );
    test(
      '2*pi',
      () => expect(engine.evaluate('2*pi'), closeTo(6.2831853, 1e-6)),
    );
  });

  group('scientific functions in degrees', () {
    final engine = CalculatorEngine(angleMode: AngleMode.degrees);

    test('sin(30) == 0.5', () {
      expect(engine.evaluate('sin(30)'), closeTo(0.5, 1e-9));
    });
    test('cos(60) == 0.5', () {
      expect(engine.evaluate('cos(60)'), closeTo(0.5, 1e-9));
    });
    test('tan(45) == 1', () {
      expect(engine.evaluate('tan(45)'), closeTo(1, 1e-9));
    });
    test('asin(1) == 90', () {
      expect(engine.evaluate('asin(1)'), closeTo(90, 1e-9));
    });
    test('asin out of domain throws', () {
      expect(
        () => engine.evaluate('asin(2)'),
        throwsA(isA<CalculatorException>()),
      );
    });
  });

  group('scientific functions in radians', () {
    final engine = CalculatorEngine(angleMode: AngleMode.radians);

    test('sin(pi/2) == 1', () {
      expect(engine.evaluate('sin(pi/2)'), closeTo(1, 1e-9));
    });
    test('cos(pi) == -1', () {
      expect(engine.evaluate('cos(pi)'), closeTo(-1, 1e-9));
    });
  });

  group('logarithms and roots', () {
    final engine = CalculatorEngine();

    test('sqrt(16) == 4', () => expect(engine.evaluate('sqrt(16)'), 4));
    test('sqrt negative throws', () {
      expect(
        () => engine.evaluate('sqrt(-1)'),
        throwsA(isA<CalculatorException>()),
      );
    });
    test('ln(e) == 1', () => expect(engine.evaluate('ln(e)'), closeTo(1, 1e-9)));
    test('ln domain error throws', () {
      expect(
        () => engine.evaluate('ln(0)'),
        throwsA(isA<CalculatorException>()),
      );
    });
    test('log(100) == 2', () {
      expect(engine.evaluate('log(100)'), closeTo(2, 1e-9));
    });
    test('log domain error throws', () {
      expect(
        () => engine.evaluate('log(-5)'),
        throwsA(isA<CalculatorException>()),
      );
    });
    test('abs(-7) == 7', () => expect(engine.evaluate('abs(-7)'), 7));
  });

  group('composite expressions', () {
    final engine = CalculatorEngine();

    test(
      'nested functions',
      () => expect(engine.evaluate('sqrt(16)+sqrt(9)'), 7),
    );
    test(
      'function with expression argument',
      () => expect(engine.evaluate('sqrt(4+5)'), 3),
    );
    test(
      'implicit-style expression with constant',
      () => expect(engine.evaluate('2*pi*3'), closeTo(18.8495559, 1e-6)),
    );
  });
}

import 'dart:math' as math;

/// Angle unit used when evaluating trigonometric functions.
enum AngleMode { degrees, radians }

/// Thrown when an expression cannot be parsed or evaluated
/// (syntax errors, division by zero, domain errors, etc).
class CalculatorException implements Exception {
  final String message;
  const CalculatorException(this.message);

  @override
  String toString() => message;
}

enum _TokenType {
  number,
  plus,
  minus,
  star,
  slash,
  caret,
  percent,
  bang,
  lparen,
  rparen,
  identifier, // function names and constants
  end,
}

class _Token {
  final _TokenType type;
  final String text;
  final double? value;
  _Token(this.type, this.text, [this.value]);
}

List<_Token> _tokenize(String input) {
  final tokens = <_Token>[];
  var i = 0;
  final n = input.length;

  while (i < n) {
    final c = input[i];

    if (c == ' ' || c == '\t' || c == '\n') {
      i++;
      continue;
    }

    if (_isDigit(c) || c == '.') {
      final start = i;
      var sawDot = c == '.';
      i++;
      while (i < n && (_isDigit(input[i]) || (input[i] == '.' && !sawDot))) {
        if (input[i] == '.') sawDot = true;
        i++;
      }
      final text = input.substring(start, i);
      final value = double.tryParse(text);
      if (value == null) {
        throw CalculatorException('Invalid number "$text"');
      }
      tokens.add(_Token(_TokenType.number, text, value));
      continue;
    }

    if (_isAlpha(c)) {
      final start = i;
      i++;
      while (i < n && (_isAlpha(input[i]) || _isDigit(input[i]))) {
        i++;
      }
      tokens.add(_Token(_TokenType.identifier, input.substring(start, i)));
      continue;
    }

    switch (c) {
      case '+':
        tokens.add(_Token(_TokenType.plus, c));
        break;
      case '-':
      case '−': // unicode minus sign used by the display
        tokens.add(_Token(_TokenType.minus, c));
        break;
      case '*':
      case '×': // ×
        tokens.add(_Token(_TokenType.star, c));
        break;
      case '/':
      case '÷': // ÷
        tokens.add(_Token(_TokenType.slash, c));
        break;
      case '^':
        tokens.add(_Token(_TokenType.caret, c));
        break;
      case '%':
        tokens.add(_Token(_TokenType.percent, c));
        break;
      case '!':
        tokens.add(_Token(_TokenType.bang, c));
        break;
      case '(':
        tokens.add(_Token(_TokenType.lparen, c));
        break;
      case ')':
        tokens.add(_Token(_TokenType.rparen, c));
        break;
      case 'π': // π
        tokens.add(_Token(_TokenType.identifier, 'pi'));
        break;
      default:
        throw CalculatorException('Unexpected character "$c"');
    }
    i++;
  }

  tokens.add(_Token(_TokenType.end, ''));
  return tokens;
}

bool _isDigit(String c) => c.codeUnitAt(0) >= 48 && c.codeUnitAt(0) <= 57;

bool _isAlpha(String c) {
  final code = c.codeUnitAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

const _functionNames = {
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'ln',
  'log',
  'sqrt',
  'abs',
};

/// Recursive-descent parser/evaluator for calculator expressions.
///
/// Grammar (highest precedence last):
///   expression := term (('+' | '-') term)*
///   term       := unary (('*' | '/') unary)*
///   unary      := ('-' | '+')? power
///   power      := postfix ('^' unary)?          // right-associative
///   postfix    := primary ('!' | '%')*
///   primary    := NUMBER | CONST | FUNC '(' expression ')' | '(' expression ')'
class CalculatorEngine {
  final AngleMode angleMode;
  const CalculatorEngine({this.angleMode = AngleMode.degrees});

  /// Evaluates [expression] and returns the numeric result.
  /// Throws [CalculatorException] on any syntax, domain, or math error.
  double evaluate(String expression) {
    if (expression.trim().isEmpty) {
      throw const CalculatorException('Empty expression');
    }
    final parser = _Parser(_tokenize(expression), angleMode);
    final result = parser.parseExpression();
    parser._expect(_TokenType.end, 'end of expression');
    if (result.isNaN) {
      throw const CalculatorException('Math error');
    }
    if (result.isInfinite) {
      throw const CalculatorException('Result is too large');
    }
    return result;
  }
}

class _Parser {
  final List<_Token> tokens;
  final AngleMode angleMode;
  int pos = 0;

  _Parser(this.tokens, this.angleMode);

  _Token get _current => tokens[pos];

  bool _match(_TokenType type) {
    if (_current.type == type) {
      pos++;
      return true;
    }
    return false;
  }

  void _expect(_TokenType type, String description) {
    if (!_match(type)) {
      throw CalculatorException('Expected $description');
    }
  }

  double parseExpression() {
    var value = _parseTerm();
    while (true) {
      if (_match(_TokenType.plus)) {
        value += _parseTerm();
      } else if (_match(_TokenType.minus)) {
        value -= _parseTerm();
      } else {
        break;
      }
    }
    return value;
  }

  double _parseTerm() {
    var value = _parseUnary();
    while (true) {
      if (_match(_TokenType.star)) {
        value *= _parseUnary();
      } else if (_match(_TokenType.slash)) {
        final divisor = _parseUnary();
        if (divisor == 0) {
          throw const CalculatorException('Cannot divide by zero');
        }
        value /= divisor;
      } else {
        break;
      }
    }
    return value;
  }

  double _parseUnary() {
    if (_match(_TokenType.minus)) {
      return -_parseUnary();
    }
    if (_match(_TokenType.plus)) {
      return _parseUnary();
    }
    return _parsePower();
  }

  double _parsePower() {
    final base = _parsePostfix();
    if (_match(_TokenType.caret)) {
      final exponent = _parseUnary(); // right-associative
      final result = math.pow(base, exponent).toDouble();
      return result;
    }
    return base;
  }

  double _parsePostfix() {
    var value = _parsePrimary();
    while (true) {
      if (_match(_TokenType.bang)) {
        value = _factorial(value);
      } else if (_match(_TokenType.percent)) {
        value = value / 100;
      } else {
        break;
      }
    }
    return value;
  }

  double _parsePrimary() {
    final token = _current;

    if (_match(_TokenType.number)) {
      return token.value!;
    }

    if (_match(_TokenType.lparen)) {
      final value = parseExpression();
      _expect(_TokenType.rparen, '")"');
      return value;
    }

    if (token.type == _TokenType.identifier) {
      pos++;
      final name = token.text.toLowerCase();

      if (name == 'pi') return math.pi;
      if (name == 'e') return math.e;

      if (_functionNames.contains(name)) {
        _expect(_TokenType.lparen, '"(" after $name');
        final arg = parseExpression();
        _expect(_TokenType.rparen, '")"');
        return _applyFunction(name, arg);
      }

      throw CalculatorException('Unknown identifier "${token.text}"');
    }

    if (token.type == _TokenType.minus) {
      pos++;
      return -_parseUnary();
    }

    throw const CalculatorException('Unexpected end of expression');
  }

  double _applyFunction(String name, double arg) {
    switch (name) {
      case 'sin':
        return math.sin(_toRadians(arg));
      case 'cos':
        return math.cos(_toRadians(arg));
      case 'tan':
        return math.tan(_toRadians(arg));
      case 'asin':
        if (arg < -1 || arg > 1) {
          throw const CalculatorException('asin domain is [-1, 1]');
        }
        return _fromRadians(math.asin(arg));
      case 'acos':
        if (arg < -1 || arg > 1) {
          throw const CalculatorException('acos domain is [-1, 1]');
        }
        return _fromRadians(math.acos(arg));
      case 'atan':
        return _fromRadians(math.atan(arg));
      case 'ln':
        if (arg <= 0) {
          throw const CalculatorException('ln domain is x > 0');
        }
        return math.log(arg);
      case 'log':
        if (arg <= 0) {
          throw const CalculatorException('log domain is x > 0');
        }
        return math.log(arg) / math.ln10;
      case 'sqrt':
        if (arg < 0) {
          throw const CalculatorException('sqrt domain is x >= 0');
        }
        return math.sqrt(arg);
      case 'abs':
        return arg.abs();
      default:
        throw CalculatorException('Unknown function "$name"');
    }
  }

  double _toRadians(double value) =>
      angleMode == AngleMode.degrees ? value * math.pi / 180 : value;

  double _fromRadians(double value) =>
      angleMode == AngleMode.degrees ? value * 180 / math.pi : value;

  double _factorial(double value) {
    if (value < 0 || value != value.roundToDouble() || value > 170) {
      throw const CalculatorException('Factorial requires 0-170 integer');
    }
    var result = 1.0;
    for (var i = 2; i <= value.round(); i++) {
      result *= i;
    }
    return result;
  }
}

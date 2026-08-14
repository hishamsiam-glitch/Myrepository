import 'calculator_engine.dart';
import 'number_format.dart';

final RegExp _numberInProgress = RegExp(r'^-?[0-9]*\.?[0-9]*$');
const _closingFunctionsAndConstants = {')', 'π', 'e'};

/// Holds the token-based expression being built by the on-screen keypad
/// and drives evaluation through [CalculatorEngine].
///
/// Working with discrete tokens (rather than a raw string) makes
/// backspace and "implicit multiplication" (e.g. `2π` -> `2×π`)
/// unambiguous, since we always know whether the previous token was a
/// number, a function call, a constant, or an operator.
class CalculatorController {
  final List<String> tokens = [];
  AngleMode angleMode;
  String errorMessage = '';
  bool _justEvaluated = false;

  CalculatorController({this.angleMode = AngleMode.degrees});

  String get expression => tokens.join();

  bool get hasError => errorMessage.isNotEmpty;

  void inputDigit(String digit) {
    _consumeJustEvaluatedForDigit();
    if (tokens.isNotEmpty && _numberInProgress.hasMatch(tokens.last)) {
      tokens[tokens.length - 1] = tokens.last + digit;
    } else {
      tokens.add(digit);
    }
    errorMessage = '';
  }

  void inputDot() {
    _consumeJustEvaluatedForDigit();
    if (tokens.isNotEmpty && _numberInProgress.hasMatch(tokens.last)) {
      if (!tokens.last.contains('.')) {
        tokens[tokens.length - 1] = tokens.last.isEmpty
            ? '0.'
            : '${tokens.last}.';
      }
    } else {
      tokens.add('0.');
    }
    errorMessage = '';
  }

  void inputOperator(String op) {
    _justEvaluated = false;
    if (tokens.isEmpty) {
      if (op == '-') tokens.add('-');
      return;
    }
    final last = tokens.last;
    final isOperator = {'+', '-', '×', '÷', '^'}.contains(last);
    if (isOperator) {
      tokens[tokens.length - 1] = op;
    } else {
      tokens.add(op);
    }
    errorMessage = '';
  }

  void inputFunction(String fn) {
    _consumeJustEvaluatedForDigit();
    _insertImplicitMultiplicationIfNeeded();
    tokens.add('$fn(');
    errorMessage = '';
  }

  void inputConstant(String constant) {
    _consumeJustEvaluatedForDigit();
    _insertImplicitMultiplicationIfNeeded();
    tokens.add(constant);
    errorMessage = '';
  }

  void inputOpenParen() {
    _consumeJustEvaluatedForDigit();
    _insertImplicitMultiplicationIfNeeded();
    tokens.add('(');
    errorMessage = '';
  }

  void inputCloseParen() {
    final opens = tokens.where((t) => t == '(' || t.endsWith('(')).length;
    final closes = tokens.where((t) => t == ')').length;
    if (opens > closes) {
      tokens.add(')');
      errorMessage = '';
    }
  }

  void inputPostfix(String symbol) {
    if (tokens.isEmpty) return;
    final last = tokens.last;
    final isOperand =
        _numberInProgress.hasMatch(last) && last != '' && last != '-';
    if (isOperand || _closingFunctionsAndConstants.contains(last)) {
      tokens.add(symbol);
      _justEvaluated = false;
      errorMessage = '';
    }
  }

  void toggleSign() {
    if (tokens.isEmpty) return;
    final last = tokens.last;
    if (_numberInProgress.hasMatch(last) && last.isNotEmpty && last != '-') {
      tokens[tokens.length - 1] = last.startsWith('-')
          ? last.substring(1)
          : '-$last';
    } else if (last == ')' || last == 'π' || last == 'e') {
      // Wrap the whole trailing expression in a unary minus by
      // inserting a "-1×" before the matching open paren / constant.
      final insertAt = _matchingOpenIndexFromEnd();
      tokens.insert(insertAt, '(');
      tokens.insert(insertAt, '×');
      tokens.insert(insertAt, '1');
      tokens.insert(insertAt, '-');
      tokens.add(')');
    }
  }

  void applyReciprocal() {
    if (tokens.isEmpty) return;
    final last = tokens.last;
    if (_numberInProgress.hasMatch(last) && last.isNotEmpty && last != '-') {
      tokens.removeLast();
      tokens.addAll(['1', '÷', '(', last, ')']);
    } else if (last == ')' || last == 'π' || last == 'e') {
      final insertAt = _matchingOpenIndexFromEnd();
      tokens.insert(insertAt, '(');
      tokens.insert(insertAt, '÷');
      tokens.insert(insertAt, '1');
      tokens.add(')');
    }
  }

  void inputSquare() {
    if (tokens.isEmpty) return;
    final last = tokens.last;
    final isOperand =
        _numberInProgress.hasMatch(last) && last.isNotEmpty && last != '-';
    if (isOperand || _closingFunctionsAndConstants.contains(last)) {
      tokens.add('^2');
      _justEvaluated = false;
      errorMessage = '';
    }
  }

  int _matchingOpenIndexFromEnd() {
    if (tokens.last != ')') return tokens.length - 1;
    var depth = 0;
    for (var i = tokens.length - 1; i >= 0; i--) {
      final t = tokens[i];
      if (t == ')') depth++;
      if (t == '(' || t.endsWith('(')) {
        depth--;
        if (depth == 0) return i;
      }
    }
    return 0;
  }

  void backspace() {
    if (tokens.isEmpty) return;
    final last = tokens.last;
    if (last.length > 1) {
      tokens[tokens.length - 1] = last.substring(0, last.length - 1);
    } else {
      tokens.removeLast();
    }
    errorMessage = '';
  }

  void clearAll() {
    tokens.clear();
    errorMessage = '';
    _justEvaluated = false;
  }

  /// Evaluates the current expression, auto-closing any unmatched
  /// parentheses. Returns the formatted result, or null if evaluation
  /// failed (in which case [errorMessage] is set).
  String? evaluate() {
    if (tokens.isEmpty) return null;
    final opens = tokens.where((t) => t == '(' || t.endsWith('(')).length;
    final closes = tokens.where((t) => t == ')').length;
    final toEvaluate = expression + ')' * (opens - closes).clamp(0, 1 << 16);

    try {
      final value = CalculatorEngine(angleMode: angleMode).evaluate(toEvaluate);
      final formatted = formatResult(value);
      tokens
        ..clear()
        ..add(formatted);
      _justEvaluated = true;
      errorMessage = '';
      return formatted;
    } on CalculatorException catch (e) {
      errorMessage = e.message;
      return null;
    }
  }

  /// Best-effort live preview of the result without mutating state.
  /// Returns null while the expression is incomplete or invalid.
  String? computePreview() {
    if (tokens.isEmpty || _justEvaluated) return null;
    final last = tokens.last;
    final isIncomplete =
        last.endsWith('(') || {'+', '-', '×', '÷', '^'}.contains(last);
    if (isIncomplete) return null;

    final opens = tokens.where((t) => t == '(' || t.endsWith('(')).length;
    final closes = tokens.where((t) => t == ')').length;
    final toEvaluate = expression + ')' * (opens - closes).clamp(0, 1 << 16);

    try {
      final value = CalculatorEngine(angleMode: angleMode).evaluate(toEvaluate);
      return formatResult(value);
    } on CalculatorException {
      return null;
    }
  }

  void _consumeJustEvaluatedForDigit() {
    if (_justEvaluated) {
      tokens.clear();
      _justEvaluated = false;
    }
  }

  void _insertImplicitMultiplicationIfNeeded() {
    if (tokens.isEmpty) return;
    final last = tokens.last;
    final endsWithOperand =
        _numberInProgress.hasMatch(last) &&
            last.isNotEmpty &&
            last != '-' &&
            last != '.' ||
        _closingFunctionsAndConstants.contains(last);
    if (endsWithOperand) {
      tokens.add('×');
    }
  }
}

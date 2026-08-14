import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'calculator_controller.dart';
import 'calculator_engine.dart';

void main() {
  runApp(const CalculatorApp());
}

class CalculatorApp extends StatelessWidget {
  const CalculatorApp({super.key});

  @override
  Widget build(BuildContext context) {
    final seed = const Color(0xFF3D5AFE);
    return MaterialApp(
      title: 'Scientific Calculator',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: seed),
        useMaterial3: true,
        brightness: Brightness.light,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: seed,
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        brightness: Brightness.dark,
      ),
      themeMode: ThemeMode.system,
      home: const CalculatorScreen(),
    );
  }
}

class CalculatorScreen extends StatefulWidget {
  const CalculatorScreen({super.key});

  @override
  State<CalculatorScreen> createState() => _CalculatorScreenState();
}

class _CalculatorScreenState extends State<CalculatorScreen> {
  final _controller = CalculatorController();
  bool _scientificMode = true;

  void _update(VoidCallback action) {
    setState(action);
  }

  void _onDigit(String d) => _update(() => _controller.inputDigit(d));
  void _onDot() => _update(() => _controller.inputDot());
  void _onOperator(String op) => _update(() => _controller.inputOperator(op));
  void _onFunction(String fn) => _update(() => _controller.inputFunction(fn));
  void _onConstant(String c) => _update(() => _controller.inputConstant(c));
  void _onOpenParen() => _update(() => _controller.inputOpenParen());
  void _onCloseParen() => _update(() => _controller.inputCloseParen());
  void _onPostfix(String s) => _update(() => _controller.inputPostfix(s));
  void _onSquare() => _update(() => _controller.inputSquare());
  void _onReciprocal() => _update(() => _controller.applyReciprocal());
  void _onToggleSign() => _update(() => _controller.toggleSign());
  void _onBackspace() => _update(() => _controller.backspace());
  void _onClear() => _update(() => _controller.clearAll());
  void _onEquals() => _update(() => _controller.evaluate());

  void _onToggleAngleMode() {
    _update(() {
      _controller.angleMode = _controller.angleMode == AngleMode.degrees
          ? AngleMode.radians
          : AngleMode.degrees;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final preview = _controller.computePreview();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calculator'),
        actions: [
          TextButton(
            onPressed: _onToggleAngleMode,
            child: Text(
              _controller.angleMode == AngleMode.degrees ? 'DEG' : 'RAD',
              style: TextStyle(color: theme.colorScheme.onSurface),
            ),
          ),
          IconButton(
            tooltip: _scientificMode
                ? 'Switch to basic'
                : 'Switch to scientific',
            icon: Icon(_scientificMode ? Icons.calculate : Icons.functions),
            onPressed: () => _update(() => _scientificMode = !_scientificMode),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              flex: 2,
              child: _Display(
                expression: _controller.expression,
                preview: preview,
                errorMessage: _controller.errorMessage,
              ),
            ),
            Expanded(
              flex: 5,
              child: _Keypad(
                scientificMode: _scientificMode,
                onDigit: _onDigit,
                onDot: _onDot,
                onOperator: _onOperator,
                onFunction: _onFunction,
                onConstant: _onConstant,
                onOpenParen: _onOpenParen,
                onCloseParen: _onCloseParen,
                onPostfix: _onPostfix,
                onSquare: _onSquare,
                onReciprocal: _onReciprocal,
                onToggleSign: _onToggleSign,
                onBackspace: _onBackspace,
                onClear: _onClear,
                onEquals: _onEquals,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Display extends StatelessWidget {
  final String expression;
  final String? preview;
  final String errorMessage;

  const _Display({
    required this.expression,
    required this.preview,
    required this.errorMessage,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasError = errorMessage.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (hasError)
            Text(
              errorMessage,
              style: TextStyle(color: theme.colorScheme.error, fontSize: 18),
            )
          else if (preview != null)
            Text(
              '= $preview',
              style: TextStyle(
                color: theme.colorScheme.onSurfaceVariant,
                fontSize: 20,
              ),
            ),
          const SizedBox(height: 8),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerRight,
            child: Text(
              expression.isEmpty ? '0' : expression,
              key: const Key('display'),
              semanticsLabel:
                  'Expression: ${expression.isEmpty ? "0" : expression}',
              style: theme.textTheme.displayMedium?.copyWith(
                fontWeight: FontWeight.w400,
              ),
              maxLines: 2,
            ),
          ),
        ],
      ),
    );
  }
}

class _Keypad extends StatelessWidget {
  final bool scientificMode;
  final void Function(String) onDigit;
  final VoidCallback onDot;
  final void Function(String) onOperator;
  final void Function(String) onFunction;
  final void Function(String) onConstant;
  final VoidCallback onOpenParen;
  final VoidCallback onCloseParen;
  final void Function(String) onPostfix;
  final VoidCallback onSquare;
  final VoidCallback onReciprocal;
  final VoidCallback onToggleSign;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final VoidCallback onEquals;

  const _Keypad({
    required this.scientificMode,
    required this.onDigit,
    required this.onDot,
    required this.onOperator,
    required this.onFunction,
    required this.onConstant,
    required this.onOpenParen,
    required this.onCloseParen,
    required this.onPostfix,
    required this.onSquare,
    required this.onReciprocal,
    required this.onToggleSign,
    required this.onBackspace,
    required this.onClear,
    required this.onEquals,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rows = <List<_KeySpec>>[
      [
        _KeySpec('AC', onTap: onClear, kind: _KeyKind.utility),
        _KeySpec('(', onTap: onOpenParen, kind: _KeyKind.utility),
        _KeySpec(')', onTap: onCloseParen, kind: _KeyKind.utility),
        _KeySpec('%', onTap: () => onPostfix('%'), kind: _KeyKind.utility),
        _KeySpec(
          '⌫',
          onTap: onBackspace,
          kind: _KeyKind.utility,
          semanticLabel: 'Backspace',
          icon: Icons.backspace_outlined,
        ),
      ],
      if (scientificMode) ...[
        [
          _KeySpec('sin', onTap: () => onFunction('sin'), kind: _KeyKind.sci),
          _KeySpec('cos', onTap: () => onFunction('cos'), kind: _KeyKind.sci),
          _KeySpec('tan', onTap: () => onFunction('tan'), kind: _KeyKind.sci),
          _KeySpec('x^y', onTap: () => onOperator('^'), kind: _KeyKind.sci),
          _KeySpec(
            '√',
            onTap: () => onFunction('sqrt'),
            kind: _KeyKind.sci,
            semanticLabel: 'Square root',
          ),
        ],
        [
          _KeySpec('ln', onTap: () => onFunction('ln'), kind: _KeyKind.sci),
          _KeySpec('log', onTap: () => onFunction('log'), kind: _KeyKind.sci),
          _KeySpec(
            'π',
            onTap: () => onConstant('π'),
            kind: _KeyKind.sci,
            semanticLabel: 'Pi',
          ),
          _KeySpec('e', onTap: () => onConstant('e'), kind: _KeyKind.sci),
          _KeySpec(
            'x!',
            onTap: () => onPostfix('!'),
            kind: _KeyKind.sci,
            semanticLabel: 'Factorial',
          ),
        ],
      ],
      [
        _KeySpec('7', onTap: () => onDigit('7')),
        _KeySpec('8', onTap: () => onDigit('8')),
        _KeySpec('9', onTap: () => onDigit('9')),
        _KeySpec('÷', onTap: () => onOperator('÷'), kind: _KeyKind.operatorK),
        _KeySpec(
          '1/x',
          onTap: onReciprocal,
          kind: _KeyKind.sci,
          semanticLabel: 'Reciprocal',
        ),
      ],
      [
        _KeySpec('4', onTap: () => onDigit('4')),
        _KeySpec('5', onTap: () => onDigit('5')),
        _KeySpec('6', onTap: () => onDigit('6')),
        _KeySpec('×', onTap: () => onOperator('×'), kind: _KeyKind.operatorK),
        _KeySpec(
          'x²',
          onTap: onSquare,
          kind: _KeyKind.sci,
          semanticLabel: 'Square',
        ),
      ],
      [
        _KeySpec('1', onTap: () => onDigit('1')),
        _KeySpec('2', onTap: () => onDigit('2')),
        _KeySpec('3', onTap: () => onDigit('3')),
        _KeySpec('−', onTap: () => onOperator('-'), kind: _KeyKind.operatorK),
        _KeySpec(
          '±',
          onTap: onToggleSign,
          kind: _KeyKind.sci,
          semanticLabel: 'Toggle sign',
        ),
      ],
      [
        _KeySpec('0', onTap: () => onDigit('0')),
        _KeySpec('.', onTap: onDot),
        _KeySpec('+', onTap: () => onOperator('+'), kind: _KeyKind.operatorK),
        _KeySpec('=', onTap: onEquals, kind: _KeyKind.equals, flex: 2),
      ],
    ];

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
      child: Column(
        children: [
          for (final row in rows)
            Expanded(
              child: _KeyRow(keys: row, theme: theme),
            ),
        ],
      ),
    );
  }
}

enum _KeyKind { digit, operatorK, utility, sci, equals }

class _KeySpec {
  final String label;
  final VoidCallback onTap;
  final _KeyKind kind;
  final int flex;
  final String? semanticLabel;
  final IconData? icon;

  const _KeySpec(
    this.label, {
    required this.onTap,
    this.kind = _KeyKind.digit,
    this.flex = 1,
    this.semanticLabel,
    this.icon,
  });
}

class _KeyRow extends StatelessWidget {
  final List<_KeySpec> keys;
  final ThemeData theme;

  const _KeyRow({required this.keys, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          for (final key in keys)
            Expanded(
              flex: key.flex,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: _CalcButton(spec: key, theme: theme),
              ),
            ),
        ],
      ),
    );
  }
}

class _CalcButton extends StatelessWidget {
  final _KeySpec spec;
  final ThemeData theme;

  const _CalcButton({required this.spec, required this.theme});

  @override
  Widget build(BuildContext context) {
    final scheme = theme.colorScheme;
    Color background;
    Color foreground;

    switch (spec.kind) {
      case _KeyKind.operatorK:
        background = scheme.primaryContainer;
        foreground = scheme.onPrimaryContainer;
        break;
      case _KeyKind.equals:
        background = scheme.primary;
        foreground = scheme.onPrimary;
        break;
      case _KeyKind.utility:
        background = scheme.secondaryContainer;
        foreground = scheme.onSecondaryContainer;
        break;
      case _KeyKind.sci:
        background = scheme.surfaceContainerHighest;
        foreground = scheme.onSurfaceVariant;
        break;
      case _KeyKind.digit:
        background = scheme.surfaceContainerHigh;
        foreground = scheme.onSurface;
        break;
    }

    return Material(
      key: Key(spec.label),
      color: background,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: () {
          HapticFeedback.selectionClick();
          spec.onTap();
        },
        child: Center(
          child: Semantics(
            label: spec.semanticLabel ?? spec.label,
            button: true,
            child: spec.icon != null
                ? Icon(spec.icon, color: foreground, size: 22)
                : Text(
                    spec.label,
                    style: TextStyle(
                      fontSize: spec.kind == _KeyKind.sci ? 16 : 22,
                      fontWeight: FontWeight.w500,
                      color: foreground,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

/// Formats a numeric result for display, trimming floating point noise
/// and switching to scientific notation for very large/small magnitudes.
String formatResult(double value) {
  if (value == 0) return '0';

  final absValue = value.abs();
  if (absValue >= 1e15 || (absValue < 1e-9 && absValue > 0)) {
    return value
        .toStringAsExponential(6)
        .replaceAllMapped(RegExp(r'e([+-])(\d+)'), (m) => 'e${m[1]}${m[2]}');
  }

  if (value == value.roundToDouble() && absValue < 1e15) {
    return value.toStringAsFixed(0);
  }

  var text = value.toStringAsFixed(10);
  text = text.contains('.')
      ? text.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '')
      : text;
  return text;
}

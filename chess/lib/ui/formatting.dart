/// Human-friendly timestamps for the saved-game and log lists.
String formatRelative(DateTime when, {DateTime? now}) {
  final reference = now ?? DateTime.now();
  final difference = reference.difference(when);

  if (difference.inSeconds < 60) return 'just now';
  if (difference.inMinutes < 60) {
    final value = difference.inMinutes;
    return '$value ${_plural(value, 'minute')} ago';
  }
  if (difference.inHours < 24) {
    final value = difference.inHours;
    return '$value ${_plural(value, 'hour')} ago';
  }
  if (difference.inDays < 7) {
    final value = difference.inDays;
    return value == 1 ? 'yesterday' : '$value days ago';
  }
  return formatDate(when);
}

String formatDate(DateTime when) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', //
  ];
  return '${when.day} ${months[when.month - 1]} ${when.year}';
}

String formatDateTime(DateTime when) {
  final hour = when.hour.toString().padLeft(2, '0');
  final minute = when.minute.toString().padLeft(2, '0');
  return '${formatDate(when)} at $hour:$minute';
}

String _plural(int value, String word) => value == 1 ? word : '${word}s';

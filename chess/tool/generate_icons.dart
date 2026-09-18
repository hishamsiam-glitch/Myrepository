// Generates the Android launcher icons and the Play-Store-sized app icon.
//
// Run from the `chess/` directory:
//
//     dart run tool/generate_icons.dart
//
// The artwork is defined as maths rather than a bitmap, so the icons are
// reproducible and every density is rendered at full quality instead of being
// resampled from one source image. There are no dependencies beyond the Dart
// SDK: `_writePng` is a minimal PNG encoder over `dart:io`'s zlib.
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

/// Board colours, matching `lib/ui/board_theme.dart`.
const _light = (0xEF, 0xD9, 0xB4);
const _dark = (0xB0, 0x7D, 0x4F);
const _pieceFill = (0xFD, 0xFB, 0xF7);
const _pieceEdge = (0x3E, 0x32, 0x2B);

/// Launcher icon densities. Legacy icons are 48dp, adaptive foregrounds 108dp.
const Map<String, double> _densities = {
  'mdpi': 1,
  'hdpi': 1.5,
  'xhdpi': 2,
  'xxhdpi': 3,
  'xxxhdpi': 4,
};

void main() {
  final resDir = Directory('android/app/src/main/res');
  if (!resDir.existsSync()) {
    stderr.writeln('Run this from the chess/ project directory.');
    exit(1);
  }

  for (final entry in _densities.entries) {
    final dir = Directory('${resDir.path}/mipmap-${entry.key}')
      ..createSync(recursive: true);
    final legacy = (48 * entry.value).round();
    final foreground = (108 * entry.value).round();

    _writePng('${dir.path}/ic_launcher.png', _render(legacy, adaptive: false));
    _writePng(
      '${dir.path}/ic_launcher_round.png',
      _render(legacy, adaptive: false, circular: true),
    );
    _writePng(
      '${dir.path}/ic_launcher_foreground.png',
      _render(foreground, adaptive: true),
    );
    stdout.writeln('mipmap-${entry.key}: ${legacy}px legacy, '
        '${foreground}px adaptive foreground');
  }

  // A 512x512 icon, the size the Play Console asks for.
  final storeDir = Directory('store_assets')..createSync(recursive: true);
  _writePng('${storeDir.path}/icon_512x512.png', _render(512, adaptive: false));
  stdout.writeln('store_assets/icon_512x512.png: 512px');
}

/// Renders one square icon.
///
/// [adaptive] draws only the piece on a transparent background, inside the
/// 66% safe zone an adaptive icon guarantees will not be masked away — the
/// board colour comes from `@color/ic_launcher_background`. Otherwise the
/// checkerboard is drawn too, clipped to a rounded square (or a circle, for
/// the round variant).
Uint8List _render(int size, {required bool adaptive, bool circular = false}) {
  final pixels = Uint8List(size * size * 4);
  // 4x4 supersampling: cheap, and enough to keep the curves smooth.
  const samples = 4;
  final step = 1 / (size * samples);

  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var r = 0.0, g = 0.0, b = 0.0, a = 0.0;
      for (var sy = 0; sy < samples; sy++) {
        for (var sx = 0; sx < samples; sx++) {
          final u = (x * samples + sx + 0.5) * step;
          final v = (y * samples + sy + 0.5) * step;
          final sample = _sampleColor(u, v, adaptive, circular);
          r += sample.$1;
          g += sample.$2;
          b += sample.$3;
          a += sample.$4;
        }
      }
      const total = samples * samples;
      final index = (y * size + x) * 4;
      pixels[index] = (r / total).round();
      pixels[index + 1] = (g / total).round();
      pixels[index + 2] = (b / total).round();
      pixels[index + 3] = (a / total).round();
    }
  }
  return pixels;
}

/// The colour at (u, v), both in 0..1 across the icon.
(double, double, double, double) _sampleColor(
  double u,
  double v,
  bool adaptive,
  bool circular,
) {
  // The piece occupies the middle of the icon. On an adaptive foreground the
  // safe zone is the centre 66%, so the piece is drawn smaller there.
  final scale = adaptive ? 0.62 : 0.86;
  final pieceU = (u - 0.5) / scale + 0.5;
  final pieceV = (v - 0.5) / scale + 0.5;

  if (_inKnight(pieceU, pieceV)) {
    return (_pieceFill.$1 + 0.0, _pieceFill.$2 + 0.0, _pieceFill.$3 + 0.0, 255);
  }
  if (_inKnight(pieceU, pieceV, outline: true)) {
    return (_pieceEdge.$1 + 0.0, _pieceEdge.$2 + 0.0, _pieceEdge.$3 + 0.0, 255);
  }
  if (adaptive) return (0, 0, 0, 0);

  // Outside the piece: the board, clipped to the icon's shape.
  final inside = circular
      ? math.sqrt(math.pow(u - 0.5, 2) + math.pow(v - 0.5, 2)) <= 0.5
      : _inRoundedSquare(u, v, radius: 0.16);
  if (!inside) return (0, 0, 0, 0);

  // A 4x4 checkerboard reads as "chess" even at 48px.
  final darkSquare = ((u * 4).floor() + (v * 4).floor()) % 2 == 0;
  final square = darkSquare ? _dark : _light;
  return (square.$1 + 0.0, square.$2 + 0.0, square.$3 + 0.0, 255);
}

bool _inRoundedSquare(double u, double v, {required double radius}) {
  final dx = math.max(0.0, math.max(radius - u, u - (1 - radius)));
  final dy = math.max(0.0, math.max(radius - v, v - (1 - radius)));
  return dx * dx + dy * dy <= radius * radius;
}

/// A stylised knight, built from a handful of circles, wedges and bars.
///
/// With [outline] the shape is grown slightly, which draws a dark rim around
/// the white piece so it stays legible on the light squares.
bool _inKnight(double u, double v, {bool outline = false}) {
  final grow = outline ? 0.022 : 0.0;

  // Base: a plinth with a lip, so the piece looks like it stands on the board.
  if (_bar(u, v, 0.255 - grow, 0.745 + grow, 0.845 - grow, 0.895 + grow)) {
    return true;
  }
  if (_bar(u, v, 0.295 - grow, 0.705 + grow, 0.795 - grow, 0.850 + grow)) {
    return true;
  }

  // Neck and chest: a wedge widening towards the base.
  final chestTop = 0.40, chestBottom = 0.80;
  if (v >= chestTop - grow && v <= chestBottom + grow) {
    final t = ((v - chestTop) / (chestBottom - chestTop)).clamp(0.0, 1.0);
    final left = 0.395 - 0.100 * t * t - grow;
    final right = 0.610 + 0.075 * t + grow;
    if (u >= left && u <= right) return true;
  }

  // Head: an oval tilted towards the muzzle.
  if (_oval(u, v, 0.505, 0.345, 0.125 + grow, 0.105 + grow)) return true;
  // Muzzle, reaching to the right.
  if (_oval(u, v, 0.630, 0.395, 0.105 + grow, 0.072 + grow)) return true;
  // Forehead, joining head to mane.
  if (_oval(u, v, 0.455, 0.290, 0.105 + grow, 0.095 + grow)) return true;

  // Mane: a band down the back of the head.
  if (v >= 0.215 - grow && v <= 0.470 + grow) {
    final t = ((v - 0.215) / 0.255).clamp(0.0, 1.0);
    final left = 0.335 - 0.035 * t - grow;
    final right = 0.445 + 0.020 * t + grow;
    if (u >= left && u <= right) return true;
  }

  // Ear.
  if (_triangle(
    u,
    v,
    (0.395, 0.260 - grow),
    (0.470, 0.255 - grow),
    (0.430, 0.150 - grow * 2),
  )) {
    return true;
  }

  return false;
}

bool _bar(double u, double v, double left, double right, double top,
        double bottom) =>
    u >= left && u <= right && v >= top && v <= bottom;

bool _oval(double u, double v, double cx, double cy, double rx, double ry) {
  final dx = (u - cx) / rx;
  final dy = (v - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

bool _triangle(
  double u,
  double v,
  (double, double) a,
  (double, double) b,
  (double, double) c,
) {
  double sign((double, double) p, (double, double) q) =>
      (u - q.$1) * (p.$2 - q.$2) - (p.$1 - q.$1) * (v - q.$2);
  final d1 = sign(a, b);
  final d2 = sign(b, c);
  final d3 = sign(c, a);
  final hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  final hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/// Writes 8-bit RGBA [pixels] as a PNG.
void _writePng(String path, Uint8List pixels) {
  final size = math.sqrt(pixels.length / 4).round();
  final raw = BytesBuilder();
  for (var y = 0; y < size; y++) {
    raw.addByte(0); // filter type: none
    raw.add(pixels.sublist(y * size * 4, (y + 1) * size * 4));
  }

  final ihdr = BytesBuilder()
    ..add(_be32(size))
    ..add(_be32(size))
    ..addByte(8) // bit depth
    ..addByte(6) // colour type: RGBA
    ..addByte(0) // compression
    ..addByte(0) // filter
    ..addByte(0); // interlace

  final out = BytesBuilder()
    ..add(const [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    ..add(_chunk('IHDR', ihdr.toBytes()))
    ..add(_chunk(
      'IDAT',
      Uint8List.fromList(ZLibCodec(level: 9).encode(raw.toBytes())),
    ))
    ..add(_chunk('IEND', Uint8List(0)));

  File(path).writeAsBytesSync(out.toBytes());
}

Uint8List _be32(int value) => Uint8List(4)
  ..[0] = (value >> 24) & 0xFF
  ..[1] = (value >> 16) & 0xFF
  ..[2] = (value >> 8) & 0xFF
  ..[3] = value & 0xFF;

Uint8List _chunk(String type, Uint8List data) {
  final typeBytes = Uint8List.fromList(ascii.encode(type));
  final body = Uint8List.fromList([...typeBytes, ...data]);
  return Uint8List.fromList([
    ..._be32(data.length),
    ...body,
    ..._be32(_crc32(body)),
  ]);
}

final List<int> _crcTable = List<int>.generate(256, (i) {
  var c = i;
  for (var k = 0; k < 8; k++) {
    c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
  }
  return c;
});

int _crc32(List<int> bytes) {
  var crc = 0xFFFFFFFF;
  for (final byte in bytes) {
    crc = _crcTable[(crc ^ byte) & 0xFF] ^ (crc >> 8);
  }
  return crc ^ 0xFFFFFFFF;
}

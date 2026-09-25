import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the 3D viewer page is bundled as an asset', () async {
    final html = await rootBundle.loadString('assets/web/viewer.html');
    expect(html, contains('<html'));
    expect(html, contains('window.setScene'));
    expect(html.length, greaterThan(100000), reason: 'three.js should be inlined');
  });
}

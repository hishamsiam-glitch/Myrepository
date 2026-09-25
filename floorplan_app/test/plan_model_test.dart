import 'package:flutter_test/flutter_test.dart';
import 'package:floorplan_tracer/model/plan.dart';

FloorPlan square({double size = 4}) {
  final p = FloorPlan.create('sq');
  final a = p.addVertex(0, 0);
  final b = p.addVertex(size, 0);
  final c = p.addVertex(size, size);
  final d = p.addVertex(0, size);
  p.addWall(a.id, b.id);
  p.addWall(b.id, c.id);
  p.addWall(c.id, d.id);
  p.addWall(d.id, a.id);
  return p;
}

void main() {
  test('wall length and total', () {
    final p = square(size: 3);
    expect(p.wallLength(p.walls.first), closeTo(3, 1e-9));
    expect(p.totalWallLength, closeTo(12, 1e-9));
  });

  test('setWallLength slides the end vertex and attached walls follow', () {
    final p = square();
    final w = p.walls.first; // a -> b along +x
    p.setWallLength(w, 6);
    expect(p.vertices[w.b]!.x, closeTo(6, 1e-9));
    // wall b->c now starts at x=6
    final w2 = p.walls[1];
    expect(p.vertices[w2.a]!.x, closeTo(6, 1e-9));
  });

  test('openings are clamped when the wall is shortened', () {
    final p = square();
    final w = p.walls.first;
    p.addOpening(w, OpeningType.door, 3.0, 0.9);
    p.setWallLength(w, 3.5);
    expect(w.openings.single.end, closeTo(3.5, 1e-9));
    p.setWallLength(w, 2.0);
    expect(w.openings, isEmpty);
  });

  test('closedLoops finds a single square room once', () {
    final p = square();
    final loops = p.closedLoops();
    expect(loops.length, 1);
    expect(loops.single.length, 4);
  });

  test('closedLoops finds two rooms sharing a wall', () {
    final p = square();
    // Add a second room to the right of the square, sharing the b-c wall.
    final b = p.walls[1].a;
    final c = p.walls[1].b;
    final e = p.addVertex(8, 0);
    final f = p.addVertex(8, 4);
    p.addWall(b, e.id);
    p.addWall(e.id, f.id);
    p.addWall(f.id, c);
    final loops = p.closedLoops();
    expect(loops.length, 2);
  });

  test('closedLoops ignores dangling walls and open chains', () {
    final p = FloorPlan.create('open');
    final a = p.addVertex(0, 0);
    final b = p.addVertex(4, 0);
    final c = p.addVertex(4, 4);
    p.addWall(a.id, b.id);
    p.addWall(b.id, c.id);
    expect(p.closedLoops(), isEmpty);
    final sq = square();
    final v = sq.addVertex(2, 2);
    sq.addWall(sq.walls.first.a, v.id); // dangling wall into the room
    final loops = sq.closedLoops();
    expect(loops.length, 1);
    expect(loops.single.length, 4);
    expect(loops.single.contains(v.id), isFalse);
  });

  test('json round trip preserves everything', () {
    final p = square();
    p.walls.first.skin = Skin(kind: SkinKind.pattern, pattern: 'tile', color: 0xFF112233, scale: 0.5);
    p.addOpening(p.walls[2], OpeningType.window, 1.0, 1.2);
    p.background = Background(imagePath: 'bg.jpg', metersPerPixel: 0.02);
    final q = FloorPlan.fromJson(p.toJson());
    expect(q.walls.length, 4);
    expect(q.walls.first.skin!.pattern, 'tile');
    expect(q.walls[2].openings.single.type, OpeningType.window);
    expect(q.walls[2].openings.single.sill, closeTo(0.9, 1e-9));
    expect(q.background!.metersPerPixel, closeTo(0.02, 1e-9));
    expect(q.totalWallLength, closeTo(p.totalWallLength, 1e-9));
  });

  test('removeWall prunes orphan vertices', () {
    final p = square();
    final w = p.walls.first;
    p.removeWall(w.id);
    expect(p.walls.length, 3);
    expect(p.vertices.length, 4); // all still used by other walls
    p.removeWall(p.walls.first.id);
    expect(p.vertices.length, 3);
  });

  test('scaleAll rescales geometry and openings', () {
    final p = square();
    p.addOpening(p.walls.first, OpeningType.door, 1, 1);
    p.scaleAll(2);
    expect(p.totalWallLength, closeTo(32, 1e-9));
    expect(p.walls.first.openings.single.offset, closeTo(2, 1e-9));
  });
}

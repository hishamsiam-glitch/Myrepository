import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makePattern } from './patterns.js';

// ---------------------------------------------------------------- bridge

function post(msg) {
  const s = JSON.stringify(msg);
  if (window.Flutter && window.Flutter.postMessage) {
    window.Flutter.postMessage(s);
  } else if (window.__messages) {
    window.__messages.push(msg);
  }
}

window.addEventListener('error', (e) => post({ type: 'error', message: String(e.message || e) }));

// ------------------------------------------------------------------ scene

let renderer;
let scene;
let camera;
let controls;
let root;
let ground;
let currentScene = null;
let selectedId = null;
const wallGroups = new Map(); // wallId -> Group
const textureCache = new Map();
const materialCache = new Map();
const failedImages = new Set();

const SELECT_COLOR = new THREE.Color(0x2e6f73);

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe7ee);
  scene.fog = new THREE.Fog(0xdfe7ee, 60, 140);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 300);
  camera.position.set(8, 7, 10);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.01;
  controls.minDistance = 0.3;
  controls.maxDistance = 120;
  controls.screenSpacePanning = false;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9aa8, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const grid = new THREE.GridHelper(100, 100, 0x9aa7b2, 0xc3ccd4);
  grid.position.y = -0.002;
  scene.add(grid);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ opacity: 0.22 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  ground.receiveShadow = true;
  scene.add(ground);

  root = new THREE.Group();
  scene.add(root);

  window.addEventListener('resize', onResize);
  setupPointer();
  renderer.setAnimationLoop(animate);
  post({ type: 'ready' });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------- materials

function skinKey(skin) {
  return [skin.kind, skin.color, skin.pattern, skin.scale, skin.image ? skin.image.length + skin.image.slice(-32) : ''].join('|');
}

function textureFor(skin) {
  const key = skinKey(skin);
  if (textureCache.has(key)) return textureCache.get(key);
  let tex = null;
  if (skin.kind === 'pattern') {
    tex = new THREE.CanvasTexture(makePattern(skin.pattern, skin.color));
  } else if (skin.kind === 'image' && skin.image && !failedImages.has(key)) {
    tex = new THREE.TextureLoader().load(
      skin.image,
      () => {
        // Texture arrived asynchronously; the next frame shows it.
      },
      undefined,
      () => {
        // Unreadable image: fall back to the plain colour and rebuild.
        failedImages.add(key);
        textureCache.delete(key);
        materialCache.delete(key);
        if (currentScene) setScene(currentScene);
        post({ type: 'error', message: 'Could not load a texture image' });
      },
    );
  }
  if (tex) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const s = Math.max(0.05, Number(skin.scale) || 1);
    tex.repeat.set(1 / s, 1 / s);
  }
  textureCache.set(key, tex);
  return tex;
}

function materialFor(skin) {
  const key = skinKey(skin);
  if (materialCache.has(key)) return materialCache.get(key);
  const tex = textureFor(skin);
  const mat = new THREE.MeshStandardMaterial({
    color: skin.kind === 'color' || !tex || skin.kind === 'image' ? new THREE.Color(skin.kind === 'image' && tex ? '#ffffff' : (skin.color || '#dddddd')) : 0xffffff,
    map: tex || null,
    roughness: 0.88,
    metalness: 0.0,
  });
  materialCache.set(key, mat);
  return mat;
}

// -------------------------------------------------------------- geometry

/**
 * A box spanning [x0,x1] x [y0,y1] x [-t/2,t/2] in wall-local space with
 * UVs in metres so textures tile continuously across the pieces of a wall.
 */
function boxPiece(x0, x1, y0, y1, t) {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 1e-4 || h <= 1e-4) return null;
  const geo = new THREE.BoxGeometry(w, h, t);
  geo.translate(x0 + w / 2, y0 + h / 2, 0);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    if (nz >= nx && nz >= ny) uv.setXY(i, x, y);
    else if (nx >= ny) uv.setXY(i, z, y);
    else uv.setXY(i, x, z);
  }
  uv.needsUpdate = true;
  return geo;
}

function addMesh(group, geo, material, wallId) {
  if (!geo) return;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.wallId = wallId;
  group.add(mesh);
}

const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 });
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });
const handleMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c27a, roughness: 0.3, metalness: 0.8 });
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x9fd3ff,
  transparent: true,
  opacity: 0.35,
  roughness: 0.05,
  metalness: 0.0,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function addFrame(group, x0, x1, y0, y1, t, wallId) {
  const f = 0.05;
  const depth = t + 0.02;
  addMesh(group, boxPiece(x0, x1, y0, y0 + f, depth), frameMaterial, wallId);
  addMesh(group, boxPiece(x0, x1, y1 - f, y1, depth), frameMaterial, wallId);
  addMesh(group, boxPiece(x0, x0 + f, y0, y1, depth), frameMaterial, wallId);
  addMesh(group, boxPiece(x1 - f, x1, y0, y1, depth), frameMaterial, wallId);
}

function buildWall(w) {
  const group = new THREE.Group();
  const L = Math.hypot(w.bx - w.ax, w.by - w.ay);
  const H = Math.max(0.05, w.height);
  const t = Math.max(0.02, w.thickness);
  const material = materialFor(w.skin).clone();
  group.userData.material = material;

  // Sort openings and clamp them to the wall.
  const openings = (w.openings || [])
    .map((o) => ({
      ...o,
      x0: Math.max(0, Math.min(L, o.offset)),
      x1: Math.max(0, Math.min(L, o.offset + o.width)),
      y0: Math.max(0, Math.min(H, o.sill)),
      y1: Math.max(0, Math.min(H, o.sill + o.height)),
    }))
    .filter((o) => o.x1 - o.x0 > 0.01 && o.y1 - o.y0 > 0.01)
    .sort((a, b) => a.x0 - b.x0);

  let cursor = 0;
  for (const o of openings) {
    if (o.x0 > cursor) addMesh(group, boxPiece(cursor, o.x0, 0, H, t), material, w.id);
    // Below and above the opening.
    if (o.y0 > 0.001) addMesh(group, boxPiece(o.x0, o.x1, 0, o.y0, t), material, w.id);
    if (o.y1 < H - 0.001) addMesh(group, boxPiece(o.x0, o.x1, o.y1, H, t), material, w.id);
    if (o.type === 'window') {
      addFrame(group, o.x0, o.x1, o.y0, o.y1, t, w.id);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(o.x1 - o.x0, o.y1 - o.y0), glassMaterial);
      glass.position.set((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 0);
      glass.userData.wallId = w.id;
      group.add(glass);
      // Mullion.
      addMesh(group, boxPiece((o.x0 + o.x1) / 2 - 0.02, (o.x0 + o.x1) / 2 + 0.02, o.y0, o.y1, 0.03), frameMaterial, w.id);
    } else if (o.type === 'door') {
      addFrame(group, o.x0, o.x1, o.y0, o.y1, t, w.id);
      // Door leaf, slightly ajar so it reads as a door from any side.
      const leafW = o.x1 - o.x0 - 0.1;
      const leaf = new THREE.Mesh(boxPiece(0, leafW, o.y0 + 0.01, o.y1 - 0.05, 0.04), doorMaterial);
      leaf.position.set(o.x0 + 0.05, 0, 0);
      leaf.rotation.y = 0.35;
      leaf.castShadow = true;
      leaf.userData.wallId = w.id;
      group.add(leaf);
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), handleMaterial);
      handle.position.set(leafW - 0.08, (o.y0 + o.y1) / 2 - 0.1, 0.05);
      leaf.add(handle);
    }
    cursor = Math.max(cursor, o.x1);
  }
  if (cursor < L) addMesh(group, boxPiece(cursor, L, 0, H, t), material, w.id);

  // Place it in the world: plan (x, y) -> world (x, 0, y).
  const angle = Math.atan2(w.by - w.ay, w.bx - w.ax);
  group.position.set(w.ax, 0, w.ay);
  group.rotation.y = -angle;
  group.userData.wallId = w.id;
  return group;
}

function buildFloor(loop, skin) {
  if (!loop || loop.length < 3) return null;
  const shape = new THREE.Shape();
  loop.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, -y);
    else shape.lineTo(x, -y);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.08, 0);
  const mesh = new THREE.Mesh(geo, materialFor(skin));
  mesh.receiveShadow = true;
  mesh.userData.floor = true;
  return mesh;
}

// ------------------------------------------------------------- selection

function applySelection() {
  for (const [id, group] of wallGroups) {
    const mat = group.userData.material;
    if (!mat) continue;
    const on = id === selectedId;
    mat.emissive = on ? SELECT_COLOR : new THREE.Color(0x000000);
    mat.emissiveIntensity = on ? 0.45 : 0;
  }
}

function setupPointer() {
  const el = renderer.domElement;
  let down = null;
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  });
  el.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 10 || dt > 500) return;
    pick(e.clientX, e.clientY);
  });
}

const raycaster = new THREE.Raycaster();
function pick(cx, cy) {
  const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(root.children, true);
  for (const h of hits) {
    let obj = h.object;
    while (obj && obj.userData.wallId === undefined && !obj.userData.floor && obj.parent) obj = obj.parent;
    if (obj && obj.userData.wallId !== undefined) {
      selectedId = obj.userData.wallId;
      applySelection();
      post({ type: 'select', wallId: selectedId });
      return;
    }
    if (obj && obj.userData.floor) {
      selectedId = null;
      applySelection();
      post({ type: 'select', floor: true });
      return;
    }
  }
  if (selectedId !== null) {
    selectedId = null;
    applySelection();
    post({ type: 'deselect' });
  }
}

// ---------------------------------------------------------------- camera

function sceneBounds() {
  const box = new THREE.Box3();
  if (!currentScene || !currentScene.walls.length) {
    box.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2.7, 3));
    return box;
  }
  for (const w of currentScene.walls) {
    box.expandByPoint(new THREE.Vector3(w.ax, 0, w.ay));
    box.expandByPoint(new THREE.Vector3(w.bx, w.height, w.by));
  }
  return box;
}

function viewPreset(name) {
  const box = sceneBounds();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(2, Math.hypot(size.x, size.z) / 2);
  controls.target.copy(center);
  controls.target.y = Math.min(size.y, 1.2);
  if (name === 'top') {
    camera.position.set(center.x, radius * 2.4 + size.y, center.z + 0.001);
  } else if (name === 'inside') {
    camera.position.set(center.x + 0.4, 1.6, center.z + 0.4);
    controls.target.set(center.x + 4, 1.4, center.z);
  } else {
    camera.position.set(center.x + radius * 1.1, radius * 1.0 + size.y, center.z + radius * 1.5);
  }
  controls.update();
}

// ------------------------------------------------------------------- api

function setScene(data) {
  currentScene = data;
  const firstLoad = wallGroups.size === 0 && root.children.length === 0;
  root.clear();
  wallGroups.clear();
  for (const w of data.walls || []) {
    const g = buildWall(w);
    wallGroups.set(w.id, g);
    root.add(g);
  }
  for (const loop of data.floors || []) {
    const f = buildFloor(loop, data.floorSkin || { kind: 'color', color: '#cccccc', scale: 1 });
    if (f) root.add(f);
  }
  selectedId = data.selected || null;
  applySelection();
  if (firstLoad) viewPreset('perspective');
}

function snapshot() {
  renderer.render(scene, camera);
  post({ type: 'snapshot', data: renderer.domElement.toDataURL('image/png') });
}

window.setScene = setScene;
window.viewPreset = viewPreset;
window.snapshot = snapshot;
window.__viewer = {
  get wallCount() {
    return wallGroups.size;
  },
  get meshCount() {
    let n = 0;
    root.traverse((o) => {
      if (o.isMesh) n++;
    });
    return n;
  },
  get floorCount() {
    return root.children.filter((c) => c.userData.floor).length;
  },
  get selectedId() {
    return selectedId;
  },
  pick,
  camera: () => camera,
};

init();

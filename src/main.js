import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ================= تنظیمات =================
const FALLBACK_COLORS = {
  1: '#E0001F', 2: '#2F4389', 3: '#67C5F5', 4: '#F8E100',
  5: '#007E46', 6: '#EF639F', 7: '#7F0B74',
};

const CENTER = { lat: 35.6892, lon: 51.389 };
const R = 6371000;
const SCALE = 1 / 100;      // هر واحد = ۱۰۰ متر
const SNAP_DIST = 3;        // حداکثر فاصله‌ی ایستگاه تا خط (۳۰۰ متر)
const MERGE_DIST = 6;       // ایستگاه‌های هم‌نامِ نزدیک‌تر از ۶۰۰ متر = یک ایستگاه
const TRAIN_SPACING = 35;   // تقریباً هر ۳.۵ کیلومتر یک قطار
const TRAIN_SPEED = 10;     // واحد بر ثانیه (تندتر از واقعیت، برای نمایش)

const HOME = {
  pos: new THREE.Vector3(0, 200, 240),
  target: new THREE.Vector3(0, -12, 0),
};

// نقشه
const TILE_SOURCES = {
  osm: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, darken: true },
  // نقشه‌ی تیره‌ی آماده، تمیزتر و بدون فیلتر. اگه استفاده کردی «© CARTO» رو به credit اضافه کن
  carto: { url: (z, x, y) => `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`, darken: false },
};
const TILE_SOURCE = TILE_SOURCES.osm;
const MAP_ZOOM = 12;        // ۱۳ = واضح‌تر ولی ۴ برابر کاشی
const MAP_DARK = true;      // false = نقشه‌ی روشن و رنگی اصلی
const MAP_BBOX = { south: 35.40, west: 50.85, north: 35.95, east: 51.80 };

// ================= ابزارها =================
const $ = (id) => document.getElementById(id);
const fa = (n) => Number(n).toLocaleString('fa-IR');
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) =>
  String(s ?? '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\s]+/g, ' ').trim();
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

function project(lon, lat, y = 0) {
  const toRad = Math.PI / 180;
  const x = (lon - CENTER.lon) * toRad * R * Math.cos(CENTER.lat * toRad);
  const z = -(lat - CENTER.lat) * toRad * R;
  return new THREE.Vector3(x * SCALE, y, z * SCALE);
}

function refNumber(ref) {
  const en = String(ref ?? '')
    .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06f0)
    .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660);
  return parseInt(en, 10) || 99;
}

function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

// ================= وضعیت =================
const state = {
  gap: parseFloat($('layer-gap').value),
  mapOpacity: parseFloat($('map-opacity').value),
  trains: $('trains-toggle').checked,
  hovered: null,
  selected: null,
};
const lines = [];
const stations = [];

// ================= صحنه =================
const scene = new THREE.Scene();
scene.background = new THREE.Color('#070a12');
scene.fog = new THREE.Fog('#070a12', 450, 1200);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 4000);
camera.position.set(0, 560, 640); // نقطه‌ی شروع انیمیشن ورود

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minDistance = 10;
controls.maxDistance = 900;
controls.autoRotateSpeed = 0.6;
controls.target.copy(HOME.target);

scene.add(new THREE.HemisphereLight('#ffffff', '#334466', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.5);
sun.position.set(100, 300, 100);
scene.add(sun);

// شبکه‌ی کف (حس عمق زیر زمین)
const grid = new THREE.GridHelper(1600, 80, '#22314f', '#141c2e');
grid.material.transparent = true;
grid.material.opacity = 0.5;
grid.material.depthWrite = false;
scene.add(grid);

// ================= درخشش (Bloom) =================
// رندر تارگت با MSAA تا لبه‌ها با وجود پست‌پروسس صاف بمونن
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), parseFloat($('bloom').value), 0.5, 0.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ================= نقشه‌ی تهران =================
function lon2tile(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
function lat2tile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
function tile2lon(x, z) { return (x / 2 ** z) * 360 - 180; }
function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function makeTexture(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (MAP_DARK && TILE_SOURCE.darken) {
    ctx.filter = 'invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9) saturate(0.5)';
  }
  ctx.drawImage(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const mapGroup = new THREE.Group();
scene.add(mapGroup);

function buildMap() {
  const z = MAP_ZOOM;
  const x0 = lon2tile(MAP_BBOX.west, z);
  const x1 = lon2tile(MAP_BBOX.east, z);
  const y0 = lat2tile(MAP_BBOX.north, z);
  const y1 = lat2tile(MAP_BBOX.south, z);

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const nw = project(tile2lon(x, z), tile2lat(y, z));
      const se = project(tile2lon(x + 1, z), tile2lat(y + 1, z));
      const w = se.x - nw.x;
      const h = se.z - nw.z;

      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      mat.userData.fade = 0;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(nw.x + w / 2, 0, nw.z + h / 2);
      mesh.renderOrder = 10; // همیشه بعد از خطوط کشیده بشه
      mesh.visible = false;
      mapGroup.add(mesh);

      loadImage(TILE_SOURCE.url(z, x, y))
        .then((img) => {
          mat.map = makeTexture(img);
          mat.needsUpdate = true;
          mat.userData.fading = true;
          mesh.visible = true;
        })
        .catch(() => console.warn(`کاشی ${z}/${x}/${y} لود نشد`));
    }
  }
}

function updateTiles(dt) {
  for (const { material: m } of mapGroup.children) {
    if (!m.userData.fading) continue;
    m.userData.fade = Math.min(1, m.userData.fade + dt * 1.5);
    m.opacity = state.mapOpacity * m.userData.fade;
    if (m.userData.fade === 1) m.userData.fading = false;
  }
}

// ================= مترو =================
const WHITE = new THREE.Color('#ffffff');
const UP = new THREE.Vector3(0, 1, 0);

function layerY(line) {
  return -(line.index + 1) * state.gap;
}

function buildLines(data) {
  const sorted = [...data.lines].sort((a, b) => refNumber(a.ref) - refNumber(b.ref));

  sorted.forEach((raw, i) => {
    const color = new THREE.Color(raw.colour || FALLBACK_COLORS[refNumber(raw.ref)] || '#999999');
    const hex = `#${color.getHexString()}`;
    const line = {
      index: i,
      ref: raw.ref,
      label: `خط ${raw.ref ? faDigits(raw.ref) : raw.name}`,
      color, hex, fg: textColorFor(hex),
      group: new THREE.Group(),
      points: [], curves: [], stations: [], trains: [],
      tubeMat: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.35 }),
      stationMat: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 0.7 }),
      trainMat: new THREE.MeshBasicMaterial({ color: color.clone().lerp(WHITE, 0.65) }),
    };

    for (const seg of raw.segments) {
      const pts = [];
      for (const [lon, lat] of seg) {
        const p = project(lon, lat);
        if (!pts.length || pts.at(-1).distanceToSquared(p) > 1e-4) pts.push(p); // حذف نقاط تکراری
      }
      if (pts.length < 2) continue;
      line.points.push(...pts);

      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      curve.arcLengthDivisions = Math.max(200, pts.length * 8);
      line.curves.push({ curve, length: curve.getLength() });

      const geo = new THREE.TubeGeometry(curve, Math.max(16, pts.length * 4), 0.35, 10, false);
      line.group.add(new THREE.Mesh(geo, line.tubeMat));
    }

    scene.add(line.group);
    lines.push(line);
  });
}

// ایستگاه‌های هم‌نام و نزدیک (مثلاً سکوهای خطوط مختلف) یکی می‌شن
function mergeStations(raw) {
  const byName = new Map();
  const out = [];
  for (const s of raw) {
    const key = norm(s.name || s.nameEn);
    const p = project(s.lon, s.lat);
    const list = byName.get(key) ?? [];
    byName.set(key, list);

    let m = key && list.find((g) => g.pos.distanceTo(p) < MERGE_DIST);
    if (!m) {
      m = { name: s.name || s.nameEn || '—', nameEn: s.nameEn || '', pos: p.clone(), sum: new THREE.Vector3(), n: 0 };
      list.push(m);
      out.push(m);
    }
    m.sum.add(p);
    m.n++;
    m.pos.copy(m.sum).divideScalar(m.n);
    if (!m.nameEn && s.nameEn) m.nameEn = s.nameEn;
  }
  return out;
}

const SPHERE = new THREE.SphereGeometry(0.9, 20, 14);
const shaftMat = new THREE.LineBasicMaterial({ color: '#8899bb', transparent: true, opacity: 0.45 });
const shaftMatX = new THREE.LineBasicMaterial({ color: '#dfe7ff', transparent: true, opacity: 0.85 });
const shaftMatSel = new THREE.LineBasicMaterial({ color: '#ffffff' });

function buildStations(data) {
  for (const m of mergeStations(data.stations)) {
    const anchors = [];
    for (const line of lines) {
      let best = Infinity;
      let point = null;
      for (const q of line.points) {
        const d = (q.x - m.pos.x) ** 2 + (q.z - m.pos.z) ** 2;
        if (d < best) { best = d; point = q; }
      }
      if (best < SNAP_DIST ** 2) anchors.push({ line, point });
    }
    if (!anchors.length) continue;

    const st = {
      name: m.name,
      nameEn: m.nameEn,
      pos: m.pos,
      key: norm(`${m.name} ${m.nameEn}`),
      nameKey: norm(m.name),
      enKey: norm(m.nameEn),
      anchors,
      lines: anchors.map((a) => a.line),
      interchange: anchors.length > 1,
      meshes: [],
      base: anchors.length > 1 ? 1.35 : 1,
      scale: 1,
    };

    for (const { line, point } of anchors) {
      const mesh = new THREE.Mesh(SPHERE, line.stationMat);
      mesh.position.copy(point);
      mesh.scale.setScalar(st.base);
      line.group.add(mesh);
      line.stations.push(st);
      st.meshes.push(mesh);
    }

    // شفت: از سطح زمین به ترتیب از همه‌ی خطوط ایستگاه رد می‌شه
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((anchors.length + 1) * 3), 3));
    st.shaft = new THREE.Line(geo, st.interchange ? shaftMatX : shaftMat);
    st.shaft.frustumCulled = false;
    scene.add(st.shaft);

    stations.push(st);
  }
}

function updateShafts() {
  for (const st of stations) {
    const a = st.shaft.geometry.attributes.position;
    a.setXYZ(0, st.pos.x, 0, st.pos.z);
    st.anchors.forEach(({ line, point }, i) => a.setXYZ(i + 1, point.x, layerY(line), point.z));
    a.needsUpdate = true;
  }
}

// نقطه‌ی ورودی ایستگاه روی سطح نقشه (InstancedMesh = یک draw call)
let dots;
function buildSurfaceDots() {
  dots = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.7, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#cfd8ea', transparent: true, opacity: 0.75, depthWrite: false }),
    stations.length,
  );
  dots.renderOrder = 11;
  dots.frustumCulled = false;
  scene.add(dots);
  updateDots();
}

function updateDots() {
  const m = new THREE.Matrix4();
  stations.forEach((st, i) => {
    const visible = st.lines.some((l) => l.group.visible);
    const s = visible ? (st.interchange ? 1.5 : 1) : 0;
    dots.setMatrixAt(i, m.makeScale(s, 1, s).setPosition(st.pos.x, 0.15, st.pos.z));
    st.shaft.visible = visible;
  });
  dots.instanceMatrix.needsUpdate = true;
}

// ================= قطارها =================
const TRAIN_GEO = new THREE.CapsuleGeometry(0.4, 1.8, 4, 10);

function buildTrains() {
  for (const line of lines) {
    for (const c of line.curves) {
      const count = c.length < 15 ? 0 : Math.max(1, Math.round(c.length / TRAIN_SPACING));
      for (let k = 0; k < count; k++) {
        const mesh = new THREE.Mesh(TRAIN_GEO, line.trainMat);
        mesh.visible = state.trains;
        line.group.add(mesh);
        line.trains.push({
          mesh, c,
          u: (2 * k) / count + Math.random() * 0.1,          // ۰..۱ رفت، ۱..۲ برگشت
          speed: TRAIN_SPEED * (0.85 + Math.random() * 0.3),
        });
      }
    }
  }
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _side = new THREE.Vector3();

function updateTrains(dt) {
  if (!state.trains) return;
  for (const line of lines) {
    if (!line.group.visible) continue;
    for (const tr of line.trains) {
      tr.u = (tr.u + (tr.speed * dt) / tr.c.length) % 2;
      const forward = tr.u < 1;
      const t = forward ? tr.u : 2 - tr.u;
      tr.c.curve.getPointAt(t, _p);
      tr.c.curve.getTangentAt(t, _t);
      if (!forward) _t.negate();
      _side.crossVectors(_t, UP).normalize().multiplyScalar(0.55); // ریل رفت و ریل برگشت جدا
      tr.mesh.position.copy(_p).add(_side);
      tr.mesh.quaternion.setFromUnitVectors(UP, _t);
    }
  }
}

// ================= لایه‌ها و فوکوس =================
function applyGap() {
  for (const line of lines) line.group.position.y = layerY(line);
  grid.position.y = -(lines.length + 1.5) * state.gap;
  updateShafts();
}

function setFocusLine(focus) {
  for (const line of lines) {
    const dim = !!focus && line !== focus;
    for (const mat of [line.tubeMat, line.stationMat, line.trainMat]) {
      mat.transparent = dim;
      mat.opacity = dim ? 0.12 : 1;
      mat.depthWrite = !dim;
      mat.needsUpdate = true;
    }
  }
}

// ================= حرکت دوربین =================
let flight = null;

function flyTo(target, pos, duration = 1.6, onDone) {
  flight = {
    t: 0, duration, onDone,
    fromT: controls.target.clone(), fromP: camera.position.clone(),
    toT: target.clone(), toP: pos.clone(),
  };
}

function flyToPoint(target, distance) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  dir.y = Math.max(dir.y, 0.6);
  dir.normalize();
  flyTo(target, target.clone().addScaledVector(dir, distance));
}

function updateFlight(dt) {
  if (!flight) return;
  flight.t = Math.min(1, flight.t + dt / flight.duration);
  const k = easeInOut(flight.t);
  controls.target.lerpVectors(flight.fromT, flight.toT, k);
  camera.position.lerpVectors(flight.fromP, flight.toP, k);
  if (flight.t === 1) {
    const done = flight.onDone;
    flight = null;
    done?.();
  }
}

function frameLine(line) {
  const box = new THREE.Box3().setFromPoints(line.points);
  const center = box.getCenter(new THREE.Vector3());
  center.y = layerY(line);
  flyToPoint(center, Math.max(60, box.getSize(new THREE.Vector3()).length() * 0.9));
}

function setAutoRotate(on) {
  controls.autoRotate = on;
  $('rotate-toggle').checked = on;
}

controls.addEventListener('start', () => {
  flight = null;
  setAutoRotate(false);
});

// ================= انتخاب ایستگاه =================
const pulse = new THREE.Group();
const RING_GEO = new THREE.RingGeometry(1.6, 2.0, 48).rotateX(-Math.PI / 2);
for (let i = 0; i < 2; i++) {
  const ring = new THREE.Mesh(
    RING_GEO,
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.renderOrder = 12;
  pulse.add(ring);
}
pulse.visible = false;
scene.add(pulse);

function updatePulse(time) {
  if (!pulse.visible) return;
  pulse.children.forEach((ring, i) => {
    const k = (time * 0.7 + i * 0.5) % 1;
    ring.scale.setScalar(1 + k * 3);
    ring.material.opacity = (1 - k) * 0.9;
  });
}

function selectStation(st, fly = false) {
  const prev = state.selected;
  if (prev) prev.shaft.material = prev.interchange ? shaftMatX : shaftMat;

  state.selected = st;
  pulse.visible = !!st;
  $('info').hidden = !st;
  if (!st) return;

  st.shaft.material = shaftMatSel;
  pulse.position.set(st.pos.x, 0.3, st.pos.z);
  renderInfo(st);

  if (fly) {
    const depth = Math.max(...st.lines.map((l) => l.index + 1)) * state.gap;
    flyToPoint(new THREE.Vector3(st.pos.x, -depth / 2, st.pos.z), 45 + depth);
  }
}

function renderInfo(st) {
  $('info-name').textContent = st.name;
  $('info-en').textContent = st.nameEn;
  const box = $('info-lines');
  box.innerHTML = '';
  for (const line of st.lines) {
    const b = document.createElement('button');
    b.className = 'badge';
    b.style.setProperty('--c', line.hex);
    b.style.setProperty('--fg', line.fg);
    b.textContent = line.label;
    b.title = 'نمایش کل خط';
    b.onclick = () => frameLine(line);
    box.appendChild(b);
  }
  $('info-meta').textContent = st.interchange
    ? `ایستگاه تبادلی بین ${fa(st.lines.length)} خط`
    : 'ایستگاه عادی';
}

function updateStationScales(dt) {
  const k = Math.min(1, dt * 12);
  for (const st of stations) {
    const target = st === state.selected ? 1.9 : st === state.hovered ? 1.5 : 1;
    if (Math.abs(st.scale - target) < 0.001) continue;
    st.scale += (target - st.scale) * k;
    for (const m of st.meshes) m.scale.setScalar(st.base * st.scale);
  }
}

// ================= هاور و کلیک =================
const tooltip = $('tooltip');
const canvas = renderer.domElement;
const pointer = { x: 0, y: 0, inside: false, down: null, type: 'mouse' };
const dotsHTML = (st) => st.lines.map((l) => `<i style="background:${l.hex}"></i>`).join('');
const _v = new THREE.Vector3();

// انتخاب بر اساس فاصله روی صفحه: دقیق زدن روی کره‌ی کوچیک لازم نیست
function pickStation(x, y, radius) {
  let best = null;
  let bestD = radius;
  for (const st of stations) {
    for (const m of st.meshes) {
      const g = m.parent;
      if (!g.visible) continue;
      _v.set(m.position.x, m.position.y + g.position.y, m.position.z).project(camera);
      if (_v.z < -1 || _v.z > 1) continue;
      const d = Math.hypot(((_v.x + 1) / 2) * innerWidth - x, ((1 - _v.y) / 2) * innerHeight - y);
      if (d < bestD) { bestD = d; best = st; }
    }
  }
  return best;
}

function setHovered(st) {
  if (state.hovered === st) return;
  state.hovered = st;
  canvas.style.cursor = st ? 'pointer' : '';
  if (!st) {
    tooltip.style.display = 'none';
    return;
  }
  tooltip.innerHTML = `<div><strong>${esc(st.name)}</strong><span class="dots">${dotsHTML(st)}</span></div>${
    st.nameEn ? `<small>${esc(st.nameEn)}</small>` : ''
  }`;
  tooltip.style.display = 'block';
}

function positionTooltip(x, y) {
  const w = tooltip.offsetWidth;
  const h = tooltip.offsetHeight;
  const left = x + 16 + w > innerWidth - 8 ? x - w - 16 : x + 16;
  const top = y + 16 + h > innerHeight - 8 ? y - h - 16 : y + 16;
  tooltip.style.transform = `translate(${left}px, ${top}px)`;
}

function updateHover() {
  if (!pointer.inside || pointer.down || pointer.type === 'touch') return;
  const st = pickStation(pointer.x, pointer.y, 14);
  setHovered(st);
  if (st) positionTooltip(pointer.x, pointer.y);
}

canvas.addEventListener('pointermove', (e) => {
  Object.assign(pointer, { x: e.clientX, y: e.clientY, inside: true, type: e.pointerType });
});
canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
  setHovered(null);
});
canvas.addEventListener('pointerdown', (e) => {
  pointer.down = { x: e.clientX, y: e.clientY };
  setHovered(null);
});
canvas.addEventListener('pointercancel', () => { pointer.down = null; });
canvas.addEventListener('pointerup', (e) => {
  const d = pointer.down;
  pointer.down = null;
  if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // درگ بوده، نه کلیک
  const st = pickStation(e.clientX, e.clientY, e.pointerType === 'touch' ? 28 : 14);
  selectStation(st, !!st);
});

// ================= رابط کاربری =================
function buildLegend() {
  const legend = $('legend');
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'line-row';
    row.innerHTML = `
      <input type="checkbox" checked aria-label="نمایش ${esc(line.label)}">
      <span class="swatch" style="background:${line.hex};box-shadow:0 0 10px ${line.hex}"></span>
      <button class="line-name" title="رفتن به ${esc(line.label)}">${esc(line.label)}</button>
      <span class="count">${fa(line.stations.length)} ایستگاه</span>`;

    row.querySelector('input').addEventListener('change', (e) => {
      line.group.visible = e.target.checked;
      row.classList.toggle('off', !e.target.checked);
      updateDots();
    });
    row.querySelector('.line-name').addEventListener('click', () => frameLine(line));
    row.addEventListener('mouseenter', () => setFocusLine(line));
    row.addEventListener('mouseleave', () => setFocusLine(null));
    legend.appendChild(row);
  }
}

function setupSearch() {
  const input = $('search');
  const list = $('results');
  let current = [];

  const choose = (st) => {
    input.value = '';
    list.innerHTML = '';
    input.blur();
    selectStation(st, true);
  };

  input.addEventListener('input', () => {
    const q = norm(input.value);
    current = !q ? [] : stations
      .map((st) => ({
        st,
        rank: st.nameKey.startsWith(q) || st.enKey.startsWith(q) ? 0 : st.key.includes(q) ? 1 : 2,
      }))
      .filter((r) => r.rank < 2)
      .sort((a, b) => a.rank - b.rank || a.st.name.localeCompare(b.st.name, 'fa'))
      .slice(0, 8)
      .map((r) => r.st);

    list.innerHTML = '';
    for (const st of current) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(st.name)}</span><span class="dots">${dotsHTML(st)}</span>`;
      li.addEventListener('click', () => choose(st));
      list.appendChild(li);
    }
    if (q && !current.length) list.innerHTML = '<li class="empty">ایستگاهی پیدا نشد</li>';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && current[0]) choose(current[0]);
    if (e.key === 'Escape') {
      input.value = '';
      list.innerHTML = '';
      input.blur();
    }
  });
}

$('map-toggle').addEventListener('change', (e) => {
  mapGroup.visible = e.target.checked;
});
$('map-opacity').addEventListener('input', (e) => {
  state.mapOpacity = parseFloat(e.target.value);
  for (const { material: m } of mapGroup.children) m.opacity = state.mapOpacity * m.userData.fade;
});
$('layer-gap').addEventListener('input', (e) => {
  state.gap = parseFloat(e.target.value);
  applyGap();
});
$('bloom').addEventListener('input', (e) => {
  bloom.strength = parseFloat(e.target.value);
});
$('trains-toggle').addEventListener('change', (e) => {
  state.trains = e.target.checked;
  for (const l of lines) for (const t of l.trains) t.mesh.visible = state.trains;
});
$('rotate-toggle').addEventListener('change', (e) => {
  controls.autoRotate = e.target.checked;
});
$('reset-view').addEventListener('click', () => {
  selectStation(null);
  flyTo(HOME.target, HOME.pos, 1.8);
});
$('info-close').addEventListener('click', () => selectStation(null));
$('panel-toggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
if (innerWidth < 640) $('panel').classList.add('collapsed');

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === '/') {
    e.preventDefault();
    $('panel').classList.remove('collapsed');
    $('search').focus();
  }
  if (e.key === 'Escape') selectStation(null);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ================= اجرا =================
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  updateFlight(dt);
  controls.update(dt);
  updateTiles(dt);
  updateTrains(dt);
  updateStationScales(dt);
  updatePulse(clock.elapsedTime);
  updateHover();
  composer.render();
});

async function main() {
  buildMap();
  try {
    const res = await fetch('./data/metro.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    buildLines(data);
    buildStations(data);
    buildSurfaceDots();
    buildTrains();
    applyGap();
    buildLegend();
    setupSearch();

    const x = stations.filter((s) => s.interchange).length;
    $('stats').textContent = `${fa(lines.length)} خط · ${fa(stations.length)} ایستگاه · ${fa(x)} تبادلی`;

    $('loader').classList.add('done');
    flyTo(HOME.target, HOME.pos, 2.8, () => {
      controls.autoRotate = $('rotate-toggle').checked;
    });
  } catch (err) {
    console.error(err);
    $('loader').querySelector('p').textContent = 'خطا در بارگذاری داده‌ها 😕';
  }
}

main();
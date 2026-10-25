import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- تنظیمات ----------
const FALLBACK_COLORS = {
  1: '#E0001F', 2: '#2F4389', 3: '#67C5F5', 4: '#F8E100',
  5: '#007E46', 6: '#EF639F', 7: '#7F0B74',
};

const CENTER = { lat: 35.6892, lon: 51.389 };
const R = 6371000;
const SCALE = 1 / 100;
const LAYER_GAP = 4;
const SNAP_DIST = 3;

// نقشه
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const MAP_ZOOM = 12;      // ۱۳ = واضح‌تر ولی ۴ برابر کاشی
const MAP_DARK = true;    // false = نقشه‌ی روشن و رنگی اصلی
const MAP_BBOX = { south: 35.40, west: 50.85, north: 35.95, east: 51.80 };

function project(lon, lat, y = 0) {
  const toRad = Math.PI / 180;
  const x = (lon - CENTER.lon) * toRad * R * Math.cos(CENTER.lat * toRad);
  const z = -(lat - CENTER.lat) * toRad * R;
  return new THREE.Vector3(x * SCALE, y, z * SCALE);
}

// ---------- صحنه ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0f17');
scene.fog = new THREE.Fog('#0b0f17', 400, 1100);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 4000);
camera.position.set(0, 200, 240);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minDistance = 10;
controls.maxDistance = 900;

scene.add(new THREE.HemisphereLight('#ffffff', '#334466', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.5);
sun.position.set(100, 300, 100);
scene.add(sun);

// ---------- نقشه‌ی تهران ----------
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
  if (MAP_DARK) {
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
let mapOpacity = 0.6;

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
        transparent: true, opacity: mapOpacity,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(nw.x + w / 2, 0, nw.z + h / 2);
      mesh.visible = false;
      mapGroup.add(mesh);

      loadImage(TILE_URL(z, x, y))
        .then((img) => {
          mat.map = makeTexture(img);
          mat.needsUpdate = true;
          mesh.visible = true;
        })
        .catch(() => console.warn(`کاشی ${z}/${x}/${y} لود نشد`));
    }
  }
}

document.getElementById('map-toggle').addEventListener('change', (e) => {
  mapGroup.visible = e.target.checked;
});

document.getElementById('map-opacity').addEventListener('input', (e) => {
  mapOpacity = parseFloat(e.target.value);
  for (const m of mapGroup.children) m.material.opacity = mapOpacity;
});

// ---------- مترو ----------
const stationMeshes = [];

function refNumber(ref) {
  const en = String(ref).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  return parseInt(en) || 99;
}

function buildLines(data) {
  const lines = data.lines.sort((a, b) => refNumber(a.ref) - refNumber(b.ref));

  lines.forEach((line, i) => {
    line.color = line.colour || FALLBACK_COLORS[refNumber(line.ref)] || '#999999';
    line.y = -(i + 1) * LAYER_GAP;
    line.group = new THREE.Group();
    line.points3d = [];

    const mat = new THREE.MeshStandardMaterial({
      color: line.color, emissive: line.color,
      emissiveIntensity: 0.5, roughness: 0.4,
    });

    for (const seg of line.segments) {
      const pts = seg.map(([lon, lat]) => project(lon, lat, line.y));
      if (pts.length < 2) continue;
      line.points3d.push(...pts);

      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 3), 0.35, 8, false);
      line.group.add(new THREE.Mesh(geo, mat));
    }

    line.stationMat = new THREE.MeshStandardMaterial({
      color: '#ffffff', emissive: line.color, emissiveIntensity: 0.6,
    });

    scene.add(line.group);
  });

  return lines;
}

function buildStations(data, lines) {
  const sphere = new THREE.SphereGeometry(0.9, 16, 12);
  const shaftMat = new THREE.LineBasicMaterial({ color: '#8899bb', transparent: true, opacity: 0.5 });

  for (const st of data.stations) {
    const p = project(st.lon, st.lat, 0);
    const hits = [];

    for (const line of lines) {
      let best = Infinity;
      let bestPoint = null;
      for (const q of line.points3d) {
        const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (d < best) { best = d; bestPoint = q; }
      }
      if (best < SNAP_DIST ** 2) hits.push({ line, point: bestPoint });
    }

    if (!hits.length) continue;

    for (const { line, point } of hits) {
      const m = new THREE.Mesh(sphere, line.stationMat);
      m.position.copy(point);
      m.userData = { station: st, line };
      line.group.add(m);
      stationMeshes.push(m);
    }

    const deepest = Math.min(...hits.map((h) => h.line.y));
    const shaft = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p.x, 0, p.z),
      new THREE.Vector3(p.x, deepest, p.z),
    ]);
    scene.add(new THREE.Line(shaft, shaftMat));
  }
}

function buildLegend(lines) {
  const legend = document.getElementById('legend');
  for (const line of lines) {
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="checkbox" checked>
      <span class="swatch" style="background:${line.color}"></span>
      <span>خط ${line.ref || line.name}</span>`;
    label.querySelector('input').addEventListener('change', (e) => {
      line.group.visible = e.target.checked;
    });
    legend.appendChild(label);
  }
}

// ---------- هاور ----------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');

addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);

  const visible = stationMeshes.filter((m) => m.userData.line.group.visible);
  const hit = raycaster.intersectObjects(visible, false)[0];

  if (hit) {
    const { station, line } = hit.object.userData;
    tooltip.innerHTML = `${station.name} · خط ${line.ref}<small>${station.nameEn}</small>`;
    tooltip.style.left = `${e.clientX + 14}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
    tooltip.style.display = 'block';
    document.body.style.cursor = 'pointer';
  } else {
    tooltip.style.display = 'none';
    document.body.style.cursor = '';
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- اجرا ----------
async function main() {
  buildMap();
  const data = await fetch('./data/metro.json').then((r) => r.json());
  const lines = buildLines(data);
  buildStations(data, lines);
  buildLegend(lines);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

main();

import { writeFile, mkdir } from 'node:fs/promises';

const BBOX = '35.40,50.85,35.95,51.80';

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const query = `
[out:json][timeout:120];
relation["route"~"^(subway|light_rail)$"](${BBOX});
out geom;
node["railway"="station"]["station"~"^(subway|light_rail)$"](${BBOX});
out body;
`;

async function download() {
  for (const url of SERVERS) {
    console.log(`→ تلاش با ${url}`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'tehran-metro-3d (github project)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) {
        console.log(`  ✖ خطای ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      console.log(`  ✖ ${err.cause?.code || err.name}`);
    }
  }
  throw new Error('هیچ‌کدوم از سرورها جواب ندادن');
}

const json = await download();

const linesByRef = new Map();
const stations = [];

for (const el of json.elements) {
  if (el.type === 'relation') {
    const t = el.tags ?? {};
    const key = t.ref || t.name || String(el.id);

    if (!linesByRef.has(key)) {
      linesByRef.set(key, {
        ref: t.ref ?? '',
        name: t.name ?? '',
        nameEn: t['name:en'] ?? '',
        colour: t.colour ?? null,
        ways: new Map(),
      });
    }
    const line = linesByRef.get(key);
    if (!line.colour && t.colour) line.colour = t.colour;

    for (const m of el.members) {
      if (m.type !== 'way' || !m.geometry || m.role === 'platform') continue;
      line.ways.set(m.ref, m.geometry.filter(Boolean).map((p) => [p.lon, p.lat]));
    }
  } else if (el.type === 'node') {
    const t = el.tags ?? {};
    stations.push({
      id: el.id,
      name: t.name ?? '',
      nameEn: t['name:en'] ?? '',
      lon: el.lon,
      lat: el.lat,
    });
  }
}

const lines = [...linesByRef.values()].map(({ ways, ...rest }) => ({
  ...rest,
  segments: [...ways.values()],
}));

await mkdir('public/data', { recursive: true });
await writeFile('public/data/metro.json', JSON.stringify({ lines, stations }));

console.log(`✔ ${lines.length} خط و ${stations.length} ایستگاه ذخیره شد.`);

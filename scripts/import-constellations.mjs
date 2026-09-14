// Rebuild the checked-in catalogue; runtime never depends on these services.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const celestial = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/';
const stellarium =
  'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/';
const cache = path.join(root, 'tmp/catalogue');
const output = path.join(root, 'src/data/constellations');
const artDir = path.join(root, 'public/art/constellations');
await Promise.all([cache, output, artDir].map((p) => mkdir(p, { recursive: true })));
async function download(url, destination) {
  try {
    return await readFile(destination);
  } catch {}
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, data);
  return data;
}
async function json(name, url) {
  return JSON.parse(await download(url, path.join(cache, name + '.json')));
}
const [lines, names, illustrations] = await Promise.all([
  json('lines', celestial + 'data/constellations.lines.json'),
  json('names', celestial + 'data/constellations.json'),
  json('stellarium', stellarium + 'index.json'),
]);
const retained = { Ari: 'aries', Cas: 'cassiopeia', Ori: 'orion', UMa: 'ursa-major' };
const premium = [
  'Tau',
  'Gem',
  'Cnc',
  'Leo',
  'Vir',
  'Lib',
  'Sco',
  'Sgr',
  'Cap',
  'Aqr',
  'Psc',
  'Ser',
  'Pup',
  'Vel',
  'And',
  'Peg',
];
const corrections = {
  CrA: ['남쪽왕관자리', 'Corona Australis'],
  Cyg: ['백조자리', 'Cygnus'],
  Her: ['헤르쿨레스자리', 'Hercules'],
  Ser: ['뱀자리', 'Serpens'],
};
const grouped = new Map();
for (const feature of lines.features) {
  if (!grouped.has(feature.id)) grouped.set(feature.id, []);
  grouped.get(feature.id).push(...feature.geometry.coordinates);
}
const d2r = Math.PI / 180;
function project(coordinates) {
  const vectors = coordinates.map(([ra, dec]) => [
    Math.cos(dec * d2r) * Math.cos(ra * d2r),
    Math.cos(dec * d2r) * Math.sin(ra * d2r),
    Math.sin(dec * d2r),
  ]);
  const center = vectors.reduce((a, v) => a.map((x, i) => x + v[i]), [0, 0, 0]);
  const ra = Math.atan2(center[1], center[0]),
    dec = Math.atan2(center[2], Math.hypot(center[0], center[1]));
  const forward = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const east = [-Math.sin(ra), Math.cos(ra), 0],
    north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const projected = vectors.map((v) => {
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(v, forward))));
    const factor = theta < 1e-8 ? 1 : theta / Math.sin(theta);
    return { x: -dot(v, east) * factor, y: dot(v, north) * factor };
  });
  const xs = projected.map((p) => p.x),
    ys = projected.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale =
    1.68 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return {
    points: projected.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })),
    ra: ((ra / d2r + 360) % 360) / 15,
    dec: dec / d2r,
  };
}
// Resolve collisions in the display projection only. The original sky positions
// remain in skyCoordinates; this is an illustrated map, not a sky survey.
function separate(reference) {
  const points = reference.map((p) => ({ ...p }));
  for (let step = 0; step < 1600; step++) {
    let overlap = 0;
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i],
          b = points[j];
        let dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d >= 0.185) continue;
        if (d < 1e-8) {
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d = 1;
        }
        const push = (0.185 - Math.hypot(b.x - a.x, b.y - a.y)) / 2 + 0.000001;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
        overlap++;
      }
    for (const p of points) {
      p.x = Math.max(-0.94, Math.min(0.94, p.x));
      p.y = Math.max(-0.94, Math.min(0.94, p.y));
    }
    if (!overlap) break;
  }
  return points.map((p) => ({ x: +p.x.toFixed(6), y: +p.y.toFixed(6) }));
}
const catalogue = [];
const assets = [];
for (const [abbr, paths] of grouped) {
  const skyCoordinates = [],
    edges = [],
    index = new Map(),
    edgeKeys = new Set();
  for (const line of paths) {
    const ids = line.map((p) => {
      const key = p.join(',');
      if (!index.has(key)) {
        index.set(key, skyCoordinates.length);
        skyCoordinates.push(p);
      }
      return index.get(key);
    });
    for (let i = 1; i < ids.length; i++) {
      const pair = [ids[i - 1], ids[i]],
        key = [...pair].sort((a, b) => a - b).join(':');
      if (pair[0] !== pair[1] && !edgeKeys.has(key)) {
        edges.push(pair);
        edgeKeys.add(key);
      }
    }
  }
  const properties = names.features.find((f) => f.id === abbr).properties;
  const [name, english] = corrections[abbr] || [properties.ko, properties.name];
  const id =
    retained[abbr] ||
    english
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replaceAll(' ', '-');
  const projection = project(skyCoordinates);
  const season =
    projection.dec < -45
      ? 'southern'
      : projection.dec > 60
        ? 'northern'
        : ['autumn', 'winter', 'spring', 'summer'][Math.floor(((projection.ra + 3) % 24) / 6)];
  const item = {
    id,
    abbr,
    name,
    english,
    aliases: [properties.ko, properties.name],
    category: 'constellation',
    season,
    skyCoordinates,
    points: separate(projection.points),
    edges,
  };
  if (abbr === 'Ser') item.disconnected = true;
  if (premium.includes(abbr))
    item.art = {
      src: 'art/zodiac-atlas.png',
      grid: 4,
      tile: premium.indexOf(abbr),
      credit: 'generated',
    };
  else if (!retained[abbr]) {
    const source = illustrations.constellations.find((c) => c.id === `CON modern ${abbr}`).image;
    if (!source) throw new Error(`Missing illustration: ${abbr}`);
    item.art = { src: `art/constellations/${id}.png`, grid: 1, tile: 0, credit: 'meuris' };
    assets.push({ url: stellarium + source.file, destination: path.join(artDir, id + '.png'), id });
  }
  catalogue.push(item);
}
let next = 0;
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (next < assets.length) {
      const a = assets[next++];
      const bytes = await download(a.url, a.destination);
      if (bytes.subarray(1, 4).toString() !== 'PNG') throw new Error(`Invalid PNG: ${a.id}`);
    }
  }),
);
await writeFile(path.join(output, 'catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n');
await writeFile(
  path.join(output, 'sources.json'),
  JSON.stringify(
    {
      coordinates: celestial + 'data/constellations.lines.json',
      names: celestial + 'data/constellations.json',
      art: assets.map(({ id, url }) => ({ id, url })),
      licenses: {
        coordinates: 'BSD-3-Clause · Olaf Frohn / d3-celestial',
        art: 'Free Art License 1.3 · Johan Meuris / Stellarium',
      },
    },
    null,
    2,
  ) + '\n',
);
const dataLicense = await download(celestial + 'LICENSE', path.join(output, 'DATA-LICENSE.txt'));
await writeFile(path.join(artDir, 'DATA-LICENSE.txt'), dataLicense);
console.log(
  `Built ${catalogue.length} constellations; ${assets.length} licensed illustrations; 16 new atlas figures; 4 retained presets.`,
);

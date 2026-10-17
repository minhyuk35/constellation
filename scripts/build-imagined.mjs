// Reproducible, offline geometry build using the existing Lucide package.
// Preserve the separately generated raster illustrations; never replace them with icons.
// Run only when editing the catalogue, never on the visitor's device.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { IMAGINED_SEEDS } from '../src/data/imagined/seeds.js';
import artwork from '../src/data/imagined/artwork.json' with { type: 'json' };

const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const page = await browser.newPage();
const output = 'public/art/imagined';
mkdirSync(output, { recursive: true });
const catalogue = [];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
try {
  for (const [icon, name, english, description] of IMAGINED_SEEDS) {
    const { default: [, , nodes] } = await import(`../node_modules/lucide/dist/esm/icons/${icon}.js`);
    const paths = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${escape(value === 'currentColor' ? 'url(#light)' : value)}"`).join(' ')}/>`).join('');
    const geometry = await page.evaluate(paths => {
      document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${paths}</svg>`;
      const svg = document.querySelector('svg');
      const box = svg.getBBox();
      const size = Math.max(box.width, box.height);
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const squared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      const segmentDistance = (p, a, b) => {
        const length = squared(a, b);
        const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length)) : 0;
        return squared(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      };
      const simplify = samples => {
        if (samples.length <= 2) return samples;
        let at = 0, maximum = 0;
        for (let i = 1; i < samples.length - 1; i++) {
          const distance = segmentDistance(samples[i], samples[0], samples.at(-1));
          if (distance > maximum) { at = i; maximum = distance; }
        }
        return maximum > 0.055 ** 2
          ? [...simplify(samples.slice(0, at + 1)).slice(0, -1), ...simplify(samples.slice(at))]
          : [samples[0], samples.at(-1)];
      };
      const contours = [];
      for (const element of svg.children) {
        const length = element.getTotalLength();
        const steps = Math.max(2, Math.ceil(length / 0.1));
        let samples = [];
        for (let i = 0; i <= steps; i++) {
          const p = element.getPointAtLength(length * i / steps);
          const point = { x: (p.x - cx) * 1.8 / size, y: (cy - p.y) * 1.8 / size };
          // SVG paths may contain several pen-up moves; never connect across them.
          if (samples.length && squared(point, samples.at(-1)) > (0.22 * 1.8 / size) ** 2) {
            contours.push(simplify(samples));
            samples = [];
          }
          samples.push(point);
        }
        if (samples.length) contours.push(simplify(samples));
      }
      const points = [], edges = [], keys = new Set();
      const vertex = p => {
        let nearest = -1, distance = 0.19 ** 2;
        points.forEach((q, i) => { const d = squared(p, q); if (d < distance) { nearest = i; distance = d; } });
        if (nearest >= 0) return nearest;
        points.push({ x: +p.x.toFixed(5), y: +p.y.toFixed(5) });
        return points.length - 1;
      };
      for (const contour of contours) {
        const indices = contour.map(vertex);
        for (let i = 1; i < indices.length; i++) {
          const a = indices[i - 1], b = indices[i];
          const key = [a, b].sort((x, y) => x - y).join(':');
          if (a !== b && !keys.has(key)) { keys.add(key); edges.push([a, b]); }
        }
      }
      const used = [...new Set(edges.flat())].sort((a, b) => a - b);
      return {
        points: used.map(i => points[i]), edges: edges.map(e => e.map(i => used.indexOf(i))),
        viewBox: [cx - size * 0.68, cy - size * 0.68, size * 1.36, size * 1.36].map(n => +n.toFixed(4)).join(' '),
      };
    }, paths);
    if (geometry.points.length < 4 || geometry.points.length > 48) throw new Error(`${icon}: ${geometry.points.length} stars`);
    const id = `imagined-${icon}`;
    if (!artwork[id] || !existsSync(`public/${artwork[id].src}`))
      throw new Error(`Missing finished illustration: ${id}`);
    catalogue.push({
      id, name, english, description,
      category: 'object', kind: '창작 별자리',
      points: geometry.points, edges: geometry.edges, disconnected: true,
      art: artwork[id],
    });
  }
  writeFileSync('src/data/imagined/catalogue.json', JSON.stringify(catalogue, null, 2) + '\n');
  copyFileSync('node_modules/lucide/LICENSE', `${output}/LICENSE.txt`);
  console.log(`Built ${catalogue.length} geometries, preserving all finished raster illustrations; ${Math.min(...catalogue.map(s => s.points.length))}–${Math.max(...catalogue.map(s => s.points.length))} stars each.`);
} finally {
  await browser.close();
}

// Compact, personal-data-free encoding of a constellation for the QR photo-booth
// flow: only normalized star coordinates, edge indices, and an optional shape id
// travel in the URL — never the source video, a name, or any identifier.
import { CONFIG } from '../config.js';

const VERSION = 1;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// stars: [{ id, x, y }] in the app's [0,1] normalized space. edges: [[idA, idB]].
export function encodeShare({ stars, edges = [], shapeId = null }) {
  if (!Array.isArray(stars) || !stars.length || stars.length > CONFIG.maxStars) return null;
  const idBytes = shapeId ? new TextEncoder().encode(shapeId) : new Uint8Array(0);
  if (idBytes.length > 255) return null;
  const indexOf = new Map(stars.map((s, i) => [s.id, i]));
  const safeEdges = edges
    .filter(([a, b]) => indexOf.has(a) && indexOf.has(b) && a !== b)
    .slice(0, 255);
  const bytes = new Uint8Array(3 + idBytes.length + stars.length * 2 + 1 + safeEdges.length * 2);
  let o = 0;
  bytes[o++] = VERSION;
  bytes[o++] = idBytes.length;
  bytes.set(idBytes, o);
  o += idBytes.length;
  bytes[o++] = stars.length;
  for (const s of stars) {
    bytes[o++] = clampByte(s.x * 255);
    bytes[o++] = clampByte(s.y * 255);
  }
  bytes[o++] = safeEdges.length;
  for (const [a, b] of safeEdges) {
    bytes[o++] = indexOf.get(a);
    bytes[o++] = indexOf.get(b);
  }
  return bytesToBase64Url(bytes);
}

// Returns { shapeId, stars: [{x,y}], edges: [[i,j]] } or null for malformed input.
// The payload is untrusted (it arrives via a scanned URL), so every read is bounds-checked.
export function decodeShare(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const bytes = base64UrlToBytes(text);
    let o = 0;
    if (bytes[o++] !== VERSION) return null;
    const idLen = bytes[o++] ?? 0;
    const shapeId = idLen ? new TextDecoder().decode(bytes.slice(o, o + idLen)) : null;
    o += idLen;
    const starCount = bytes[o++] ?? 0;
    if (!starCount || starCount > CONFIG.maxStars) return null;
    const stars = [];
    for (let i = 0; i < starCount; i++) {
      const x = bytes[o++] / 255,
        y = bytes[o++] / 255;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      stars.push({ x, y });
    }
    const edgeCount = bytes[o++] ?? 0;
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      const a = bytes[o++],
        b = bytes[o++];
      if (!(a < starCount) || !(b < starCount)) return null;
      edges.push([a, b]);
    }
    return { shapeId, stars, edges };
  } catch {
    return null;
  }
}

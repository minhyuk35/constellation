import { decodeShare } from './data/share.js';
import { SHAPE_MAP } from './data/shapes.js';

const $ = (id) => document.getElementById(id);

function draw(canvas, payload) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const sky = ctx.createRadialGradient(
    width / 2,
    height * 0.4,
    height * 0.06,
    width / 2,
    height * 0.4,
    height * 0.85,
  );
  sky.addColorStop(0, '#1a1638');
  sky.addColorStop(0.55, '#0c0a20');
  sky.addColorStop(1, '#05040d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 220; i++) {
    ctx.globalAlpha = 0.15 + random() * 0.35;
    const r = random() < 0.92 ? 0.8 : 1.6;
    ctx.beginPath();
    ctx.arc(random() * width, random() * height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const pad = height * 0.12;
  const usable = height - pad * 2;
  const toPixel = (p) => ({ x: p.x * width, y: pad + p.y * usable });

  ctx.strokeStyle = 'rgba(196, 214, 234, 0.5)';
  ctx.lineWidth = Math.max(1.5, width * 0.0018);
  for (const [a, b] of payload.edges) {
    const p = toPixel(payload.stars[a]),
      q = toPixel(payload.stars[b]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  const glowRadius = width * 0.028;
  for (const star of payload.stars) {
    const p = toPixel(star);
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.35, 'rgba(200,220,255,0.5)');
    glow.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, width * 0.0042, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(199, 217, 228, 0.8)';
  ctx.font = `${height * 0.018}px Georgia, serif`;
  ctx.fillText('constellation. / 별로 그리는 사람', width * 0.06, height - height * 0.035);
}

try {
  const canvas = $('share-canvas');
  const params = new URLSearchParams(location.hash.slice(1));
  const payload = decodeShare(params.get('d') || '');

  if (!payload || !payload.stars.length) {
    $('share-empty').hidden = false;
  } else {
    draw(canvas, payload);
    const shape = payload.shapeId ? SHAPE_MAP.get(payload.shapeId) : null;
    if (shape) {
      const title = $('share-title');
      title.querySelector('strong').textContent = shape.name;
      title.querySelector('span').textContent = shape.english;
      title.hidden = false;
      const description = $('share-description');
      description.textContent = shape.description;
      description.hidden = false;
    }
    const downloadButton = $('share-download');
    downloadButton.hidden = false;
    downloadButton.addEventListener('click', () => {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `constellation-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    });
  }
} catch (error) {
  console.error('Constellation share page failed:', error);
  $('share-empty').hidden = false;
}

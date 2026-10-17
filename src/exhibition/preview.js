export function paintDrawing(canvas, drawing) {
  const ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min(w, h) * 0.38;
  const points = drawing.stars.map((p) => ({ x: w / 2 + p.x * scale, y: h / 2 - p.y * scale }));
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = '#9ed4e580';
  for (const [a, b] of drawing.edges) {
    ctx.beginPath();
    ctx.moveTo(points[a].x, points[a].y);
    ctx.lineTo(points[b].x, points[b].y);
    ctx.stroke();
  }
  for (const p of points) {
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 15);
    glow.addColorStop(0, '#dbf4ffb0');
    glow.addColorStop(1, '#88d6ff00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf9ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

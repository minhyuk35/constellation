// Coordinates are already centered and normalized to a unit radius. Ignore
// tiny settling movements (about 2–4px in a typical drawing), but never reuse
// a creator QR for a different name, star count, connection, or changed shape.
export const WORK_COORD_TOLERANCE = 0.02;

export function sameWork(ticket, title, drawing) {
  if (!ticket || ticket.title !== title) return false;
  const previous = ticket.drawing;
  if (previous.stars.length !== drawing.stars.length) return false;
  if (!previous.stars.every((p, i) =>
    Math.hypot(p.x - drawing.stars[i].x, p.y - drawing.stars[i].y) <= WORK_COORD_TOLERANCE,
  )) return false;
  const connections = edges => [...new Set(edges.map(([a, b]) =>
    a < b ? `${a}:${b}` : `${b}:${a}`,
  ))].sort().join(',');
  return connections(previous.edges) === connections(drawing.edges);
}

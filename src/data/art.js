export function artwork(shape) {
  const art = shape.art || {
    src: 'art/celestial-atlas.png',
    grid: 4,
    tile: shape.tile,
    credit: 'generated',
  };
  const column = art.tile % art.grid,
    row = Math.floor(art.tile / art.grid);
  // Unequal rows in the generated sheet need explicit sampling rectangles.
  const rows =
    art.src === 'art/zodiac-atlas.png' ? [0, 282 / 1254, 586 / 1254, 888 / 1254, 1] : null;
  const rect = {
    x: column / art.grid,
    y: rows ? rows[row] : row / art.grid,
    w: 1 / art.grid,
    h: rows ? rows[row + 1] - rows[row] : 1 / art.grid,
  };
  return { ...art, rect };
}
export function artCredit(shape) {
  return artwork(shape).credit === 'meuris'
    ? 'Johan Meuris / Stellarium · Free Art License 1.3'
    : 'AI로 제작한 별자리 삽화';
}
export const ART_LICENSE_URL = 'https://artlibre.org/licence/lal/en/';

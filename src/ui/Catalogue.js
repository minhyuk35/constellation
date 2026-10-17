import { SHAPES } from '../data/shapes.js';
import { artwork } from '../data/art.js';
import { SEASONS } from '../data/constellations/stories.js';
const $ = id => document.getElementById(id);

export function filterShapes(filter = 'all', query = '', season = '') {
  return SHAPES.filter(
      (s) =>
        (filter === 'all' || (filter === 'zodiac' ? !!s.zodiac : s.category === filter)) &&
        (!season || s.season === season) &&
        (!query ||
          [s.name, s.english, s.abbr, ...(s.aliases || []), s.zodiac?.dates]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase()
            .replaceAll(' ', '')
            .includes(query)),
    );
}

// The website and VR desktop view use the exact same cards, artwork and filters.
export class Catalogue {
  constructor(actions) { this.actions = actions; this.libraryFilter = 'zodiac'; }
  thumbnail(shape) {
    const art = artwork(shape);
    const div = document.createElement('span');
    div.className = 'art-thumbnail';
    const frame = document.createElement('span');
    frame.className = 'art-thumbnail-image';
    const { x, y, w, h } = art.rect;
    frame.style.backgroundImage = `url("${import.meta.env.BASE_URL}${art.src}")`;
    frame.style.backgroundSize = `${100 / w}% ${100 / h}%`;
    frame.style.backgroundPosition = `${w === 1 ? 0 : (x / (1 - w)) * 100}% ${h === 1 ? 0 : (y / (1 - h)) * 100}%`;
    frame.style.transform = `scale(${Math.min(1, w / h)},${Math.min(1, h / w)})`;
    div.append(frame);
    return div;
  }
  renderLibrary() {
    const filter = this.libraryFilter;
    const query = $('library-search').value.trim().toLocaleLowerCase().replaceAll(' ', '');
    const season = $('library-season').value;
    const shapes = filterShapes(filter, query, season);
    const grid = $('library-grid');
    grid.replaceChildren();
    $('library-count').textContent = `${shapes.length}개의 이야기`;
    $('library-empty').hidden = shapes.length > 0;
    for (const shape of shapes) {
      const card = document.createElement('button');
      card.className = 'library-card';
      card.dataset.shape = shape.id;
      card.setAttribute('aria-label', `${shape.name} 불러오기`);
      const visual = document.createElement('span');
      visual.className = 'library-visual';
      visual.append(this.thumbnail(shape), this.starDiagram(shape));
      if (shape.zodiac) {
        const badge = document.createElement('span');
        badge.className = 'zodiac-badge';
        badge.textContent = shape.zodiac.symbol + '\uFE0E';
        visual.append(badge);
      }
      card.append(visual);
      const title = document.createElement('strong');
      title.textContent = shape.name;
      card.append(title);
      const note = document.createElement('small');
      note.textContent = `${shape.english} · ${shape.points.length} stars`;
      card.append(note);
      const detail = document.createElement('span');
      detail.className = 'library-detail';
      detail.textContent = shape.zodiac?.dates || SEASONS[shape.season] || shape.kind;
      card.append(detail);
      card.addEventListener('click', () => {
        $('library-dialog').close();
        this.actions.preset(shape);
      });
      grid.append(card);
    }
  }
  starDiagram(shape) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-1.15 -1.15 2.3 2.3');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('library-stars');
    for (const [a, b] of shape.edges) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', shape.points[a].x);
      line.setAttribute('y1', -shape.points[a].y);
      line.setAttribute('x2', shape.points[b].x);
      line.setAttribute('y2', -shape.points[b].y);
      svg.append(line);
    }
    for (const p of shape.points) {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', p.x);
      circle.setAttribute('cy', -p.y);
      circle.setAttribute('r', '.021');
      svg.append(circle);
    }
    return svg;
  }
}

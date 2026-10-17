import * as THREE from 'three';
import { filterShapes } from '../ui/Catalogue.js';
import { SkyArtwork } from '../exhibition/SkyArtwork.js';
import { skyIllustration } from '../exhibition/sky-art.js';

export const VR_LIBRARY_PAGE_SIZE = 6;
export class VRLibrary {
  constructor(camera, starTexture, label) {
    this.group = new THREE.Group();
    this.group.position.set(0, .05, -1.15);
    this.group.visible = false;
    camera.add(this.group);
    this.starTexture = starTexture; this.label = label;
    this.filter = 'zodiac'; this.page = 0;
    this.artwork = new SkyArtwork(); this.entries = new Map();
  }
  get visible() { return this.group.visible; }
  set visible(value) { this.group.visible = value; if (value) this.render(); else this.clear(); }
  action(id) {
    if (id === 'library-close') this.visible = false;
    else if (id.startsWith('filter:')) { this.filter = id.slice(7); this.page = 0; this.render(); }
    else if (id === 'library-next' || id === 'library-prev') {
      const pages = Math.ceil(filterShapes(this.filter).length / VR_LIBRARY_PAGE_SIZE);
      this.page = (this.page + (id.endsWith('next') ? 1 : -1) + pages) % pages;
      this.render();
    }
  }
  clear() {
    for (const entry of this.entries.values()) this.artwork.release(entry);
    this.entries.clear();
    for (const child of [...this.group.children]) {
      child.traverse(o => {
        o.geometry?.dispose();
        if (o.material) {
          if (o.material.map && o.material.map !== this.starTexture) o.material.map.dispose();
          o.material.dispose();
        }
      });
      this.group.remove(child);
    }
    this.buttons = [];
  }
  text(text, x, y, width, height, action = null) {
    const mesh = this.label(text, width, height);
    mesh.position.set(x, y, .01);
    this.group.add(mesh);
    if (action) { mesh.userData.action = action; this.buttons.push(mesh); }
    return mesh;
  }
  render() {
    this.clear();
    const background = new THREE.Mesh(new THREE.PlaneGeometry(1.23, 1.03),
      new THREE.MeshBasicMaterial({ color: '#081522', transparent: true, opacity: .97 }));
    background.position.z = -.01; this.group.add(background);
    const shapes = filterShapes(this.filter), pages = Math.ceil(shapes.length / VR_LIBRARY_PAGE_SIZE);
    this.text(`별이 품은 이야기  ·  웹사이트와 같은 200개 도감`, -.04, .455, 1.03, .07);
    this.text('닫기', .535, .455, .115, .07, 'library-close');
    for (const [i, [filter, title]] of [
      ['zodiac', '황도 12궁 · 12'], ['constellation', '공식 별자리 · 88'],
      ['object', '상상의 모양 · 112'], ['all', '전체 · 200'],
    ].entries()) {
      const tab = this.text(title, (i - 1.5) * .285, .367, .265, .07, `filter:${filter}`);
      tab.material.color.set(filter === this.filter ? '#f6d89c' : '#829cad');
    }
    for (const [i, shape] of shapes.slice(this.page * VR_LIBRARY_PAGE_SIZE, (this.page + 1) * VR_LIBRARY_PAGE_SIZE).entries()) {
      const card = new THREE.Group();
      card.position.set((i % 3 - 1) * .385, .14 - Math.floor(i / 3) * .335, 0);
      this.group.add(card);
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(.355, .31),
        new THREE.MeshBasicMaterial({ color: '#102335', transparent: true, opacity: .9 }));
      hit.userData.action = `preset:${shape.id}`;
      card.add(hit); this.buttons.push(hit);
      const visual = new THREE.Group();
      visual.position.set(0, .025, .008); visual.scale.setScalar(.108); card.add(visual);
      const points = shape.points.map(p => new THREE.Vector3(p.x, p.y, .015));
      const stars = new THREE.Points(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.PointsMaterial({ color: '#eef7ff', size: .006, map: this.starTexture,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      visual.add(stars);
      const lines = shape.edges.flatMap(([a, b]) => [points[a], points[b]]);
      visual.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines),
        new THREE.LineBasicMaterial({ color: '#bacfe1', transparent: true, opacity: .55 })));
      const name = this.label(shape.name, .32, .05); name.position.set(0, -.10, .01); card.add(name);
      const note = this.label(`${shape.english} · ${shape.points.length} stars`, .31, .035);
      note.position.set(0, -.137, .01); card.add(note);
      const entry = { group: visual, scale: 1, direction: new THREE.Vector3(),
        illustration: skyIllustration({ title: shape.name }),
        data: { title: shape.name, drawing: { stars: shape.points, edges: shape.edges } } };
      this.entries.set(shape.id, entry);
      this.artwork.attach(entry);
    }
    this.text('← 이전', -.4, -.443, .25, .08, 'library-prev');
    this.text(`${this.page + 1} / ${pages}  ·  ${shapes.length}개의 이야기`, 0, -.443, .5, .065);
    this.text('다음 →', .4, -.443, .25, .08, 'library-next');
  }
  update(now, forward) {
    if (!this.visible) return;
    for (const entry of this.entries.values()) entry.direction.copy(forward);
    this.artwork.update(this.entries, { fov: 100, aspect: 1 }, forward, now);
  }
  dispose() { this.clear(); this.group.removeFromParent(); }
}

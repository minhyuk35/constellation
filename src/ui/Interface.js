import {
  createIcons,
  Orbit,
  VolumeX,
  Volume2,
  CircleHelp,
  SlidersHorizontal,
  Hand,
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  MousePointer2,
  Sparkles,
  Waypoints,
  Undo2,
  RotateCcw,
  Scan,
  Download,
  Maximize,
  Minimize,
  X,
  Grab,
  Camera,
  BookOpen,
  QrCode,
} from 'lucide';
import { SHAPES, SHAPE_MAP } from '../data/shapes.js';
import { readArchive } from '../data/archive.js';
const icons = {
  Orbit,
  VolumeX,
  Volume2,
  CircleHelp,
  SlidersHorizontal,
  Hand,
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  MousePointer2,
  Sparkles,
  Waypoints,
  Undo2,
  RotateCcw,
  Scan,
  Download,
  Maximize,
  Minimize,
  X,
  Grab,
  HandFist: Grab,
  Camera,
  BookOpen,
  QrCode,
};
export const $ = (id) => document.getElementById(id);
export const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.5 } });
export class Interface {
  constructor(actions) {
    this.actions = actions;
    refreshIcons();
    const click = (id, callback) => $(id).addEventListener('click', callback);
    click('mouse-start', actions.start);
    click('nav-create', actions.start);
    click('camera-start', actions.camera);
    click('camera-toggle', actions.camera);
    click('nav-library', () => this.open('library-dialog'));
    click('nav-archive', () => {
      this.renderArchive();
      this.open('archive-dialog');
    });
    click('help-button', () => this.open('help-dialog'));
    click('settings-button', () => this.open('settings-dialog'));
    click('sound-button', actions.sound);
    click('undo-button', actions.undo);
    click('new-button', actions.newCanvas);
    click('interpret-button', actions.interpret);
    click('next-preview', actions.next);
    click('save-button', actions.save);
    click('qr-button', actions.qr);
    click('immersive-button', () => this.immersive(true));
    click('exit-immersive', () => this.immersive(false));
    document
      .querySelectorAll('.close-dialog')
      .forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach((dialog) =>
      dialog.addEventListener('click', (e) => {
        const r = dialog.getBoundingClientRect();
        if (
          e.target === dialog &&
          (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        )
          dialog.close();
      }),
    );
    document
      .querySelectorAll('[data-mode]')
      .forEach((b) => b.addEventListener('click', () => this.mode(b.dataset.mode)));
    document.querySelectorAll('[data-filter]').forEach((b) =>
      b.addEventListener('click', () => {
        document
          .querySelectorAll('[data-filter]')
          .forEach((t) => t.classList.toggle('active', t === b));
        this.renderLibrary(b.dataset.filter);
      }),
    );
    $('art-opacity').addEventListener('input', (e) => {
      $('opacity-value').value = `${Math.round(e.target.value * 100)}%`;
      actions.opacity(Number(e.target.value));
    });
    $('sky-brightness').addEventListener('input', (e) => {
      $('brightness-value').value = `${Math.round(e.target.value * 100)}%`;
      actions.brightness(Number(e.target.value));
    });
    $('auto-recognize').addEventListener('change', (e) => actions.auto(e.target.checked));
    $('reduced-motion').addEventListener('change', (e) => actions.motion(e.target.checked));
    $('quality').addEventListener('change', (e) => actions.quality(e.target.value));
    window.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))
        return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        actions.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (key === 'v') this.mode('move');
      if (key === 'a') this.mode('add');
      if (key === 'c') this.mode('connect');
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        actions.remove();
      }
      if (key === 'h') this.immersive(!document.body.classList.contains('immersive'));
      if (key === 'escape') this.immersive(false);
      if (key === 'enter') actions.interpret();
    });
    this.renderLibrary();
  }
  open(id) {
    $(id).showModal();
  }
  mode(mode) {
    this.actions.start();
    this.actions.mode(mode);
    document.querySelectorAll('[data-mode]').forEach((b) => {
      const active = b.dataset.mode === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    $('gesture-hint').textContent = {
      move: '별을 끌어 움직이거나 빈 곳을 눌러보세요',
      add: '빈 공간을 누르면 별이 태어납니다',
      connect: '별 두 개를 차례로 눌러 연결하세요',
    }[mode];
  }
  immersive(enabled) {
    document.body.classList.toggle('immersive', enabled);
    $('exit-immersive').hidden = !enabled;
    document.querySelectorAll('.chrome').forEach((el) => {
      el.inert = enabled;
    });
  }
  toast(text) {
    $('toast').textContent = text;
    $('toast').classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4800);
  }
  setActive() {
    document.body.classList.add('drawing');
    $('welcome').inert = true;
    $('workspace-status').hidden = false;
  }
  updateCount(model) {
    $('star-count').textContent = `${String(model.stars.length).padStart(2, '0')} STARS`;
    $('undo-button').disabled = !model.history.length || model.dragging;
    $('interpret-button').disabled = model.stars.length < 4 || model.dragging;
  }
  showResult(match, example = false) {
    const s = match.shape;
    $('discovery').hidden = false;
    $('result-type').textContent = example
      ? `CONSTELLATION NO. ${String(SHAPES.indexOf(SHAPE_MAP.get(s.id)) + 1).padStart(2, '0')}`
      : s.category === 'constellation'
        ? 'A CONSTELLATION FOUND'
        : 'A SHAPE IN YOUR STARS';
    $('result-name').textContent = s.name;
    $('result-english').textContent = s.english;
    $('result-description').textContent = s.description;
    $('result-detail').textContent = example
      ? `${s.points.length}개의 별 · ${s.kind}`
      : `형태 유사도 ${match.similarity}% · ${s.kind}`;
    $('scene-status').textContent = example ? '별을 기다리는 중' : `${s.name} 발견`;
    $('next-preview').hidden = !example;
  }
  showQR(dataUrl, url) {
    $('qr-image').src = dataUrl;
    $('qr-link').href = url;
    this.open('qr-dialog');
  }
  clearResult() {
    $('discovery').hidden = true;
    $('star-labels').replaceChildren();
  }
  labels(shape, stars) {
    const layer = $('star-labels');
    layer.replaceChildren();
    if (!shape.labels) return;
    shape.labels.forEach((label, i) => {
      if (!stars[i]) return;
      const el = document.createElement('span');
      el.className = 'star-label';
      el.textContent = label;
      el.style.left = `${stars[i].x * 100}%`;
      el.style.top = `${stars[i].y * 100}%`;
      layer.append(el);
    });
  }
  cameraStatus(status) {
    const on = status === 'active',
      loading = status === 'loading';
    $('input-status').textContent = loading ? 'CONNECTING' : on ? 'HAND TRACKING' : 'MOUSE MODE';
    $('camera-toggle').querySelector('span').textContent = loading
      ? '손 인식 준비 중…'
      : on
        ? '카메라 끄기'
        : '카메라 연결';
    $('camera-start').querySelector('span').textContent = loading
      ? '손 인식 준비 중…'
      : '손으로 시작하기';
    $('camera-start').disabled = loading;
    $('camera-toggle').disabled = loading;
    $('camera-detail').textContent = on
      ? '연결되었습니다. 카메라에 손 전체가 보이도록 해주세요.'
      : '카메라를 켜면 브라우저에서 사용 권한을 요청합니다.';
  }
  sound(enabled) {
    $('sound-button').innerHTML = `<i data-lucide="${enabled ? 'volume-2' : 'volume-x'}"></i>`;
    $('sound-button').setAttribute('aria-pressed', String(enabled));
    $('sound-button').setAttribute('aria-label', enabled ? '사운드 끄기' : '사운드 켜기');
    $('sound-button').title = enabled ? '사운드 끄기' : '사운드 켜기';
    refreshIcons();
  }
  thumbnail(shape) {
    const div = document.createElement('span');
    div.className = 'art-thumbnail';
    div.style.backgroundPosition = `${((shape.tile % 4) * 100) / 3}% ${(Math.floor(shape.tile / 4) * 100) / 3}%`;
    return div;
  }
  renderLibrary(filter = 'all') {
    const grid = $('library-grid');
    grid.replaceChildren();
    for (const shape of SHAPES.filter((s) => filter === 'all' || s.category === filter)) {
      const card = document.createElement('button');
      card.className = 'library-card';
      card.dataset.shape = shape.id;
      card.setAttribute('aria-label', `${shape.name} 불러오기`);
      card.append(this.thumbnail(shape));
      const title = document.createElement('strong');
      title.textContent = shape.name;
      card.append(title);
      const note = document.createElement('small');
      note.textContent = `${shape.english} · ${shape.points.length} stars`;
      card.append(note);
      card.addEventListener('click', () => {
        $('library-dialog').close();
        this.actions.preset(shape);
      });
      grid.append(card);
    }
  }
  renderArchive() {
    const list = $('archive-list');
    list.replaceChildren();
    const entries = readArchive();
    if (!entries.length) {
      list.innerHTML =
        '<div class="empty-archive"><i data-lucide="book-open"></i>아직 비어 있는 당신의 우주.<br>별을 놓고 첫 번째 이야기를 발견해보세요.</div>';
      refreshIcons();
      return;
    }
    for (const entry of entries) {
      const shape = SHAPE_MAP.get(entry.shapeId);
      const button = document.createElement('button');
      button.className = 'archive-entry';
      button.append(this.thumbnail(shape));
      const info = document.createElement('span'),
        title = document.createElement('strong'),
        date = document.createElement('small');
      title.textContent = shape.name;
      date.textContent = `${new Date(entry.createdAt).toLocaleString('ko-KR')} · ${entry.stars.length}개의 별`;
      info.append(title, date);
      button.append(info);
      button.addEventListener('click', () => {
        $('archive-dialog').close();
        this.actions.restore(entry);
      });
      list.append(button);
    }
  }
}

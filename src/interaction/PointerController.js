export class PointerController {
  constructor(stage, model, callbacks) {
    this.stage = stage;
    this.model = model;
    this.callbacks = callbacks;
    this.mode = 'move';
    this.pending = null;
    this.pointerId = null;
    stage.addEventListener('pointerdown', (e) => this.down(e));
    stage.addEventListener('pointermove', (e) => this.move(e));
    stage.addEventListener('pointerup', (e) => this.up(e));
    stage.addEventListener('pointercancel', (e) => this.up(e));
    stage.addEventListener('lostpointercapture', (e) => this.up(e));
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.release());
  }
  point(e) {
    const r = this.stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  setMode(mode) {
    this.mode = mode;
    this.pending = null;
    this.model.select(null);
  }
  down(e) {
    if (e.button !== 0 || this.pointerId !== null) return;
    this.callbacks.activate();
    const p = this.point(e),
      star = this.model.nearest(
        p.x,
        p.y,
        this.stage.clientWidth,
        this.stage.clientHeight,
        e.pointerType === 'touch' ? 38 : 25,
      );
    if (this.mode === 'connect') {
      if (!star) {
        this.pending = null;
        this.model.select(null);
        return;
      }
      if (this.pending) {
        this.model.connect(this.pending, star.id);
        this.pending = null;
        this.callbacks.chime();
      } else this.pending = star.id;
      this.model.select(star.id);
      return;
    }
    if (star) {
      if (this.model.beginDrag(star.id)) {
        this.held = star.id;
        this.pointerId = e.pointerId;
        this.stage.setPointerCapture(e.pointerId);
      }
    } else {
      const created = this.model.add(p.x, p.y);
      if (created) {
        this.callbacks.burst(p);
        this.callbacks.chime();
      } else this.callbacks.toast('한 하늘에 별은 48개까지 놓을 수 있어요.');
    }
  }
  move(e) {
    if (this.held && e.pointerId === this.pointerId) {
      const p = this.point(e);
      this.model.move(this.held, p.x, p.y);
    }
  }
  up(e) {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  }
  release() {
    if (this.held) this.model.endDrag(this.held);
    this.held = null;
    this.pointerId = null;
  }
}

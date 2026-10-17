export const SKY_VISIBLE_LIMIT = 30;

// Random on entry, stable while looking around. Polls can fill empty places,
// but never replace a full sky or move a work someone is already inspecting.
export class SkySelection {
  constructor(random = Math.random, preferredId = null) {
    this.random = random;
    this.preferredId = preferredId;
    this.ids = [];
  }
  update(items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    this.ids = this.ids.filter((id) => byId.has(id));
    if (!this.ids.length && byId.has(this.preferredId)) this.ids.push(this.preferredId);
    const selected = new Set(this.ids);
    const candidates = [...byId.keys()].filter((id) => !selected.has(id));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    this.ids.push(...candidates.slice(0, SKY_VISIBLE_LIMIT - this.ids.length));
    return this.ids.map((id) => byId.get(id));
  }
}

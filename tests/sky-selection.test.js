import test from 'node:test';
import assert from 'node:assert/strict';
import { SkySelection } from '../src/exhibition/sky-selection.js';
test('AR randomly selects at most 30 works and keeps them stable through polling', () => {
  const works = Array.from({ length: 200 }, (_, i) => ({ id: String(i), title: `work${i}` }));
  const selection = new SkySelection(() => 0.23);
  const first = selection.update(works);
  assert.equal(first.length, 30);
  assert.equal(new Set(first.map((w) => w.id)).size, 30);
  assert.notDeepEqual(first, works.slice(0, 30));
  assert.deepEqual(selection.update([...works].reverse()), first);
  assert.deepEqual(selection.update([...works, { id: 'new' }]), first);
  const removed = first[0].id,
    remaining = selection.update(works.filter((w) => w.id !== removed));
  assert.equal(remaining.length, 30);
  assert.ok(!remaining.some((w) => w.id === removed));
  assert.deepEqual(remaining.slice(0, 29), first.slice(1));
});
test('a sparse sky still accepts new works without reordering existing works', () => {
  const selection = new SkySelection(() => 0.5);
  assert.deepEqual(selection.update([{ id: 'a' }]), [{ id: 'a' }]);
  assert.deepEqual(selection.update([{ id: 'b' }, { id: 'a', title: 'updated' }]), [
    { id: 'a', title: 'updated' },
    { id: 'b' },
  ]);
});

test('a creator sees their own work among 29 random others without any camera targeting', () => {
  const works = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }));
  const selection = new SkySelection(() => 0.23, '199'),
    selected = selection.update(works);
  assert.equal(selected.length, 30);
  assert.ok(selected.some((work) => work.id === '199'));
  assert.deepEqual(selection.update(works), selected);
});

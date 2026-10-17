import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.js';
import { SKY_SLOTS, SKY_RADIUS_DEG, drawingPayload } from '../src/exhibition/sky-layout.js';

function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(new URL('../worker/migrations/0001_exhibition.sql', import.meta.url), 'utf8'),
  );
  t.after(() => sqlite.close());
  const env = {
    SESSION_SECRET: 'test-session-secret',
    KIOSK_KEY: 'test-kiosk',
    PUBLIC_ORIGIN: 'https://exhibit.test',
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...v) {
            values = v;
            return this;
          },
          async first() {
            return sqlite.prepare(sql).get(...values) || null;
          },
          async all() {
            return { results: sqlite.prepare(sql).all(...values) };
          },
          async run() {
            return sqlite.prepare(sql).run(...values);
          },
        };
      },
    },
  };
  async function request(path, { method = 'GET', data, token, key, origin } = {}) {
    const response = await worker.fetch(
      new Request(`https://api.test/api${path}`, {
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { 'X-Visitor-Token': token } : {}),
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
      env,
    );
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const draft = () => ({
    requestId: crypto.randomUUID(),
    claimToken: 'b'.repeat(64),
    title: '함께 만든 별',
    drawing: {
      stars: [
        { x: -0.5, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0, y: 0.5 },
      ],
      edges: [
        [0, 1],
        [1, 2],
      ],
    },
  });
  const session = async () => (await request('/session', { method: 'POST' })).data.token;
  return { sqlite, env, request, draft, session };
}
test('sky cell angular separation exceeds every drawing diameter and normalization preserves aspect', () => {
  const vectors = SKY_SLOTS.map(({ yaw, pitch }) => {
    const r = Math.PI / 180;
    return [
      Math.cos(pitch * r) * Math.sin(yaw * r),
      Math.sin(pitch * r),
      Math.cos(pitch * r) * Math.cos(yaw * r),
    ];
  });
  for (let i = 0; i < vectors.length; i++)
    for (let j = 0; j < i; j++) {
      const angle =
        (Math.acos(
          Math.min(
            1,
            vectors[i].reduce((s, v, k) => s + v * vectors[j][k], 0),
          ),
        ) *
          180) /
        Math.PI;
      assert.ok(angle > SKY_RADIUS_DEG * 2 + 2, `${i}/${j}: ${angle}`);
    }
  const d = drawingPayload(
    [
      { id: 'a', x: 0.2, y: 0.2 },
      { id: 'b', x: 0.8, y: 0.8 },
    ],
    [['a', 'b']],
    2,
  );
  assert.equal(d.stars[1].x / -d.stars[1].y, 2);
  assert.ok(d.stars.every((p) => Math.hypot(p.x, p.y) <= 1.001));
});
test('operator connection validates the key and database without creating a work', async (t) => {
  const { request, sqlite, env } = setup(t);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/kiosk/status')).status, 403);
  assert.equal((await request('/kiosk/status', { key: 'wrong-key' })).status, 403);
  const valid = await request('/kiosk/status', { key: 'test-kiosk' });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.storage, 'D1');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM constellations').get().n, 0);
  delete env.KIOSK_KEY;
  assert.equal((await request('/kiosk/status', { key: 'test-kiosk' })).status, 403);
});

test('operator authorization, private draft, one-time claim and anonymous public visibility', async (t) => {
  const { request, draft, session } = setup(t),
    data = draft();
  assert.equal((await request('/constellations', { method: 'POST', data })).status, 403);
  const created = await request('/constellations', { method: 'POST', data, key: 'test-kiosk' });
  assert.equal(created.status, 201);
  assert.equal((await request('/constellations')).data.items.length, 0);
  const id = created.data.id,
    token = await session();
  assert.equal(
    (
      await request(`/constellations/${id}/preview`, {
        method: 'POST',
        token,
        data: { claimToken: 'f'.repeat(64) },
      })
    ).status,
    404,
  );
  const claim = { claimToken: data.claimToken, nickname: '방문객', message: '오늘의 기억' };
  assert.equal(
    (await request(`/constellations/${id}/claim`, { method: 'POST', token, data: claim })).status,
    200,
  );
  assert.equal(
    (await request(`/constellations/${id}/claim`, { method: 'POST', token, data: claim })).status,
    200,
    'safe network retry',
  );
  assert.equal(
    (
      await request(`/constellations/${id}/claim`, {
        method: 'POST',
        token: await session(),
        data: claim,
      })
    ).status,
    409,
  );
  const items = (await request('/constellations')).data.items;
  assert.equal(items.length, 1);
  assert.equal(items[0].nickname, '방문객');
  assert.equal(items[0].claim_hash, undefined);
  assert.equal(items[0].creator, undefined);
});
test('concurrent creations reserve different cells and identical completion retries reserve only one', async (t) => {
  const { request, draft, sqlite } = setup(t),
    data = draft();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      request('/constellations', { method: 'POST', data, key: 'test-kiosk' }),
    ),
  );
  assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
  assert.ok(results.every((r) => [200, 201].includes(r.status)));
  const more = await Promise.all(
    Array.from({ length: 5 }, () =>
      request('/constellations', { method: 'POST', data: draft(), key: 'test-kiosk' }),
    ),
  );
  assert.ok(more.every((r) => r.status === 201));
  assert.equal(sqlite.prepare('SELECT COUNT(DISTINCT slot) AS n FROM constellations').get().n, 6);
});

test('a published title replaces new QR requests with its owner, including old draft retries', async t => {
  const {request,draft,session,sqlite}=setup(t), a=draft(), b=draft();
  const create=data=>request('/constellations',{method:'POST',data,key:'test-kiosk'});
  const first=(await create(a)).data.id, pending=(await create(b)).data.id;
  const token=await session();
  assert.equal((await request(`/constellations/${first}/claim`,{method:'POST',token,data:{claimToken:a.claimToken,nickname:'먼저 온 별',message:'내 이야기'}})).status,200);
  for(const data of [a,b,draft()]) {
    const result=await create(data);
    assert.equal(result.data.occupied,true); assert.equal(result.data.owner.nickname,'먼저 온 별'); assert.equal(result.data.id,undefined);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM constellations').get().n,2);
  const availability=await request(`/kiosk/availability?title=${encodeURIComponent(a.title)}`,{key:'test-kiosk'});
  assert.equal(availability.data.occupied,true);
  const preview=await request(`/constellations/${pending}/preview`,{method:'POST',token,data:{claimToken:b.claimToken}});
  assert.equal(preview.data.occupied,true);
  const blocked=await request(`/constellations/${pending}/claim`,{method:'POST',token,data:{claimToken:b.claimToken,nickname:'나중',message:'덮어쓸 수 없음'}});
  assert.equal(blocked.status,409); assert.equal(blocked.data.code,'CONSTELLATION_OCCUPIED');
});

test('simultaneous claims for the same title have exactly one winner; generic free drawings stay independent',async t=>{
  const {request,draft,session,sqlite}=setup(t), token=await session();
  const create=data=>request('/constellations',{method:'POST',data,key:'test-kiosk'});
  const claim=(id,data)=>request(`/constellations/${id}/claim`,{method:'POST',token,data:{claimToken:data.claimToken,nickname:id.slice(0,4),message:'빛'}});
  const a=draft(),b=draft(), ids=await Promise.all([create(a),create(b)]);
  const results=await Promise.all(ids.map((r,i)=>claim(r.data.id,[a,b][i])));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM constellations WHERE published_at IS NOT NULL').get().n,1);
  for(let i=0;i<2;i++) {
    const data={...draft(),title:'이름 없는 별자리'}, id=(await create(data)).data.id;
    assert.equal((await claim(id,data)).status,200);
  }
});
test('likes are per browser session, idempotent and reversible; comment retries do not duplicate', async (t) => {
  const { request, draft, session } = setup(t),
    data = draft(),
    token = await session();
  const id = (await request('/constellations', { method: 'POST', data, key: 'test-kiosk' })).data
    .id;
  await request(`/constellations/${id}/claim`, {
    method: 'POST',
    token,
    data: { claimToken: data.claimToken, nickname: '한별', message: '반가워요' },
  });
  const path = `/constellations/${id}`;
  const likes = await Promise.all(
    Array.from({ length: 5 }, () =>
      request(`${path}/like`, { method: 'PUT', token, data: { liked: true } }),
    ),
  );
  assert.ok(likes.every((r) => r.status === 200 && r.data.likes === 1));
  const other = await session();
  assert.equal(
    (await request(`${path}/like`, { method: 'PUT', token: other, data: { liked: true } })).data
      .likes,
    2,
  );
  assert.equal(
    (await request(`${path}/like`, { method: 'PUT', token, data: { liked: false } })).data.likes,
    1,
  );
  assert.equal((await request(path, { token })).data.liked, false);
  const comment = { requestId: crypto.randomUUID(), body: '<script>있는 그대로의 말</script>' };
  await request(`${path}/comments`, { method: 'POST', token, data: comment });
  await request(`${path}/comments`, { method: 'POST', token, data: comment });
  const comments = (await request(`${path}/comments`, { token })).data.items;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].body, comment.body);
  assert.equal(
    (await request(`${path}/comments`, { method: 'POST', token: other, data: comment })).status,
    409,
  );
  assert.equal((await request(`${path}/comments`)).status, 401);
});
test('same-timestamp comment pages do not lose or repeat entries', async (t) => {
  const { request, draft, session, sqlite } = setup(t),
    data = draft(),
    token = await session();
  const id = (await request('/constellations', { method: 'POST', data, key: 'test-kiosk' })).data
    .id;
  await request(`/constellations/${id}/claim`, {
    method: 'POST',
    token,
    data: { claimToken: data.claimToken, nickname: 'a', message: 'b' },
  });
  for (let i = 0; i < 35; i++)
    sqlite
      .prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), id, token.split('.')[0], `comment ${i}`, 1234567890000);
  const first = (await request(`/constellations/${id}/comments`, { token })).data;
  assert.equal(first.items.length, 30);
  assert.ok(first.next);
  const second = (
    await request(`/constellations/${id}/comments?before=${encodeURIComponent(first.next)}`, {
      token,
    })
  ).data;
  assert.equal(second.items.length, 5);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.items, ...second.items].map((c) => c.id)).size, 35);
});
test('invalid data, forged sessions, untrusted origins and excess posting are rejected', async (t) => {
  const { request, draft, session } = setup(t),
    data = draft(),
    token = await session();
  assert.equal((await request('/constellations', { origin: 'https://evil.test' })).status, 403);
  assert.equal(
    (await request('/constellations', { origin: 'https://exhibit.test' })).headers.get(
      'access-control-allow-origin',
    ),
    'https://exhibit.test',
  );
  const bad = {
    ...data,
    drawing: {
      ...data.drawing,
      stars: [
        { x: 9, y: 0 },
        { x: 0, y: 0 },
      ],
    },
  };
  assert.equal(
    (await request('/constellations', { method: 'POST', data: bad, key: 'test-kiosk' })).status,
    400,
  );
  const id = (await request('/constellations', { method: 'POST', data, key: 'test-kiosk' })).data
    .id;
  const path = `/constellations/${id}`;
  assert.equal(
    (
      await request(`${path}/claim`, {
        method: 'POST',
        token: token + 'a',
        data: { claimToken: data.claimToken, nickname: 'a', message: 'b' },
      })
    ).status,
    401,
  );
  await request(`${path}/claim`, {
    method: 'POST',
    token,
    data: { claimToken: data.claimToken, nickname: 'a', message: 'b' },
  });
  assert.equal(
    (
      await request(`${path}/comments`, {
        method: 'POST',
        token,
        data: { requestId: crypto.randomUUID(), body: 'a'.repeat(301) },
      })
    ).status,
    400,
  );
  for (let i = 0; i < 6; i++)
    assert.equal(
      (
        await request(`${path}/comments`, {
          method: 'POST',
          token,
          data: { requestId: crypto.randomUUID(), body: 'hi' },
        })
      ).status,
      201,
    );
  assert.equal(
    (
      await request(`${path}/comments`, {
        method: 'POST',
        token,
        data: { requestId: crypto.randomUUID(), body: 'hi' },
      })
    ).status,
    429,
  );
});

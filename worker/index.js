import { SKY_SLOTS } from '../src/exhibition/sky-layout.js';
export { VRMonitorRoom } from './vr-monitor.js';

const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class HttpError extends Error {
  constructor(status, message, detail = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
const fail = (status, message, detail) => {
  throw new HttpError(status, message, detail);
};
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function hash(text) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
async function sign(text, env) {
  if (!env.SESSION_SECRET) fail(503, '전시 서버의 인증 설정이 필요합니다.');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function requireKiosk(request, env) {
  if (
    !env.KIOSK_KEY ||
    !safeEqual(request.headers.get('Authorization'), `Bearer ${env.KIOSK_KEY}`)
  )
    fail(403, '운영자 키가 올바르지 않습니다. 전시 연결에서 다시 입력해 주세요.');
}
async function visitor(request, env) {
  const token = request.headers.get('X-Visitor-Token') || '';
  const [id, expires, signature] = token.split('.');
  if (
    !uuid.test(id || '') ||
    !/^\d{13}$/.test(expires || '') ||
    Number(expires) < Date.now() ||
    !safeEqual(signature, await sign(`${id}.${expires}`, env))
  )
    fail(401, '관람 세션이 만료되었습니다. 다시 시도해 주세요.');
  return id;
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    fail(415, 'JSON 요청이 필요합니다.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '내용을 입력해 주세요.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      fail(413, '요청 내용이 너무 큽니다.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {}
  fail(400, '요청 내용을 읽지 못했습니다.');
}
function textField(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(400, `${name}: 1~${max}자로 입력해 주세요.`);
  return value.trim();
}
function drawingField(d) {
  if (
    !d ||
    !Array.isArray(d.stars) ||
    d.stars.length < 2 ||
    d.stars.length > 48 ||
    !Array.isArray(d.edges) ||
    d.edges.length > 128
  )
    fail(400, '별자리 데이터를 확인해 주세요.');
  if (
    d.stars.some(
      (p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.hypot(p.x, p.y) > 1.001,
    )
  )
    fail(400, '별 좌표가 올바르지 않습니다.');
  if (
    d.edges.some(
      (e) =>
        !Array.isArray(e) ||
        e.length !== 2 ||
        e[0] === e[1] ||
        e.some((v) => !Number.isInteger(v) || v < 0 || v >= d.stars.length),
    )
  )
    fail(400, '연결선이 올바르지 않습니다.');
  return JSON.stringify({ stars: d.stars.map(({ x, y }) => ({ x, y })), edges: d.edges });
}
async function limit(env, key, maximum) {
  const window = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits(key, window, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END,
    window = excluded.window RETURNING count`,
  )
    .bind(key, window)
    .first();
  if (row.count > maximum) fail(429, '잠시 쉬었다가 다시 시도해 주세요.');
}
const publicWork = (row) => ({
  id: row.id,
  title: row.title,
  drawing: JSON.parse(row.drawing),
  slot: row.slot,
  direction: SKY_SLOTS[row.slot],
  nickname: row.nickname,
  message: row.message,
  publishedAt: row.published_at,
});

// The catalogue title is the stable identity used by existing saved works.
// Unmatched free drawings share a generic title and remain independent.
const FREE_TITLE = '이름 없는 별자리';
async function claimedOwner(env, title) {
  if (title === FREE_TITLE) return null;
  return env.DB.prepare(
    'SELECT id, title, nickname FROM constellations WHERE title = ? AND published_at IS NOT NULL ORDER BY published_at, id LIMIT 1',
  ).bind(title).first();
}
const occupiedResult = owner => ({ occupied: true, owner });

async function route(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if(path.startsWith('/api/vr-monitor/')) {
    if(!env.VR_MONITOR)fail(503,'VR 모니터링 서버가 아직 연결되지 않았습니다.');
    if(method === 'POST' && path === '/api/vr-monitor/ticket') {
      const data=await body(request);
      if(!['operator','device'].includes(data.role))fail(400,'접속 유형을 확인해 주세요.');
      let id;
      if(data.role === 'operator') { requireKiosk(request,env);id=crypto.randomUUID(); }
      else id=await visitor(request,env);
      const claims={role:data.role,id,expires:Date.now()+60000,
        name:data.role === 'device'?textField(data.name,24,'기기 이름'):'운영자',
        platform:data.role === 'device'?textField(data.platform,40,'기기 유형'):'운영자'};
      const payload=btoa(String.fromCharCode(...encoder.encode(JSON.stringify(claims)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      return json({ticket:`${payload}.${await sign(payload,env)}`});
    }
    if(method === 'GET' && path === '/api/vr-monitor/socket') {
      if(request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')fail(426,'WebSocket 연결이 필요합니다.');
      const [payload,signature]=String(url.searchParams.get('ticket') || '').split('.');
      if(!payload || payload.length > 2048 || !safeEqual(signature,await sign(payload,env)))fail(403,'모니터링 인증이 만료되었습니다.');
      let claims;
      try { claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)))); }
      catch { fail(403,'모니터링 인증을 확인해 주세요.'); }
      if(!['operator','device'].includes(claims?.role) || !uuid.test(claims.id || '') ||
        !Number.isFinite(claims.expires) || claims.expires < Date.now())fail(403,'모니터링 인증이 만료되었습니다.');
      const headers=new Headers({Upgrade:'websocket','X-Monitor-Claims':encodeURIComponent(JSON.stringify(claims))});
      return env.VR_MONITOR.get(env.VR_MONITOR.idFromName('exhibition')).fetch(new Request('https://monitor.internal/',{headers}));
    }
    fail(404,'모니터링 주소를 확인해 주세요.');
  }
  if (method === 'GET' && (path === '/api/health' || path === '/api/kiosk/status')) {
    if (path === '/api/kiosk/status') requireKiosk(request, env);
    await env.DB.prepare('SELECT id FROM constellations LIMIT 1').all();
    return json({ ok: true, storage: 'D1', capacity: SKY_SLOTS.length });
  }
  if (method === 'GET' && path === '/api/kiosk/availability') {
    requireKiosk(request, env);
    const title = textField(url.searchParams.get('title'), 60, '별자리 이름');
    const owner = await claimedOwner(env, title);
    return json(owner ? occupiedResult(owner) : { occupied: false });
  }
  if (method === 'POST' && path === '/api/session') {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    await limit(env, `session:${await hash(ip)}`, 200);
    const payload = `${crypto.randomUUID()}.${Date.now() + 7 * 86400000}`;
    return json({ token: `${payload}.${await sign(payload, env)}` });
  }
  if (method === 'GET' && path === '/api/constellations') {
    const rows = await env.DB.prepare(
      'SELECT id, title, drawing, slot, nickname, message, published_at FROM constellations WHERE published_at IS NOT NULL ORDER BY published_at LIMIT ?',
    )
      .bind(SKY_SLOTS.length)
      .all();
    return json({ items: rows.results.map(publicWork), capacity: SKY_SLOTS.length });
  }
  if (method === 'POST' && path === '/api/constellations') {
    requireKiosk(request, env);
    const data = await body(request);
    if (!uuid.test(data.requestId || '') || !/^[a-f0-9]{64}$/.test(data.claimToken || ''))
      fail(400, '작품 등록 번호가 올바르지 않습니다.');
    const drawing = drawingField(data.drawing),
      title = textField(data.title, 60, '별자리 이름');
    const claimHash = await hash(data.claimToken);
    const existing = await env.DB.prepare(
      'SELECT id, claim_hash FROM constellations WHERE request_id = ?',
    )
      .bind(data.requestId)
      .first();
    if (existing) {
      if (!safeEqual(claimHash, existing.claim_hash)) fail(409, '등록 번호가 이미 사용되었습니다.');
      const owner = await claimedOwner(env, title);
      if (owner) return json(occupiedResult(owner));
      return json({ id: existing.id });
    }
    const owner = await claimedOwner(env, title);
    if (owner) return json(occupiedResult(owner));
    await limit(env, 'kiosk:create', 30);
    // Expired, unclaimed drafts do not consume sky capacity indefinitely.
    await env.DB.prepare('DELETE FROM constellations WHERE published_at IS NULL AND created_at < ?')
      .bind(Date.now() - 86400000)
      .run();
    const id = crypto.randomUUID();
    // Choose an empty cell AND insert in one statement. Concurrent kiosks cannot
    // reserve the same cell or produce duplicate request IDs.
    await env.DB.prepare(
      `WITH RECURSIVE cells(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM cells WHERE n+1 < ?)
      INSERT INTO constellations(id, request_id, claim_hash, slot, title, drawing, created_at)
      SELECT ?, ?, ?, n, ?, ?, ? FROM cells WHERE n NOT IN (SELECT slot FROM constellations)
      AND (? = ? OR NOT EXISTS (SELECT 1 FROM constellations WHERE title = ? AND published_at IS NOT NULL))
      ORDER BY RANDOM() LIMIT 1 ON CONFLICT(request_id) DO NOTHING`,
    )
      .bind(SKY_SLOTS.length, id, data.requestId, claimHash, title, drawing, Date.now(), title, FREE_TITLE, title)
      .run();
    const saved = await env.DB.prepare(
      'SELECT id, claim_hash FROM constellations WHERE request_id = ?',
    )
      .bind(data.requestId)
      .first();
    if (!saved) {
      const owner = await claimedOwner(env, title);
      if (owner) return json(occupiedResult(owner));
      fail(409, '오늘의 하늘이 가득 찼어요. 운영자에게 알려 주세요.');
    }
    if (!safeEqual(saved.claim_hash, claimHash)) fail(409, '등록 번호가 이미 사용되었습니다.');
    return json({ id: saved.id }, 201);
  }
  const match = path.match(
    /^\/api\/constellations\/([0-9a-f-]{36})(?:\/(claim|comments|like|preview))?$/,
  );
  if (!match || !uuid.test(match[1])) fail(404, '페이지를 찾지 못했습니다.');
  const [, id, action] = match;
  if (method === 'POST' && (action === 'claim' || action === 'preview')) {
    const who = await visitor(request, env),
      data = await body(request);
    if (!/^[a-f0-9]{64}$/.test(data.claimToken || '')) fail(403, '만든 사람의 QR로 접속해 주세요.');
    const row = await env.DB.prepare('SELECT * FROM constellations WHERE id = ?').bind(id).first();
    if (!row || !safeEqual(row.claim_hash, await hash(data.claimToken)))
      fail(404, '유효한 작품 QR이 아닙니다.');
    if (!row.published_at && Date.now() - row.created_at > 86400000)
      fail(410, '작성 시간이 만료되었습니다. 새 별자리를 만들어 주세요.');
    if (action === 'preview') {
      const owner = !row.published_at && await claimedOwner(env, row.title);
      return json({ ...publicWork(row), claimed: !!row.published_at, ...(owner ? occupiedResult(owner) : {}) });
    }
    const nickname = textField(data.nickname, 24, '닉네임'),
      message = textField(data.message, 500, '이야기');
    await limit(env, `claim:${who}`, 10);
    const updated = await env.DB.prepare(
      `UPDATE constellations SET nickname = ?, message = ?, creator = ?, published_at = ?
      WHERE id = ? AND published_at IS NULL
      AND (title = ? OR NOT EXISTS (
        SELECT 1 FROM constellations claimed WHERE claimed.title = ? AND claimed.published_at IS NOT NULL
      )) RETURNING id`,
    )
      .bind(nickname, message, who, Date.now(), id, FREE_TITLE, row.title)
      .first();
    if (!updated && !(row.creator === who && row.nickname === nickname && row.message === message)) {
      const owner = await claimedOwner(env, row.title);
      fail(409, owner ? `${owner.nickname} 님이 이미 이 별자리를 차지했어요!` : '이미 이야기가 등록된 별자리입니다.',
        { code: 'CONSTELLATION_OCCUPIED', ...(owner ? { owner } : {}) });
    }
    return json({ id });
  }
  const row = await env.DB.prepare(
    'SELECT id, title, drawing, slot, nickname, message, published_at FROM constellations WHERE id = ? AND published_at IS NOT NULL',
  )
    .bind(id)
    .first();
  if (!row) fail(404, '아직 공개되지 않은 별자리입니다.');
  const who = await visitor(request, env);
  if (method === 'GET' && !action) {
    const counts = await env.DB.prepare(
      `SELECT COUNT(*) AS likes, COALESCE(MAX(visitor = ?), 0) AS liked FROM likes WHERE constellation_id = ?`,
    )
      .bind(who, id)
      .first();
    return json({ ...publicWork(row), ...counts, liked: !!counts.liked });
  }
  if (method === 'GET' && action === 'comments') {
    const before = url.searchParams.get('before') || '~';
    const comments = await env.DB.prepare(
      `SELECT id, body, created_at, substr(visitor, 1, 4) AS author FROM comments
      WHERE constellation_id = ? AND (printf('%013d', created_at) || ':' || id) < ? ORDER BY created_at DESC, id DESC LIMIT 31`,
    )
      .bind(id, before)
      .all();
    const more = comments.results.length > 30,
      items = comments.results.slice(0, 30),
      last = items.at(-1);
    return json({
      items,
      next: more ? `${String(last.created_at).padStart(13, '0')}:${last.id}` : null,
    });
  }
  if (method === 'PUT' && action === 'like') {
    const data = await body(request);
    if (typeof data.liked !== 'boolean') fail(400, '좋아요 상태를 확인해 주세요.');
    await limit(env, `like:${who}`, 30);
    if (data.liked)
      await env.DB.prepare(
        'INSERT INTO likes(constellation_id, visitor) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(id, who)
        .run();
    else
      await env.DB.prepare('DELETE FROM likes WHERE constellation_id = ? AND visitor = ?')
        .bind(id, who)
        .run();
    const result = await env.DB.prepare(
      'SELECT COUNT(*) AS likes FROM likes WHERE constellation_id = ?',
    )
      .bind(id)
      .first();
    return json({ ...result, liked: data.liked });
  }
  if (method === 'POST' && action === 'comments') {
    const data = await body(request),
      message = textField(data.body, 300, '댓글');
    if (!uuid.test(data.requestId || '')) fail(400, '댓글 등록 번호가 올바르지 않습니다.');
    await limit(env, `comment:${who}`, 6);
    await env.DB.prepare(
      'INSERT INTO comments(id, constellation_id, visitor, body, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(data.requestId, id, who, message, Date.now())
      .run();
    const saved = await env.DB.prepare(
      'SELECT visitor, constellation_id, body FROM comments WHERE id = ?',
    )
      .bind(data.requestId)
      .first();
    if (saved.visitor !== who || saved.constellation_id !== id || saved.body !== message)
      fail(409, '댓글 등록 번호가 이미 사용되었습니다.');
    return json({ id: data.requestId }, 201);
  }
  fail(405, '지원하지 않는 요청입니다.');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = new Set((env.PUBLIC_ORIGIN || '').split(',').map((s) => s.trim()));
    if (env.LOCAL_DEV === 'true') {
      allowed.add('http://127.0.0.1:5173');
      allowed.add('http://localhost:5173');
    }
    if (origin && !allowed.has(origin))
      return json({ error: '허용되지 않은 접속 주소입니다.' }, 403);
    let response;
    try {
      response =
        request.method === 'OPTIONS'
          ? new Response(null, { status: 204 })
          : await route(request, env);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Exhibition API failed:', error.message);
      response = json(
        {
          error:
            error instanceof HttpError
              ? error.message
              : '전시 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          ...(error.detail || {}),
        },
        error.status || 503,
      );
    }
    const headers = new Headers(response.headers);
    if(response.status === 101)return response;
    headers.set('X-Content-Type-Options', 'nosniff');
    if (origin && allowed.has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Visitor-Token');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      headers.set('Access-Control-Max-Age', '86400');
    }
    return new Response(response.body, { status: response.status, headers });
  },
};

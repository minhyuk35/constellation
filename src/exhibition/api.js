const origin = (import.meta.env.VITE_EXHIBITION_API_URL || '').replace(/\/$/, '');
let sessionPromise;
export const exhibitionEnabled = import.meta.env.DEV || !!origin;
export const publicUrl = (page) =>
  new URL(page, `${(import.meta.env.VITE_PUBLIC_SITE_URL || location.origin).replace(/\/$/, '')}/`)
    .href;
export function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
export function kioskKey() {
  return (
    readLocal('constellation-kiosk-key') || (import.meta.env.DEV ? 'local-exhibition-only' : '')
  );
}
async function session() {
  const saved = readLocal('constellation-visitor');
  if (saved && Number(saved.split('.')[1]) > Date.now() + 60000) return saved;
  if (!sessionPromise)
    sessionPromise = fetch(`${origin}/api/session`, { method: 'POST' })
      .then(parse)
      .then(({ token }) => {
        writeLocal('constellation-visitor', token);
        return token;
      })
      .finally(() => {
        sessionPromise = null;
      });
  return sessionPromise;
}
async function parse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '전시 서버 연결을 확인해 주세요.');
    error.code = data.code;
    error.owner = data.owner;
    throw error;
  }
  return data;
}
export async function api(
  path,
  { method = 'GET', body, anonymous = false, kiosk = false, operatorKey } = {},
) {
  const headers = {};
  if (!anonymous && !kiosk) headers['X-Visitor-Token'] = await session();
  if (kiosk) headers.Authorization = `Bearer ${operatorKey ?? kioskKey()}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    return await parse(
      await fetch(`${origin}/api${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      }),
    );
  } catch (error) {
    if (error.name === 'TimeoutError' || error instanceof TypeError)
      throw new Error('전시 서버에 연결할 수 없어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    throw error;
  }
}

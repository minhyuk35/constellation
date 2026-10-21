// A bounded representation of the VR sandbox, shared by the relay
// and spectator. No history, visitor identity, camera images or operator key.
export const MONITOR_INTERVAL = 100;
export const HEARTBEAT_INTERVAL = 5000;
export const CONNECTION_TIMEOUT = 30000;
export const MAX_MONITOR_MESSAGE = 512 * 1024;
const idPattern = /^[\w-]{1,80}$/;
const number = (n, max = 100) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
const text = (s, max) => typeof s === 'string' && s.length <= max && !/[\u0000-\u001f]/.test(s);
const check = (ok) => { if (!ok) throw new Error('Invalid monitor data'); };
const round = n => Math.round(n * 10000) / 10000;
export function cleanTutorialCommand(command) {
  check(command && /^[a-f0-9-]{36}$/i.test(command.requestId) && ['tutorial-start','tutorial-stop'].includes(command.action));
  return {requestId:command.requestId,action:command.action};
}
export function cleanGuide(guide) {
  check(guide && ['idle','ready','create','grab','move','delete','done'].includes(guide.step));
  check(['hand','mouse','controller'].includes(guide.mode));
  return {step:guide.step,mode:guide.mode,position:tuple(guide.position,3),quaternion:unit(guide.quaternion,4),target:guide.target===null?null:tuple(guide.target,3)};
}
export const vector = p => [round(p.x), round(p.y), round(p.z)];
export const rotation = q => [round(q.x), round(q.y), round(q.z), round(q.w)];
function tuple(value, length, max = 100) {
  check(Array.isArray(value) && value.length === length && value.every(n => number(n, max)));
  return value.map(round);
}
function point(p) {
  check(p && number(p.x) && number(p.y) && number(p.z));
  return { x: round(p.x), y: round(p.y), z: round(p.z) };
}
function quaternion(q) {
  check(q && [q.x,q.y,q.z,q.w].every(n => number(n, 1.01)));
  const length = Math.hypot(q.x,q.y,q.z,q.w);
  check(length > .9 && length < 1.1);
  return { x: q.x/length, y: q.y/length, z: q.z/length, w: q.w/length };
}
export function cleanEntity(entity) {
  check(entity && typeof entity.id === 'string' && idPattern.test(entity.id) && text(entity.title, 60));
  check(!entity.shapeId || (text(entity.shapeId,80) && idPattern.test(entity.shapeId)));
  check(number(entity.scale, 5) && entity.scale > 0);
  check(Array.isArray(entity.stars) && entity.stars.length <= 48);
  const ids = new Set();
  const stars = entity.stars.map(star => {
    check(star && typeof star.id === 'string' && idPattern.test(star.id) && !ids.has(star.id)); ids.add(star.id);
    return { id:star.id, ...point(star) };
  });
  check(Array.isArray(entity.edges) && entity.edges.length <= 1128);
  const edges = entity.edges.map(edge => {
    check(Array.isArray(edge) && edge.length === 2 && edge[0] !== edge[1] &&
      edge.every(i => Number.isInteger(i) && i >= 0 && i < stars.length));
    return [...edge];
  });
  return { id:entity.id, title:entity.title, shapeId:entity.shapeId || null,
    scale:entity.scale, position:point(entity.position), quaternion:quaternion(entity.quaternion),
    stars, edges, editing:!!entity.editing };
}
export function cleanSnapshot(state) {
  check(state && Array.isArray(state.works) && state.works.length <= 24);
  const draft=cleanEntity(state.draft), works=state.works.map(cleanEntity);
  check(new Set([draft.id,...works.map(w=>w.id)]).size === works.length + 1);
  return { draft, works };
}
export function cleanPatch(value) {
  check(Array.isArray(value) && value.length > 0 && value.length <= 25);
  const entities=value.map(cleanEntity);
  check(new Set(entities.map(e=>e.id)).size === entities.length);
  return entities;
}
function unit(value, length) {
  const result=tuple(value,length,1.01),size=Math.hypot(...result);
  check(size > .9 && size < 1.1);
  return result.map(n=>n/size);
}
export function cleanFrame(frame) {
  check(frame && frame.head && frame.ui && Array.isArray(frame.hands) && frame.hands.length <= 2);
  const head={position:tuple(frame.head.position,3),quaternion:unit(frame.head.quaternion,4)};
  check(number(frame.head.fov,150) && frame.head.fov >= 30);
  head.fov=frame.head.fov;
  const ui={position:tuple(frame.ui.position,3),quaternion:unit(frame.ui.quaternion,4),
    library:!!frame.ui.library,filter:frame.ui.filter,page:frame.ui.page};
  check(['all','zodiac','constellation','object'].includes(ui.filter));
  check(Number.isInteger(ui.page) && ui.page >= 0 && ui.page < 34);
  // Optional for old headset clients; continuous scroll stays bounded and is
  // replayed by the operator without sending any extra catalogue geometry.
  if(frame.ui.scroll!==undefined) {
    check(number(frame.ui.scroll,1) && frame.ui.scroll>=0);
    ui.scroll=round(frame.ui.scroll);
  }
  if(frame.ui.guide!==undefined)ui.guide=cleanGuide(frame.ui.guide);
  const hands=frame.hands.map(hand=>{
    check(hand && ['hand','controller'].includes(hand.source));
    check(['left','right','none'].includes(hand.side));
    check(['lost','open','point','pinch','fist'].includes(hand.gesture));
    check(Array.isArray(hand.points) && (hand.points.length === 0 || hand.points.length === 21));
    return {source:hand.source,side:hand.side,gesture:hand.gesture,held:!!hand.held,
      points:hand.points.map(p=>tuple(p,3)),origin:tuple(hand.origin,3),direction:unit(hand.direction,3)};
  });
  const effects=(frame.effects || []).map(effect=>{
    check(effect && ['create','delete'].includes(effect.kind));
    return {kind:effect.kind,point:tuple(effect.point,3)};
  });
  check(effects.length <= 8);
  return {head,ui,hands,effects};
}
export function cleanStatus(status) {
  check(status && typeof status.paused === 'boolean');
  for (const [field,max] of [['stars',1200],['works',24],['hands',2]])
    check(Number.isInteger(status[field]) && status[field] >= 0 && status[field] <= max);
  return {paused:status.paused,stars:status.stars,works:status.works,hands:status.hands};
}

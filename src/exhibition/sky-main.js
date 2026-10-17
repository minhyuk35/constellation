import { api } from './api.js';
import { SkyView } from './SkyView.js';
import { skyIllustration } from './sky-art.js';
import { artCredit, ART_LICENSE_URL } from '../data/art.js';
import { SkySelection } from './sky-selection.js';
let preferredId = null;
try {
  preferredId = sessionStorage.getItem('constellation-latest-owned');
  sessionStorage.removeItem('constellation-latest-owned');
} catch {}
const skySelection = new SkySelection(Math.random, preferredId);
const $ = (id) => document.getElementById(id);
const status = (text) => {
  $('sky-status').textContent = text;
};
let view,
  focused,
  selected,
  items = [],
  nextComments = null,
  requestGeneration = 0,
  pollTimer,
  stream,
  loading = false;
let commentRequest;

function setFocus(work) {
  focused = work;
  $('inspect-button').disabled = !work;
  $('sky-reticle').classList.toggle('found', !!work);
  $('focus-label').textContent = work
    ? `${work.title} · ${work.nickname}`
    : '별자리를 화면 중앙에 담아보세요';
}
async function loadSky() {
  if (loading || document.hidden) return;
  loading = true;
  try {
    const data = await api('/constellations', { anonymous: true });
    items = skySelection.update(data.items);
    view?.setWorks(items);
    $('sky-count').textContent = items.length;
    if (!view) return;
    status(
      items.length
        ? `${items.length}개의 별자리가 떠 있어요 · 중앙에 담으면 오른쪽 아래에서 이야기를 열 수 있어요`
        : '아직 이야기가 없어요. 큰 화면에서 만든 별자리에 이야기를 남기면 여기에 떠올라요.',
    );
  } catch (error) {
    status(error.message);
  } finally {
    loading = false;
  }
}
function motionLabel(active) {
  $('motion-button').textContent = active ? '방향 센서 끄기' : '방향 센서 켜기';
  $('motion-button').setAttribute('aria-pressed', String(active));
}
async function enableMotion() {
  if (!view) return;
  if (view.motion) {
    view.setMotion(false);
    motionLabel(false);
    return;
  }
  try {
    if (!window.DeviceOrientationEvent)
      throw new Error('이 기기는 방향 센서를 지원하지 않아요. 화면을 밀어서 둘러보세요.');
    if (
      typeof DeviceOrientationEvent.requestPermission === 'function' &&
      (await DeviceOrientationEvent.requestPermission()) !== 'granted'
    )
      throw new Error('방향 권한을 허용하지 않았어요. 화면을 밀어서 둘러볼 수 있어요.');
    view.lastMotion = 0;
    view.setMotion(true);
    motionLabel(true);
    setTimeout(() => {
      if (view?.motion && !view.lastMotion) {
        view.setMotion(false);
        motionLabel(false);
        status('방향 정보를 받을 수 없어요. 화면을 밀어서 둘러보세요.');
      }
    }, 2500);
  } catch (error) {
    status(error.message);
  }
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('ar-camera').srcObject = null;
  document.body.classList.remove('camera-on');
  $('camera-button').textContent = '카메라 켜기';
  $('camera-button').setAttribute('aria-pressed', 'false');
}
async function enableCamera() {
  if (stream) {
    stopCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    status('카메라는 HTTPS 주소에서 사용할 수 있어요. 화면으로도 감상할 수 있습니다.');
    return;
  }
  $('camera-button').disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    $('ar-camera').srcObject = stream;
    await $('ar-camera').play();
    document.body.classList.add('camera-on');
    $('camera-button').textContent = '카메라 끄기';
    $('camera-button').setAttribute('aria-pressed', 'true');
    stream.getTracks().forEach((t) => t.addEventListener('ended', stopCamera));
  } catch {
    stopCamera();
    status('카메라를 켜지 못했어요. 브라우저 권한을 확인하거나 화면으로 둘러보세요.');
  } finally {
    $('camera-button').disabled = false;
  }
}
function enter() {
  $('sky-welcome').hidden = true;
  loadSky();
}
$('enter-sky').onclick = enter;
$('enter-ar').onclick = () => {
  enter();
  enableMotion();
  enableCamera();
};
$('motion-button').onclick = enableMotion;
$('camera-button').onclick = enableCamera;
document.querySelectorAll('.close-sheet').forEach((button) => {
  button.onclick = () => button.closest('dialog').close();
});
$('inspect-button').onclick = () => {
  if (focused) openStory(focused);
};
$('story-dialog').addEventListener('close', () => {
  requestGeneration++;
  selected = null;
});

async function openStory(work) {
  selected = { ...work };
  const generation = ++requestGeneration;
  commentRequest = null;
  $('story-title').textContent = work.title;
  $('story-author').textContent = work.nickname;
  $('story-message').textContent = work.message;
  const illustration = skyIllustration(work);
  const credit = $('story-art-credit');
  credit.replaceChildren();
  credit.hidden = !illustration;
  if (illustration) {
    const label = document.createElement(illustration.art.credit === 'meuris' ? 'a' : 'span');
    label.textContent = artCredit(illustration.shape);
    if (label.tagName === 'A') {
      label.href = ART_LICENSE_URL;
      label.target = '_blank';
      label.rel = 'noopener noreferrer';
    }
    credit.append(label);
  }
  $('story-status').textContent = '이야기를 불러오고 있어요.';
  $('comments').replaceChildren();
  $('like-button').disabled = true;
  $('like-button').setAttribute('aria-pressed', 'false');
  $('like-count').textContent = '…';
  $('comment-body').value = '';
  $('more-comments').hidden = true;
  $('story-dialog').showModal();
  try {
    const detail = await api(`/constellations/${work.id}`);
    if (generation !== requestGeneration) return;
    Object.assign(selected, detail);
    updateLike(detail);
    $('like-button').disabled = false;
    await loadComments(false, generation);
  } catch (error) {
    if (generation === requestGeneration) $('story-status').textContent = error.message;
  }
}
function updateLike(data) {
  $('like-count').textContent = data.likes;
  $('like-button').setAttribute('aria-pressed', String(data.liked));
}
async function loadComments(append = false, generation = requestGeneration) {
  if (!selected) return;
  const id = selected.id;
  const data = await api(
    `/constellations/${id}/comments${append && nextComments ? `?before=${encodeURIComponent(nextComments)}` : ''}`,
  );
  if (generation !== requestGeneration) return;
  if (!append) $('comments').replaceChildren();
  for (const comment of data.items) {
    const li = document.createElement('li'),
      meta = document.createElement('small'),
      p = document.createElement('p');
    meta.textContent = `익명의 별 ${comment.author} · ${new Date(comment.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
    p.textContent = comment.body;
    li.append(meta, p);
    $('comments').append(li);
  }
  nextComments = data.next;
  $('more-comments').hidden = !data.next;
  $('story-status').textContent = $('comments').children.length ? '' : '첫 번째 말을 남겨보세요.';
}
async function refreshComments(append) {
  const generation = requestGeneration,
    button = $(append ? 'more-comments' : 'refresh-comments');
  button.disabled = true;
  try {
    await loadComments(append, generation);
  } catch (error) {
    if (generation === requestGeneration) $('story-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
$('refresh-comments').onclick = () => refreshComments(false);
$('more-comments').onclick = () => refreshComments(true);
$('like-button').onclick = async () => {
  if (!selected) return;
  const work = selected,
    generation = requestGeneration;
  $('like-button').disabled = true;
  try {
    const result = await api(`/constellations/${work.id}/like`, {
      method: 'PUT',
      body: { liked: !work.liked },
    });
    if (generation === requestGeneration) {
      Object.assign(work, result);
      updateLike(result);
    }
  } catch (error) {
    if (generation === requestGeneration) $('story-status').textContent = error.message;
  } finally {
    if (generation === requestGeneration) $('like-button').disabled = false;
  }
};
$('comment-form').onsubmit = async (event) => {
  event.preventDefault();
  if (!selected) return;
  const body = $('comment-body').value.trim();
  if (!body) return;
  if (!commentRequest || commentRequest.body !== body)
    commentRequest = { requestId: crypto.randomUUID(), body };
  const work = selected,
    generation = requestGeneration,
    button = event.submitter;
  button.disabled = true;
  try {
    await api(`/constellations/${work.id}/comments`, { method: 'POST', body: commentRequest });
    if (generation !== requestGeneration) return;
    $('comment-body').value = '';
    commentRequest = null;
    await loadComments(false, generation);
  } catch (error) {
    if (generation === requestGeneration) $('story-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$('capture-button').onclick = async () => {
  if (!view) return;
  try {
    const blob = await view.capture($('ar-camera'));
    if (!blob) throw new Error();
    const file = new File([blob], 'our-constellation.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '우리가 남긴 하늘' });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    if (error.name !== 'AbortError') status('사진을 저장하지 못했어요. 다시 시도해 주세요.');
  }
};
try {
  view = new SkyView($('sky-stage'), setFocus, (guide) => {
    $('sky-guide').textContent = guide;
    $('sky-guide').hidden = !guide;
  });
} catch {
  status('이 브라우저에서는 AR 하늘을 열지 못했어요. Safari 또는 Chrome에서 다시 열어 주세요.');
  $('capture-button').disabled = true;
}
loadSky();
pollTimer = setInterval(loadSky, 10000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadSky();
  else stopCamera();
});
window.addEventListener('pagehide', () => {
  clearInterval(pollTimer);
  stopCamera();
  view?.dispose();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});

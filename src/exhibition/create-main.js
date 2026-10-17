import { api } from './api.js';
import { paintDrawing } from './preview.js';
const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
let claimToken = new URLSearchParams(location.hash.slice(1)).get('claim');
// Keep claim capabilities out of referrers and copied public URLs. Session
// storage retains the creator flow across a refresh on this phone only.
try {
  if (claimToken) sessionStorage.setItem(`claim:${id}`, claimToken);
  else claimToken = sessionStorage.getItem(`claim:${id}`);
} catch {}
history.replaceState(null, '', location.pathname + location.search);
async function load() {
  try {
    if (!id || !claimToken) throw new Error('큰 화면에 표시된 작성자 QR을 스캔해 주세요.');
    const work = await api(`/constellations/${id}/preview`, {
      method: 'POST',
      body: { claimToken },
    });
    paintDrawing($('creation-preview'), work.drawing);
    $('creation-title').textContent = work.title;
    $('creator-status').textContent = work.occupied
      ? `${work.owner.nickname} 님이 이미 이 별자리를 차지했어요!`
      : work.claimed
        ? '이미 하늘에 이야기가 남겨진 별자리예요.'
        : '';
    $('creator-form').hidden = work.claimed || !!work.occupied;
    $('view-sky').href = 'sky.html';
    $('view-sky').hidden = !(work.claimed || work.occupied);
  } catch (error) {
    $('creator-status').textContent = error.message;
    if (error.code === 'CONSTELLATION_OCCUPIED') {
      $('creator-form').hidden = true;
      $('view-sky').href = 'sky.html';
      $('view-sky').hidden = false;
    }
  }
}
$('creator-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('creator-status').textContent = '별자리를 하늘에 띄우고 있어요…';
  try {
    await api(`/constellations/${id}/claim`, {
      method: 'POST',
      body: { claimToken, nickname: $('nickname').value, message: $('creator-message').value },
    });
    $('creator-form').hidden = true;
    $('view-sky').hidden = false;
    $('creator-status').textContent = '이야기를 남겼어요. 당신의 별이 떠 있는 하늘로 이동합니다.';
    // Include this work in the 30-piece sample, without aiming the camera at it.
    try { sessionStorage.setItem('constellation-latest-owned', id); } catch {}
    location.replace('sky.html');
  } catch (error) {
    $('creator-status').textContent = error.message;
    if (error.code === 'CONSTELLATION_OCCUPIED') {
      $('creator-form').hidden = true;
      $('view-sky').href = 'sky.html';
      $('view-sky').hidden = false;
    }
  } finally {
    button.disabled = false;
  }
};
load();

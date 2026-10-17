import QRCode from 'qrcode';
import { api, exhibitionEnabled, kioskKey, publicUrl, writeLocal } from './api.js';
import { drawingPayload } from './sky-layout.js';
import { sameWork } from './work-identity.js';

export class ExhibitionKiosk {
  constructor(toast, onConnected = () => {}) {
    this.toast = toast;
    this.dirty = false;
    this.editVersion = 0;
    // A reload opens the intro canvas, so never attach an old ticket to it.
    this.ticket = null;
    this.card = document.getElementById('creation-ticket');
    document.getElementById('ticket-close').onclick = () => {
      this.card.hidden = true;
    };
    document.getElementById('exhibition-settings').onclick = () => {
      document.getElementById('operator-key').value = kioskKey();
      document.getElementById('connection-status').textContent = '';
      document.getElementById('exhibition-dialog').showModal();
    };
    document.getElementById('connect-exhibition').onclick = async () => {
      const key = document.getElementById('operator-key').value.trim();
      const status = document.getElementById('connection-status');
      const button = document.getElementById('connect-exhibition');
      if (!key) {
        status.textContent = '운영자 키를 입력해 주세요.';
        return;
      }
      button.disabled = true;
      status.textContent = '운영자 키와 저장소를 확인하고 있어요…';
      try {
        await api('/kiosk/status', { kiosk: true, operatorKey: key });
        writeLocal('constellation-kiosk-key', key);
        document.getElementById('exhibition-dialog').close();
        this.toast('운영자 연결 완료. 별자리를 완성하면 저장되고 작성자 QR이 나타납니다.');
        await onConnected();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    document.getElementById('entrance-link').href = publicUrl('entrance.html');
    this.claimPoll = setInterval(() => this.checkTicket(), 3000);
    window.addEventListener('pagehide', () => clearInterval(this.claimPoll));
  }
  showOccupied(title, owner) {
    this.card.dataset.state = 'occupied';
    this.card.setAttribute('aria-label', '이미 주인이 있는 별자리');
    document.getElementById('ticket-title').textContent = title;
    document.getElementById('ticket-link').hidden = true;
    document.getElementById('ticket-link').removeAttribute('href');
    document.getElementById('ticket-image').removeAttribute('src');
    document.getElementById('ticket-occupied').hidden = false;
    document.getElementById('ticket-message').textContent =
      `${owner?.nickname || '누군가'} 님이 이미 이 별자리를 차지했어요!`;
    document.getElementById('ticket-footnote').textContent =
      '다른 별자리를 만들어 새로운 이야기를 남겨보세요.';
    this.card.hidden = false;
    this.dirty = false;
  }
  async checkTicket() {
    if (
      this.checkingClaim ||
      document.hidden ||
      this.card.hidden ||
      this.card.dataset.state === 'occupied' ||
      !this.ticket?.id
    )
      return;
    this.checkingClaim = true;
    const ticket = this.ticket,
      version = this.editVersion;
    try {
      const result = await api(`/kiosk/availability?title=${encodeURIComponent(ticket.title)}`, {
        kiosk: true,
      });
      if (
        result.occupied &&
        this.ticket === ticket &&
        this.editVersion === version &&
        !this.card.hidden
      )
        this.showOccupied(ticket.title, result.owner);
    } catch {
    } finally {
      // Keep a transient connection failure from interrupting the drawing.
      this.checkingClaim = false;
    }
  }
  newWork() {
    this.editVersion++;
    this.ticket = null;
    this.pendingCompletion = null;
    this.dirty = false;
    writeLocal('constellation-current-ticket', 'null');
    this.card.hidden = true;
  }
  edited() {
    this.editVersion++;
    this.dirty = true;
    this.pendingCompletion = null;
    // The old card represents a saved snapshot, not the drawing being edited.
    // Keep the ticket for safe retries, but never invite a scan of stale work.
    if (!this.card.hidden) this.card.hidden = true;
  }
  async complete(model, edges, title, aspect, manual = false) {
    if (!exhibitionEnabled) {
      if (manual) this.toast('전시 API 주소 설정 후 배포하면 작성자 QR을 사용할 수 있어요.');
      return;
    }
    if (!kioskKey()) {
      if (manual) document.getElementById('exhibition-settings').click();
      return;
    }
    if (!manual && !this.dirty) return;
    if (this.busy) {
      // A new selection can finish while the previous draft is being saved.
      // Retain the newest snapshot so its QR does not silently disappear.
      this.pendingCompletion = [
        { stars: structuredClone(model.stars) },
        structuredClone(edges),
        title,
        aspect,
        manual,
      ];
      return;
    }
    this.busy = true;
    const version = this.editVersion;
    const drawing = drawingPayload(model.stars, edges, aspect);
    const name = title || '이름 없는 별자리';
    try {
      const availability = await api(`/kiosk/availability?title=${encodeURIComponent(name)}`, {
        kiosk: true,
      });
      if (version !== this.editVersion) return;
      if (availability.occupied) {
        this.showOccupied(name, availability.owner);
        return;
      }
      // A new completion can occur in the same canvas and the same hand session.
      // Save a separate immutable work; retries of the same completion retain
      // their request ID, including after an ambiguous network failure.
      if (!sameWork(this.ticket, name, drawing)) {
        this.card.hidden = true;
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        this.ticket = {
          requestId: crypto.randomUUID(),
          claimToken: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
          drawing,
          title: name,
        };
        writeLocal('constellation-current-ticket', JSON.stringify(this.ticket));
      }
      const ticket = this.ticket;
      if (!ticket.id) {
        const result = await api('/constellations', { method: 'POST', body: ticket, kiosk: true });
        if (result.occupied) {
          if (this.ticket === ticket && this.editVersion === version)
            this.showOccupied(name, result.owner);
          return;
        }
        ticket.id = result.id;
        if (this.ticket === ticket)
          writeLocal('constellation-current-ticket', JSON.stringify(ticket));
      }
      if (this.ticket !== ticket || this.editVersion !== version) return;
      const link = `${publicUrl(`create.html?id=${ticket.id}`)}#claim=${ticket.claimToken}`;
      const image = await QRCode.toDataURL(link, {
        width: 256,
        margin: 2,
        color: { dark: '#07121b', light: '#ffffff' },
      });
      if (this.ticket !== ticket || this.editVersion !== version) return;
      document.getElementById('ticket-image').src = image;
      document.getElementById('ticket-link').href = link;
      document.getElementById('ticket-title').textContent = ticket.title;
      this.card.dataset.state = 'qr';
      this.card.setAttribute('aria-label', '완성한 별자리 작성자 QR');
      document.getElementById('ticket-link').hidden = false;
      document.getElementById('ticket-occupied').hidden = true;
      document.getElementById('ticket-message').textContent =
        '만든 분이 스캔해 주세요. 닉네임과 이야기를 남기면 모두의 하늘에 떠올라요.';
      document.getElementById('ticket-footnote').textContent = '새 별자리가 완성되면 QR도 바뀌어요';
      this.card.hidden = false;
      this.dirty = false;
    } catch (error) {
      if (this.editVersion === version) {
        this.toast(`${error.message} ‘QR 공유’를 누르면 같은 작품으로 다시 시도합니다.`);
        // Prevent an offline API from being retried every render/recognition.
        this.dirty = false;
      }
    } finally {
      this.busy = false;
      const pending = this.pendingCompletion;
      this.pendingCompletion = null;
      if (pending) await this.complete(...pending);
    }
  }
}

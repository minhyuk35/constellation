import QRCode from 'qrcode';
import { publicUrl } from './api.js';
const url = publicUrl('sky.html');
const link = document.getElementById('entrance-url');
link.href = url;
link.textContent = url;
document.getElementById('print-qr').onclick = () => window.print();
QRCode.toDataURL(url, {
  width: 1024,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#07121b', light: '#ffffff' },
})
  .then((data) => {
    document.getElementById('entrance-qr').src = data;
    document.getElementById('download-qr').href = data;
  })
  .catch(() => {
    document.getElementById('entrance-status').textContent =
      'QR을 만들지 못했어요. 새로고침해 주세요.';
  });
if (['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
  document.getElementById('entrance-status').textContent =
    '로컬 미리보기입니다. 휴대폰용 QR은 HTTPS 배포 주소에서 인쇄해 주세요.';

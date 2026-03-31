// ─── QR Code Generation ───────────────────────
import QRCode from 'qrcode';

function generateQRToElement(elementId, text, size) {
  size = size || 160;
  var el = document.getElementById(elementId);
  if (!el) return;

  QRCode.toCanvas(document.createElement('canvas'), text, {
    width: size,
    margin: 1,
    color: { dark: '#111827', light: '#ffffff' }
  }, function(err, canvas) {
    if (err) {
      el.innerHTML = '<div style="color:var(--text3);font-family:var(--mono);font-size:11px">QR generation failed</div>';
      return;
    }
    canvas.style.borderRadius = '8px';
    el.innerHTML = '';
    el.appendChild(canvas);
  });
}
window.generateQRToElement = generateQRToElement;

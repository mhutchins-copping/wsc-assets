// ─── QR Code Generation ───────────────────────
import QRCode from 'qrcode';

// Public site origin for scannable QR codes. Hard-coded rather than
// window.location.origin because the sticker stays with the asset long
// after this browser session — it has to resolve to the prod app.
var QR_BASE = 'https://assets.it-wsc.com';

// The scan target for a given asset tag. Kept as a short hash route so
// the QR stays low-density and scans cleanly from small printed labels.
// Router handles `#/a/<tag>` and resolves tag → asset id via the API.
function qrUrlForTag(tag) {
  return QR_BASE + '/#/a/' + encodeURIComponent(tag);
}
window.qrUrlForTag = qrUrlForTag;

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

// Promise-returning variant used by the label-sheet renderer. Produces a
// data URL so the QR can be inlined into a popup window's HTML without a
// second round of canvas work in that window.
function generateQRDataURL(text, size) {
  size = size || 280;
  return new Promise(function(resolve, reject) {
    QRCode.toDataURL(text, {
      width: size,
      margin: 1,
      color: { dark: '#111827', light: '#ffffff' }
    }, function(err, dataUrl) {
      if (err) reject(err); else resolve(dataUrl);
    });
  });
}
window.generateQRDataURL = generateQRDataURL;

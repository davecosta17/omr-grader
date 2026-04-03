function $(id) {
  return document.getElementById(id);
}

// display defaults to 'block'. Pass 'flex' for flex containers.
function show(el, display = 'block') {
  el.style.display = display;
}

function hide(el) {
  el.style.display = 'none';
}

function on(id, eventName, handler) {
  $(id).addEventListener(eventName, handler);
}

let toastTimer;

function showToast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 2400);
}

function generateUUID() {
  // crypto.randomUUID() only works in secure contexts (HTTPS / localhost).
  // This fallback works on plain HTTP local network addresses too.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared by calibration.js and corner-adjust.js.
// Returns { x, y, w, h } — the rectangle the image occupies inside
// a container when scaled to fit (object-fit: contain logic).
function getImageDisplayRect(natW, natH, containerW, containerH) {
  const imgAspect = natW / natH;
  const conAspect = containerW / containerH;
  let w, h, x, y;
  if (imgAspect > conAspect) {
    w = containerW; h = w / imgAspect;
    x = 0;          y = (containerH - h) / 2;
  } else {
    h = containerH; w = h * imgAspect;
    x = (containerW - w) / 2; y = 0;
  }
  return { x, y, w, h };
}
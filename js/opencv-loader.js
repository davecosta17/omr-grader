// opencv-loader.js — loads OpenCV.js and signals when ready
//
// @techstark/opencv-js exposes window.cv as an Emscripten thenable —
// NOT a real Promise. The correct call is the two-argument form:
//   window.cv.then(onSuccess, onError)
// Chaining (.then().catch()) fails because .then() returns undefined.
// We also wrap in Promise.resolve() as a belt-and-suspenders measure
// so we get a real chainable Promise regardless of build variant.

let cv            = null;
let cvLoading     = false;
let cvLoaded      = false;
let cvLoadPromise = null;

const OPENCV_URL =
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.min.js';

function loadOpenCV() {
  if (cvLoaded && cv) return Promise.resolve(cv);
  if (cvLoadPromise) return cvLoadPromise;

  cvLoadPromise = new Promise((resolve, reject) => {
    cvLoading = true;
    showOpenCVLoadingScreen();

    // Do NOT set window.Module — techstark ignores it and uses cv.then() instead.

    const script = document.createElement('script');
    script.src         = OPENCV_URL;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      // window.cv is now an Emscripten thenable. Wrap it in a real Promise
      // so we can chain properly. Promise.resolve(thenable) follows the
      // thenable spec-correctly, calling thenable.then(resolve, reject)
      // and returning a genuine Promise.
      Promise.resolve(window.cv).then(
        instance => {
          cv        = instance;
          cvLoaded  = true;
          cvLoading = false;
          hideOpenCVLoadingScreen();
          resolve(cv);
        },
        err => {
          onOpenCVFail('Init failed: ' + (err && err.message ? err.message : err));
          reject(err);
        }
      );
    };

    script.onerror = () => {
      onOpenCVFail('Failed to load from CDN — check your connection');
      reject(new Error('Script load error'));
    };

    document.head.appendChild(script);
  });

  return cvLoadPromise;
}

function getCv() { return cvLoaded ? cv : null; }

// ── Loading screen UI ─────────────────────────────────────────────

function showOpenCVLoadingScreen() {
  $('screen-opencv-loading').classList.add('active');
  updateOpenCVProgress(-1);
  setOpenCVLoadingLabel('Loading vision engine… (one-time download, ~8 MB)');
  ['screen-home','screen-create','screen-camera',
   'screen-calibration','screen-corner-adjust'].forEach(id => {
    const el = $(id);
    if (el) el.classList.remove('active');
  });
}

function hideOpenCVLoadingScreen() {
  $('screen-opencv-loading').classList.remove('active');
  clearInterval(indeterminateTimer);
  indeterminateTimer = null;
}

let indeterminateTimer = null;
function updateOpenCVProgress(fraction) {
  const bar   = $('opencv-progress-fill');
  const label = $('opencv-progress-pct');
  if (!bar || !label) return;

  if (fraction < 0) {
    if (!indeterminateTimer) {
      let pos = 0;
      indeterminateTimer = setInterval(() => {
        pos = (pos + 2) % 70;
        bar.style.width      = '30%';
        bar.style.marginLeft = pos + '%';
      }, 30);
    }
    label.textContent = 'Loading…';
  } else {
    clearInterval(indeterminateTimer);
    indeterminateTimer = null;
    bar.style.marginLeft = '0';
    bar.style.width      = Math.round(fraction * 100) + '%';
    label.textContent    = fraction >= 1 ? 'Ready' : Math.round(fraction * 100) + '%';
  }
}

function setOpenCVLoadingLabel(text) {
  const el = $('opencv-loading-label');
  if (el) el.textContent = text;
}

function onOpenCVFail(reason) {
  cvLoading     = false;
  cvLoadPromise = null;
  clearInterval(indeterminateTimer);
  indeterminateTimer = null;
  const bar = $('opencv-progress-fill');
  if (bar) { bar.style.marginLeft = '0'; bar.style.width = '100%'; bar.style.background = '#ef4444'; }
  setOpenCVLoadingLabel('Failed: ' + reason);
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
}

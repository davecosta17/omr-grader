// opencv-loader.js — loads OpenCV.js and signals when ready
//
// IMPORTANT URL NOTE:
// @techstark/opencv-js dist/opencv.min.js is an ES module — it does NOT
// set window.cv as a global. Use the non-minified opencv.js (UMD build)
// which correctly exposes window.cv as a global thenable.
//
// IMPORTANT SCREEN NOTE:
// loadOpenCV() is called from deep inside warp.js → detectSheetCorners()
// which is called while screen-corner-adjust is active. The loading screen
// must NOT hide screen-corner-adjust, and must restore it on completion.
// We do this by recording which screen was active before showing the loader,
// and restoring it afterwards.

let cv            = null;
let cvLoading     = false;
let cvLoaded      = false;
let cvLoadPromise = null;

// UMD build — sets window.cv as a global. The .min.js is ES module only.
const OPENCV_URL =
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js';

// The screen that was active when loadOpenCV() was called — restored after.
let screenToRestore = null;

function loadOpenCV() {
  if (cvLoaded && cv) return Promise.resolve(cv);
  if (cvLoadPromise) return cvLoadPromise;

  cvLoadPromise = new Promise((resolve, reject) => {
    cvLoading = true;
    showOpenCVLoadingScreen();

    const script = document.createElement('script');
    script.src         = OPENCV_URL;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      // The UMD build sets window.cv to a thenable.
      // Promise.resolve(thenable) wraps it into a real Promise.
      // Use two-argument .then(onFulfilled, onRejected) — do not chain .catch()
      // because the intermediate Promise from a thenable may not support it.
      Promise.resolve(window.cv).then(
        instance => {
          cv        = instance;
          cvLoaded  = true;
          cvLoading = false;
          hideOpenCVLoadingScreen();   // restores previous screen
          resolve(cv);
        },
        err => {
          onOpenCVFail('Init failed: ' + (err && err.message ? err.message : String(err)));
          reject(err instanceof Error ? err : new Error(String(err)));
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
  // Record whichever overlay screen is currently active so we can restore it.
  // We check the overlay screens only — home/create are normal screens
  // and are handled by their own show/hide logic.
  const overlays = [
    'screen-corner-adjust',
    'screen-calibration',
    'screen-camera',
    'screen-result',
  ];
  screenToRestore = null;
  for (const id of overlays) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('active')) {
      screenToRestore = id;
      break;
    }
  }

  // Show loading screen on top — its z-index (500) is above everything.
  // We do NOT remove active from other screens; the loading screen
  // just sits over them. When it hides, the screens beneath are still there.
  $('screen-opencv-loading').classList.add('active');
  updateOpenCVProgress(-1);
  setOpenCVLoadingLabel('Loading vision engine… (one-time download)');
}

function hideOpenCVLoadingScreen() {
  $('screen-opencv-loading').classList.remove('active');
  clearInterval(indeterminateTimer);
  indeterminateTimer = null;
  // No need to restore anything — we never hid other screens.
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
  if (bar) {
    bar.style.marginLeft = '0';
    bar.style.width      = '100%';
    bar.style.background = '#ef4444';
  }
  setOpenCVLoadingLabel('Failed: ' + reason);
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
}

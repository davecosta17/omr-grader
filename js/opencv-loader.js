// opencv-loader.js — loads OpenCV.js and signals when ready
//
// Uses a direct <script> tag (no XHR, no blob, no new Function).
// After script.onload, polls window.cv.Mat every 100ms.
// window.cv.Mat only exists once OpenCV has fully initialised.
// This avoids all Promise/thenable/Module complexity.

let cv            = null;
let cvLoading     = false;
let cvLoaded      = false;
let cvLoadPromise = null;

// UMD build — sets window.cv as a global after load.
const OPENCV_URL =
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js';

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
      // Poll for window.cv.Mat — only present once fully initialised.
      // Timeout after 30s so we never hang forever.
      let ticks = 0;
      const MAX  = 300; // 300 × 100ms = 30s

      const poll = setInterval(() => {
        ticks++;

        if (window.cv && window.cv.Mat) {
          clearInterval(poll);
          cv        = window.cv;
          cvLoaded  = true;
          cvLoading = false;
          // Hide the loading screen first, then wait for TWO animation frames
          // before resolving. This guarantees the browser paints the removal
          // of the loading screen before the calling code runs any synchronous
          // OpenCV operations — without this the main thread blocks before the
          // repaint and the loading screen appears frozen even though it was
          // dismissed in code.
          hideOpenCVLoadingScreen();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(cv);
            });
          });
          return;
        }

        if (ticks >= MAX) {
          clearInterval(poll);
          onOpenCVFail('Initialisation timed out — retry or check connection');
          reject(new Error('OpenCV init timeout'));
        }
      }, 100);
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
  setOpenCVLoadingLabel('Loading vision engine… (one-time download)');
  // Loading screen has z-index 500 — sits on top without hiding anything.
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
  cvLoadPromise = null; // allow retry
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

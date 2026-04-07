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
let cvScriptEl    = null;

// UMD build — sets window.cv as a global after load.
const OPENCV_URL =
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js';

function loadOpenCV() {
  if (cvLoaded && cv) return Promise.resolve(cv);
  if (cvLoadPromise) return cvLoadPromise;

  cvLoadPromise = new Promise((resolve, reject) => {
    cvLoading = true;
    showOpenCVLoadingScreen();
    setOpenCVLoadingLabel('Downloading vision engine…');

    const script = cvScriptEl || document.createElement('script');
    script.src         = OPENCV_URL;
    script.crossOrigin = 'anonymous';
    script.async       = true;
    cvScriptEl         = script;

    const fail = (reason, err) => {
      cvLoading     = false;
      cvLoadPromise = null; // allow retry
      if (script.parentNode) script.parentNode.removeChild(script);
      cvScriptEl = null;
      onOpenCVFail(reason);
      reject(err || new Error(reason));
    };

    // If CDN request stalls (neither onload nor onerror), fail explicitly.
    const scriptLoadTimeout = setTimeout(() => {
      fail('Download timed out — retry or check connection',
        new Error('OpenCV script download timeout'));
    }, 20000);

    script.onload = () => {
      clearTimeout(scriptLoadTimeout);
      // Poll for window.cv.Mat — only present once fully initialised.
      // Timeout after 30s so we never hang forever.
      let ticks = 0;
      const MAX  = 300; // 300 × 100ms = 30s
      let hookedThenable = false;

      const finishSuccess = (cvObj) => {
        clearInterval(poll);
        cv        = cvObj;
        cvLoaded  = true;
        cvLoading = false;
        hideOpenCVLoadingScreen();
        resolve(cv);
      };

      const poll = setInterval(() => {
        ticks++;

        if (window.cv && window.cv.Mat) {
          finishSuccess(window.cv);
          return;
        }

        // techstark/opencv-js may expose a thenable first; promote it to
        // the actual cv object once resolved so polling can complete.
        if (!hookedThenable && window.cv && typeof window.cv.then === 'function') {
          hookedThenable = true;
          window.cv.then((resolvedCv) => {
            if (!resolvedCv) return;
            window.cv = resolvedCv;
            if (resolvedCv.Mat) finishSuccess(resolvedCv);
          }).catch(() => {
            // Keep polling/timing out through the normal path.
          });
        }

        if (ticks >= MAX) {
          clearInterval(poll);
          fail('Initialisation timed out — retry or check connection',
            new Error('OpenCV init timeout'));
        }
      }, 100);
    };

    script.onerror = () => {
      clearTimeout(scriptLoadTimeout);
      fail('Failed to load from CDN — check your connection',
        new Error('Script load error'));
    };

    if (!script.parentNode) document.head.appendChild(script);
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
  // OpenCV is an enhancement. If load fails, don't block the app UI.
  hideOpenCVLoadingScreen();
  showToast('OpenCV unavailable — continuing without auto-detection');
}

// opencv-loader.js — loads OpenCV.js and signals when ready
//
// Uses a direct <script> tag (no XHR, no blob, no new Function).
// Loader is intentionally non-blocking: OpenCV is an enhancement only.

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

function waitForCvReady() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const MAX_MS  = 30000;
    let thenableHooked = false;

    const done = (cvObj) => {
      if (cvObj && cvObj.Mat) resolve(cvObj);
    };

    const poll = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        clearInterval(poll);
        done(window.cv);
        return;
      }

      if (!thenableHooked && window.cv && typeof window.cv.then === 'function') {
        thenableHooked = true;
        window.cv.then((resolvedCv) => {
          if (!resolvedCv) return;
          window.cv = resolvedCv;
          if (resolvedCv.Mat) {
            clearInterval(poll);
            done(resolvedCv);
          }
        }).catch(() => {});
      }

      if (Date.now() - started >= MAX_MS) {
        clearInterval(poll);
        reject(new Error('OpenCV init timeout'));
      }
    }, 100);
  });
}

function onOpenCVFail(reason) {
  cvLoading     = false;
  cvLoadPromise = null; // allow retry
  if (!cvFailNotified) {
    cvFailNotified = true;
    showToast('OpenCV unavailable — continuing without auto-detection');
    console.warn('OpenCV load failed:', reason);
  }
  setOpenCVLoadingLabel('Failed: ' + reason);
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
  // OpenCV is an enhancement. If load fails, don't block the app UI.
  hideOpenCVLoadingScreen();
  showToast('OpenCV unavailable — continuing without auto-detection');
}

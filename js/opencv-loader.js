// opencv-loader.js — loads OpenCV.js and signals when ready
//
// Strategy: plain <script> tag, no XHR, no blob, no new Function().
// Every XHR+blob approach breaks because the library was designed to run
// as a normal script — WASM path resolution, Module hooks, and init all
// depend on the browser's standard script loading environment.
// We lose per-byte progress but gain reliable initialisation.
// The loading screen shows an indeterminate animation while waiting.

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
    updateOpenCVProgress(-1); // indeterminate animation

    // Set Module callback BEFORE appending the script tag so Emscripten
    // captures our onRuntimeInitialized at module parse time.
    window.Module = {
      onRuntimeInitialized() {
        cv        = window.cv;
        cvLoaded  = true;
        cvLoading = false;
        clearTimeout(loadTimeout);
        clearInterval(initPoll);
        hideOpenCVLoadingScreen();
        resolve(cv);
      },
    };

    // Overall load timeout (60 s) — fires if the CDN is unreachable
    const loadTimeout = setTimeout(() => {
      onOpenCVFail('Timed out — check your connection and retry');
      reject(new Error('OpenCV load timeout'));
    }, 60000);

    let initPoll; // declared here so onload can clear it too

    const script = document.createElement('script');
    script.src         = OPENCV_URL;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      // Script has executed. onRuntimeInitialized may have already fired
      // (synchronous builds) or will fire shortly (async WASM builds).
      // Poll as a fallback — some builds init synchronously and don't
      // call onRuntimeInitialized at all; checking cv.Mat is the safest
      // universal signal that OpenCV is fully ready.
      if (cvLoaded) return; // already resolved via onRuntimeInitialized

      let polls = 0;
      initPoll = setInterval(() => {
        polls++;
        if (window.cv && window.cv.Mat) {
          clearInterval(initPoll);
          clearTimeout(loadTimeout);
          if (!cvLoaded) {
            cv        = window.cv;
            cvLoaded  = true;
            cvLoading = false;
            hideOpenCVLoadingScreen();
            resolve(cv);
          }
        } else if (polls > 200) { // 20 s polling window
          clearInterval(initPoll);
          clearTimeout(loadTimeout);
          onOpenCVFail('Initialisation timed out — retry or reload');
          reject(new Error('OpenCV init timeout'));
        }
      }, 100);
    };

    script.onerror = () => {
      clearTimeout(loadTimeout);
      onOpenCVFail('Failed to load script from CDN');
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
    // Indeterminate sweep animation
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
  setOpenCVLoadingLabel('Failed: ' + reason);
  const bar = $('opencv-progress-fill');
  if (bar) { bar.style.width = '100%'; bar.style.background = '#ef4444'; }
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
}
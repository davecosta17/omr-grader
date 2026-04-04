// opencv-loader.js — lazy loads OpenCV.js with progress UI
// OpenCV is ~8MB, downloaded once and cached by the browser.
// Call loadOpenCV() to start; it shows a loading screen automatically.
//
// Why new Function() instead of blob script injection:
// Script tag injection (script.src = blobUrl) is ASYNC — the script runs
// on a future event loop tick and immediately overwrites any window.cv we
// pre-seeded, silently discarding our callback. No error, just silence.
//
// new Function(text)() executes synchronously, so window.Module is already
// set when Emscripten reads it at the very top of the script. Our
// onRuntimeInitialized reference is captured before it can be overwritten.

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

    const xhr = new XMLHttpRequest();
    xhr.open('GET', OPENCV_URL, true);
    xhr.responseType = 'arraybuffer';

    xhr.onprogress = e => {
      if (e.lengthComputable) {
        updateOpenCVProgress(e.loaded / e.total);
      } else {
        updateOpenCVProgress(-1);
      }
    };

    xhr.onload = () => {
      if (xhr.status !== 200) {
        onOpenCVFail(`HTTP ${xhr.status}`);
        reject(new Error(`OpenCV load failed: HTTP ${xhr.status}`));
        return;
      }

      updateOpenCVProgress(1);
      setOpenCVLoadingLabel('Initialising…');

      try {
        // Decode arraybuffer → text
        const scriptText = new TextDecoder().decode(xhr.response);

        // Set window.Module BEFORE executing the script.
        // Emscripten reads window.Module at the very start of execution to
        // find callbacks. Because new Function() runs synchronously, our
        // Module object is already in place when the script captures it.
        window.Module = {
          onRuntimeInitialized() {
            // This fires once WASM compilation finishes.
            // window.cv is now the fully initialised OpenCV object.
            cv        = window.cv;
            cvLoaded  = true;
            cvLoading = false;
            hideOpenCVLoadingScreen();
            resolve(cv);
          },
        };

        // Execute synchronously in global scope.
        // new Function() creates a function in global scope — correct for
        // scripts that assign to window.cv and read window.Module.
        // eslint-disable-next-line no-new-func
        new Function(scriptText)();

      } catch (err) {
        onOpenCVFail('Execution failed: ' + (err.message || err));
        reject(err);
      }
    };

    xhr.onerror = () => {
      onOpenCVFail('Network error — check your connection');
      reject(new Error('OpenCV network error'));
    };

    xhr.send();
  });

  return cvLoadPromise;
}

function getCv() { return cvLoaded ? cv : null; }

// ── Loading screen UI ─────────────────────────────────────────────

function showOpenCVLoadingScreen() {
  $('screen-opencv-loading').classList.add('active');
  updateOpenCVProgress(0);
  setOpenCVLoadingLabel('Downloading vision engine… (one-time, ~8 MB)');
  ['screen-home','screen-create','screen-camera',
   'screen-calibration','screen-corner-adjust'].forEach(id => {
    const el = $(id);
    if (el) el.classList.remove('active');
  });
}

function hideOpenCVLoadingScreen() {
  $('screen-opencv-loading').classList.remove('active');
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
    label.textContent = 'Downloading…';
  } else {
    clearInterval(indeterminateTimer);
    indeterminateTimer = null;
    bar.style.marginLeft = '0';
    bar.style.width      = Math.round(fraction * 100) + '%';
    label.textContent    = fraction >= 1 ? '100%' : Math.round(fraction * 100) + '%';
  }
}

function setOpenCVLoadingLabel(text) {
  const el = $('opencv-loading-label');
  if (el) el.textContent = text;
}

function onOpenCVFail(reason) {
  cvLoading     = false;
  cvLoadPromise = null;
  setOpenCVLoadingLabel('Failed: ' + reason);
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
}
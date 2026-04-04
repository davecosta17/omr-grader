// opencv-loader.js — lazy loads OpenCV.js with progress UI
// OpenCV is ~8MB, downloaded once and cached by the browser.
// Call loadOpenCV() to start; it shows a loading screen automatically.
//
// Package: @techstark/opencv-js (browser UMD build)
//
// window.cv after script load is an Emscripten module object — it has a
// .then property but it is NOT a real Promise. Calling .then() on it returns
// undefined, so chaining .catch() crashes. The correct pattern is to set
// cv['onRuntimeInitialized'] directly on the cv object (not window.Module)
// before or immediately after the script executes.

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
        const blob    = new Blob([xhr.response], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const script  = document.createElement('script');

        // Set the callback BEFORE the script executes so we don't miss the
        // initialization event. The techstark UMD build reads cv['onRuntimeInitialized']
        // on the cv object itself — NOT window.Module.onRuntimeInitialized.
        // We pre-set it on window so the script picks it up as it constructs cv.
        window['cv'] = {
          onRuntimeInitialized() {
            // cv is now the fully initialised OpenCV object on window
            cv        = window.cv;
            cvLoaded  = true;
            cvLoading = false;
            URL.revokeObjectURL(blobUrl);
            hideOpenCVLoadingScreen();
            resolve(cv);
          },
        };

        script.onload = () => {
          // Safety net: if onRuntimeInitialized already fired during script
          // execution (synchronous init), cvLoaded is already true — no-op.
          // If cv is available and has Mat (fully built), resolve immediately.
          if (!cvLoaded && window.cv && window.cv.Mat) {
            cv        = window.cv;
            cvLoaded  = true;
            cvLoading = false;
            URL.revokeObjectURL(blobUrl);
            hideOpenCVLoadingScreen();
            resolve(cv);
          }
        };

        script.onerror = err => {
          URL.revokeObjectURL(blobUrl);
          onOpenCVFail('Script execution failed');
          reject(err);
        };

        script.src = blobUrl;
        document.head.appendChild(script);

      } catch (err) {
        onOpenCVFail(err.message);
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
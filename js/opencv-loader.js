// opencv-loader.js — lazy loads OpenCV.js with progress UI
// OpenCV is ~8MB, downloaded once and cached by the browser.
// Call loadOpenCV() to start; it shows a loading screen automatically.
//
// Package: @techstark/opencv-js — pure JS build (no .wasm file needed)
// URL must point to the FILE, not the package directory (no trailing slash).

let cv            = null;
let cvLoading     = false;
let cvLoaded      = false;
let cvLoadPromise = null;

// Must end with the filename — a trailing slash fetches the directory listing (HTML),
// which causes "Unexpected token '<'" when injected as a script.
const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js/opencv.js';

function loadOpenCV() {
  if (cvLoaded && cv) return Promise.resolve(cv);
  if (cvLoadPromise) return cvLoadPromise;

  cvLoadPromise = new Promise((resolve, reject) => {
    cvLoading = true;
    showOpenCVLoadingScreen();

    const xhr = new XMLHttpRequest();
    xhr.open('GET', OPENCV_URL, true);
    xhr.responseType = 'arraybuffer'; // keep as raw bytes — avoids UTF-8 decode issues

    xhr.onprogress = e => {
      if (e.lengthComputable) {
        updateOpenCVProgress(e.loaded / e.total);
      } else {
        updateOpenCVProgress(-1); // indeterminate
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

        // Set window.Module BEFORE the script tag is appended so OpenCV
        // reads it on startup. onRuntimeInitialized fires when the JS
        // module finishes setting itself up.
        // @techstark/opencv-js is pure JS — no .wasm fetch occurs —
        // but locateFile is kept as a safety net.
        window.Module = {
          locateFile(path) {
            if (path.endsWith('.wasm')) {
              return 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js/' + path;
            }
            return path;
          },
          onRuntimeInitialized() {
            cv        = window.cv;
            cvLoaded  = true;
            cvLoading = false;
            URL.revokeObjectURL(blobUrl);
            hideOpenCVLoadingScreen();
            resolve(cv);
          },
        };

        script.src    = blobUrl;
        script.onerror = err => {
          onOpenCVFail('Script execution failed');
          reject(err);
        };
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
        pos = (pos + 2) % 70; // sweep across 70% of bar
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
  cvLoadPromise = null; // allow retry
  setOpenCVLoadingLabel('Failed: ' + reason);
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
}
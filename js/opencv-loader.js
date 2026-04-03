// opencv-loader.js — lazy loads OpenCV.js with progress UI
// OpenCV is ~8MB, downloaded once and cached by the browser.
// Call loadOpenCV() to start; it shows a loading screen automatically.
//
// Package: @techstark/opencv-js
// This build exposes window.cv as a Promise<cvInstance> — NOT the raw
// Emscripten window.Module / onRuntimeInitialized API. We wait for
// script.onload, then await window.cv.then() to get the actual cv object.

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
    xhr.responseType = 'arraybuffer'; // raw bytes — avoids UTF-8 decode corruption

    xhr.onprogress = e => {
      if (e.lengthComputable) {
        updateOpenCVProgress(e.loaded / e.total);
      } else {
        updateOpenCVProgress(-1); // indeterminate animation
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

        // @techstark/opencv-js sets window.cv to a Promise<cvInstance>
        // when the script finishes executing. We wait for script.onload
        // (script has run) then resolve that Promise to get the cv object.
        script.onload = () => {
          URL.revokeObjectURL(blobUrl);

          if (!window.cv) {
            onOpenCVFail('cv not found after script load');
            reject(new Error('cv not found after script load'));
            return;
          }

          // window.cv is a Promise in the techstark build
          const cvPromise = (typeof window.cv.then === 'function')
            ? window.cv
            : Promise.resolve(window.cv);

          cvPromise.then(instance => {
            cv        = instance;
            cvLoaded  = true;
            cvLoading = false;
            hideOpenCVLoadingScreen();
            resolve(cv);
          }).catch(err => {
            onOpenCVFail('Initialisation failed: ' + (err.message || err));
            reject(err);
          });
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
  cvLoadPromise = null; // allow retry
  setOpenCVLoadingLabel('Failed: ' + reason);
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
}
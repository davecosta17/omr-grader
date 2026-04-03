// opencv-loader.js — lazy loads OpenCV.js with progress UI
// OpenCV is ~8MB, downloaded once and cached by the browser.
// Call loadOpenCV() to start; it shows a loading screen automatically.

let cv           = null;
let cvLoading    = false;
let cvLoaded     = false;
let cvLoadPromise = null;

const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@latest/opencv.js';

// Returns a Promise<cv> — resolves when OpenCV is ready.
// Shows and hides the loading screen automatically.
function loadOpenCV() {
  if (cvLoaded && cv) return Promise.resolve(cv);
  if (cvLoadPromise) return cvLoadPromise;

  cvLoadPromise = new Promise((resolve, reject) => {
    cvLoading = true;
    showOpenCVLoadingScreen();

    // Use XHR so we get download progress events
    const xhr = new XMLHttpRequest();
    xhr.open('GET', OPENCV_URL, true);
    xhr.responseType = 'arraybuffer';

    xhr.onprogress = e => {
      if (e.lengthComputable) {
        updateOpenCVProgress(e.loaded / e.total);
      } else {
        // Total unknown — animate indeterminate bar
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

      // Inject the script via blob URL — this executes the OpenCV WASM module
      try {
        const blob   = new Blob([xhr.response], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const script  = document.createElement('script');

        // OpenCV.js calls this when WASM is ready.
        // locateFile tells OpenCV where to find opencv_js.wasm — without this,
        // it tries to resolve the WASM relative to the blob: URL, which is a 404.
        const OPENCV_BASE = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@latest/opencv.js';
        window.Module = {
          locateFile(path) {
            // Only redirect .wasm files; everything else resolves normally
            if (path.endsWith('.wasm')) return OPENCV_BASE + path;
            return path;
          },
          onRuntimeInitialized() {
            cv = window.cv;
            cvLoaded  = true;
            cvLoading = false;
            URL.revokeObjectURL(blobUrl);
            hideOpenCVLoadingScreen();
            resolve(cv);
          },
        };

        script.src = blobUrl;
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

// Returns cv synchronously if already loaded, null otherwise
function getCv() { return cvLoaded ? cv : null; }

// ── Loading screen UI ─────────────────────────────────────────────

function showOpenCVLoadingScreen() {
  $('screen-opencv-loading').classList.add('active');
  updateOpenCVProgress(0);
  setOpenCVLoadingLabel('Downloading vision engine… (one-time, ~8 MB)');
  // Hide other active screens so nothing bleeds through
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
    // Indeterminate — animate bar
    if (!indeterminateTimer) {
      let pos = 0;
      indeterminateTimer = setInterval(() => {
        pos = (pos + 2) % 100;
        bar.style.width = '30%';
        bar.style.marginLeft = pos + '%';
      }, 30);
    }
    label.textContent = 'Downloading…';
  } else {
    clearInterval(indeterminateTimer);
    indeterminateTimer = null;
    bar.style.marginLeft = '0';
    bar.style.width = Math.round(fraction * 100) + '%';
    label.textContent = fraction >= 1 ? '100%' : Math.round(fraction * 100) + '%';
  }
}

function setOpenCVLoadingLabel(text) {
  const el = $('opencv-loading-label');
  if (el) el.textContent = text;
}

function onOpenCVFail(reason) {
  cvLoading     = false;
  cvLoadPromise = null;  // allow retry
  setOpenCVLoadingLabel('Failed: ' + reason);
  const btn = $('btn-opencv-retry');
  if (btn) btn.style.display = 'inline-flex';
}
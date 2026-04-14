// camera.js — camera hardware, capture, preview, session management

let gradingExam    = null;
let sessionResults = [];
let capturedDataUrl = null;
let fullFrameDataUrl = null;  // full camera frame (before any crop) for corner-adjust
let cameraStream   = null;
let torchOn        = false;
let guideRect      = null;
let cameraMode     = 'grading';  // 'grading' | 'calibration'
let gradingAdjust  = false;      // whether grading mode uses corner-adjust

const NORMAL_SCREENS = ['screen-home', 'screen-create'];

// ── Screen helpers ────────────────────────────────────────────────

function hideNormalScreens() {
  NORMAL_SCREENS.forEach(id => $(id).classList.remove('active'));
}

function showCameraScreen() {
  hideNormalScreens();
  $('screen-camera').classList.add('active');
  requestAnimationFrame(() => positionGuide());
}

function hideCameraScreen() {
  $('screen-camera').classList.remove('active');
  $('screen-preview').classList.remove('active');
}

// ── Grading session ───────────────────────────────────────────────

async function startGradingSession() {
  const id = actionSheetExamId;
  closeActionSheet();
  try {
    const exam = await dbGet(id);
    if (!exam) return;
    if (!exam.templateId) {
      showToast('This exam has no template. Edit it and select one.', true); return;
    }
    const stored = await dbGetTemplate(exam.templateId);
    if (!stored) {
      showToast('Template not found. Please re-calibrate.', true); return;
    }
    gradingExam = { ...exam, resolvedTemplate: resolveTemplate(stored) };
    sessionResults  = [];
    capturedDataUrl = null;
    cameraMode      = 'grading';
    gradingAdjust   = false;

    $('cam-exam-name').textContent    = exam.name;
    $('cam-exam-sub').textContent     = `${exam.questionCount} questions`;
    $('cam-counter').style.visibility = 'visible';
    updateCamCounter();
    updateFinishBtn();
    showCameraScreen();
    await initCamera();
  } catch (err) {
    console.error('startGradingSession:', err);
    showToast('Could not start session: ' + (err.message || err), true);
  }
}

function updateCamCounter() {
  $('cam-counter').textContent = `${sessionResults.length} scanned`;
}

function updateFinishBtn() {
  const btn = $('btn-cam-finish');
  if (sessionResults.length > 0) btn.classList.add('visible');
  else                            btn.classList.remove('visible');
}

function finishSession() {
  stopCamera();
  showToast(`Session complete — ${sessionResults.length} sheet${sessionResults.length !== 1 ? 's' : ''} scanned`);
  // M5 hook: showSessionSummary(sessionResults, gradingExam)
}

// ── Calibration capture ───────────────────────────────────────────

function startCalibrationCapture() {
  cameraMode = 'calibration';
  $('cam-exam-name').textContent    = 'Calibrate Sheet';
  $('cam-exam-sub').textContent     = 'Capture the answer grid';
  $('cam-counter').style.visibility = 'hidden';
  $('btn-cam-finish').classList.remove('visible');
  showCameraScreen();
  initCamera();
}

// ── Camera init / teardown ────────────────────────────────────────

async function initCamera() {
  const video = $('cam-video');
  const errEl = $('cam-error');
  errEl.classList.remove('visible');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = cameraStream;
    video.onloadedmetadata = () => { video.play(); positionGuide(); };
  } catch (err) {
    errEl.classList.add('visible');
    console.warn('Camera error:', err);
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  torchOn    = false;
  cameraMode = 'grading';
  $('cam-flash-btn').classList.remove('on');
  $('cam-thumb').innerHTML = '📄';
  $('btn-cam-finish').classList.remove('visible');
  $('cam-counter').style.visibility = 'visible';
  hideCameraScreen();
  $('screen-home').classList.add('active');
}

// ── Guide overlay ─────────────────────────────────────────────────

function positionGuide() {
  const vp  = $('cam-viewport');
  const vpW = vp.clientWidth, vpH = vp.clientHeight;
  const guideW = Math.round(vpW * 0.92);
  const guideH = Math.round(guideW * 0.72);  // landscape-ish for answer grid
  const guideX = Math.round((vpW - guideW) / 2);
  const guideY = Math.round((vpH - guideH) / 2) - 10;

  guideRect = { x: guideX, y: guideY, w: guideW, h: guideH };

  $('ovl-top').style.cssText    = `top:0;left:0;right:0;height:${guideY}px`;
  $('ovl-bottom').style.cssText = `top:${guideY+guideH}px;left:0;right:0;bottom:0`;
  $('ovl-left').style.cssText   = `top:${guideY}px;left:0;width:${guideX}px;height:${guideH}px`;
  $('ovl-right').style.cssText  = `top:${guideY}px;left:${guideX+guideW}px;right:0;height:${guideH}px`;

  const corners = {
    'corner-tl': { top: guideY-2,           left: guideX-2 },
    'corner-tr': { top: guideY-2,           left: guideX+guideW-22 },
    'corner-bl': { top: guideY+guideH-22,   left: guideX-2 },
    'corner-br': { top: guideY+guideH-22,   left: guideX+guideW-22 },
  };
  Object.entries(corners).forEach(([id, pos]) => {
    $(id).style.top = pos.top+'px'; $(id).style.left = pos.left+'px';
  });
  $('cam-guide-label').style.top = (guideY + guideH + 10) + 'px';
}

window.addEventListener('resize', () => { if (guideRect) positionGuide(); });

// ── Flash ─────────────────────────────────────────────────────────

async function toggleFlash() {
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities?.() || {};
  const btn  = $('cam-flash-btn');
  if (caps.torch) {
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); btn.classList.toggle('on', torchOn); }
    catch(e) { console.warn('Torch:', e); }
  } else {
    torchOn = !torchOn;
    btn.classList.toggle('on', torchOn);
    showToast(torchOn ? 'Screen brightness increased' : 'Flash off');
  }
}

// ── Capture ───────────────────────────────────────────────────────

function capturePhoto() {
  const video  = $('cam-video');
  const canvas = $('cam-canvas');
  if (!video.srcObject || video.readyState < 2) { showToast('Camera not ready', true); return; }

  const flashEl = $('cam-flash');
  flashEl.classList.add('flash');
  setTimeout(() => flashEl.classList.remove('flash'), 120);

  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  canvas.width = vw; canvas.height = vh;
  canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);

  // Always store the full frame for corner-adjust
  fullFrameDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // Also compute guide crop for normal grading flow
  const vp = $('cam-viewport');
  const vpW = vp.clientWidth, vpH = vp.clientHeight;
  const videoAspect = vw/vh, vpAspect = vpW/vpH;
  let dispW, dispH, offsetX, offsetY;
  if (videoAspect > vpAspect) {
    dispH = vpH; dispW = vpH*videoAspect; offsetX = (dispW-vpW)/2; offsetY = 0;
  } else {
    dispW = vpW; dispH = vpW/videoAspect; offsetX = 0; offsetY = (dispH-vpH)/2;
  }
  const scaleX = vw/dispW, scaleY = vh/dispH;
  const cropX = Math.round((guideRect.x+offsetX)*scaleX);
  const cropY = Math.round((guideRect.y+offsetY)*scaleY);
  const cropW = Math.round(guideRect.w*scaleX);
  const cropH = Math.round(guideRect.h*scaleY);

  const cc = document.createElement('canvas');
  cc.width = cropW; cc.height = cropH;
  cc.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  capturedDataUrl = cc.toDataURL('image/jpeg', 0.92);

  $('cam-thumb').innerHTML = `<img src="${capturedDataUrl}" alt="last">`;
  showPreviewScreen(capturedDataUrl);
}

// ── Preview ───────────────────────────────────────────────────────

function showPreviewScreen(dataUrl) {
  $('preview-img').src = dataUrl;
  $('screen-preview').classList.add('active');
}

function hidePreviewScreen() {
  $('screen-preview').classList.remove('active');
  capturedDataUrl = null;
}

function retakePhoto() { hidePreviewScreen(); }

function usePhoto() {
  if (!capturedDataUrl) return;
  const cropUrl = capturedDataUrl;
  const fullUrl = fullFrameDataUrl;

  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  hidePreviewScreen();
  hideCameraScreen();

  if (cameraMode === 'calibration') {
    // Always use corner-adjust for calibration.
    // Try OpenCV auto-detection first; if it loads fast enough the handles
    // snap to the detected corners, otherwise start at the image edges.
    // Auto-detect grid corners with OpenCV; fall back to default handles if
    // OpenCV is not yet loaded (first-time users) or detection fails.
    showCornerAdjust(
      fullUrl,
      (warpedUrl) => showCalibrationScreen(warpedUrl, calibOnSave), // onConfirm
      () => { $('screen-home').classList.add('active'); },          // onCancel
      true  // autoDetect — OpenCV finds the 4 corners automatically
    );
  } else if (gradingAdjust) {
    // Grading with manual border adjustment
    showCornerAdjust(
      fullUrl,
      (warpedUrl) => showResultScreen(warpedUrl),  // onConfirm
      () => { showCameraScreen(); initCamera(); }, // onCancel
      false
    );
  } else {
    // Attempt automatic corner detection on the full frame.
    // If OpenCV is already loaded this is fast (~200ms).
    // If not loaded, fall back to the guide crop immediately.
    const cvLib = getCv();
    if (cvLib) {
      setProcessingOverlay(true, 'Detecting grid…');
      detectSheetCorners(fullUrl).then(corners => {
        setProcessingOverlay(false);
        if (corners) {
          // Good detection — warp to standard 1200×900
          warpPerspective(fullUrl, corners, 1200, 900).then(warpedUrl => {
            showResultScreen(warpedUrl);
          }).catch(() => showResultScreen(cropUrl));
        } else {
          // Detection failed — use guide crop
          showResultScreen(cropUrl);
        }
      }).catch(() => {
        setProcessingOverlay(false);
        showResultScreen(cropUrl);
      });
    } else {
      // OpenCV not loaded — use guide crop directly (still works fine)
      showResultScreen(cropUrl);
    }
  }
}

// ── Show corner-adjust for current grading sheet ──────────────────
// Called from the preview screen "Adjust" button
function adjustAndGrade() {
  if (!fullFrameDataUrl) return;
  const fullUrl = fullFrameDataUrl;
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  hidePreviewScreen();
  hideCameraScreen();
  showCornerAdjust(
    fullUrl,
    (warpedUrl) => showResultScreen(warpedUrl),
    () => { showCameraScreen(); initCamera(); },
    false
  );
}

// ── Processing overlay ────────────────────────────────────────────
// Brief overlay on the camera screen while auto-detection runs.

function setProcessingOverlay(visible, text) {
  let el = $('cam-processing-overlay');
  if (!el) return;
  if (visible) {
    el.textContent = text || 'Processing…';
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}
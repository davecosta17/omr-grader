// camera.js — camera hardware, capture, preview, and session management

let gradingExam     = null;
let sessionResults  = [];
let capturedDataUrl = null;
let cameraStream    = null;
let torchOn         = false;
let guideRect       = null;
let cameraMode      = 'grading'; // 'grading' | 'calibration'

// ── Screen helpers ────────────────────────────────────────────────
// Camera/calibration/result screens are full-screen overlays.
// They don't use showScreen() because they stack over the normal flow.
// We hide the normal screens explicitly so nothing bleeds through.

const NORMAL_SCREENS = ['screen-home', 'screen-create'];

function hideNormalScreens() {
  NORMAL_SCREENS.forEach(id => $( id).classList.remove('active'));
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
      showToast('This exam has no template. Please edit it and select one.', true);
      return;
    }
    const storedTemplate = await dbGetTemplate(exam.templateId);
    if (!storedTemplate) {
      showToast('Template not found. Please re-calibrate.', true);
      return;
    }

    gradingExam = {
      ...exam,
      computedTemplate: buildComputedTemplate(storedTemplate),
    };
    sessionResults  = [];
    capturedDataUrl = null;
    cameraMode      = 'grading';

    $('cam-exam-name').textContent     = exam.name;
    $('cam-exam-sub').textContent      = `${exam.questionCount} questions`;
    $('cam-counter').style.visibility  = 'visible';
    updateCamCounter();
    updateFinishBtn();

    showCameraScreen();
    await initCamera();
  } catch (err) {
    console.error('startGradingSession error:', err);
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
  $('cam-exam-sub').textContent     = 'Capture a blank answer sheet';
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

  // Restore the last normal screen
  const wasOnCreate = editingId !== null || (typeof currentExam === 'object' && currentExam && $('screen-create').style.display !== 'none');
  // Always return to home — if mid-exam-creation the exam form will have been shown separately
  $('screen-home').classList.add('active');
}

// ── Guide overlay ─────────────────────────────────────────────────

function positionGuide() {
  const vp  = $('cam-viewport');
  const vpW = vp.clientWidth, vpH = vp.clientHeight;
  const guideW = Math.round(vpW * 0.88);
  const guideH = Math.round(guideW * 1.35);
  const guideX = Math.round((vpW - guideW) / 2);
  const guideY = Math.round((vpH - guideH) / 2) - 20;

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
    $(id).style.top = pos.top + 'px'; $(id).style.left = pos.left + 'px';
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
    catch (e) { console.warn('Torch error:', e); }
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
  if (!video.srcObject || video.readyState < 2) { showToast('Camera not ready yet', true); return; }

  const flashEl = $('cam-flash');
  flashEl.classList.add('flash');
  setTimeout(() => flashEl.classList.remove('flash'), 120);

  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  canvas.width = vw; canvas.height = vh;
  canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);

  const vp = $('cam-viewport');
  const vpW = vp.clientWidth, vpH = vp.clientHeight;
  const videoAspect = vw/vh, vpAspect = vpW/vpH;
  let dispW, dispH, offsetX, offsetY;
  if (videoAspect > vpAspect) {
    dispH = vpH; dispW = vpH * videoAspect; offsetX = (dispW-vpW)/2; offsetY = 0;
  } else {
    dispW = vpW; dispH = vpW/videoAspect; offsetX = 0; offsetY = (dispH-vpH)/2;
  }

  const scaleX = vw/dispW, scaleY = vh/dispH;
  const cropX  = Math.round((guideRect.x+offsetX)*scaleX);
  const cropY  = Math.round((guideRect.y+offsetY)*scaleY);
  const cropW  = Math.round(guideRect.w*scaleX);
  const cropH  = Math.round(guideRect.h*scaleY);

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
  const dataUrl = capturedDataUrl;
  // Stop the live camera stream before showing calibration — saves battery
  // and avoids two screens fighting for the camera
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  hidePreviewScreen();
  hideCameraScreen();

  if (cameraMode === 'calibration') {
    showCalibrationScreen(dataUrl, calibOnSave); // calibration.js
  } else {
    showResultScreen(dataUrl); // results.js
  }
}
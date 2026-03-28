// camera.js — camera, capture, and preview
// Result screen logic lives in results.js

let gradingExam   = null;
let sessionResults = [];
let capturedDataUrl = null;
let cameraStream  = null;
let torchOn       = false;
let guideRect     = null;

// ── Session ───────────────────────────────────────────────────────

async function startGradingSession() {
  const id = actionSheetExamId;
  closeActionSheet();
  const exam = await dbGet(id);
  if (!exam) return;

  gradingExam    = exam;
  sessionResults = [];
  capturedDataUrl = null;

  $('cam-exam-name').textContent = exam.name;
  $('cam-exam-sub').textContent  = `${exam.questionCount} questions`;
  updateCamCounter();

  showCameraScreen();
  await initCamera();
}

function updateCamCounter() {
  $('cam-counter').textContent = `${sessionResults.length} scanned`;
}

// ── Camera init / teardown ────────────────────────────────────────

async function initCamera() {
  const video = $('cam-video');
  const errEl = $('cam-error');
  errEl.classList.remove('visible');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    video.srcObject = cameraStream;
    video.onloadedmetadata = () => {
      video.play();
      positionGuide();
    };
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
  torchOn = false;
  $('cam-flash-btn').classList.remove('on');
  $('cam-thumb').innerHTML = '📄';
  sessionResults  = [];
  gradingExam     = null;
  hideCameraScreen();
}

// ── Guide overlay ─────────────────────────────────────────────────

function positionGuide() {
  const vp   = $('cam-viewport');
  const vpW  = vp.clientWidth;
  const vpH  = vp.clientHeight;

  const guideW = Math.round(vpW * 0.88);
  const guideH = Math.round(guideW * 1.35);
  const guideX = Math.round((vpW - guideW) / 2);
  const guideY = Math.round((vpH - guideH) / 2) - 20;

  guideRect = { x: guideX, y: guideY, w: guideW, h: guideH };

  $('ovl-top').style.cssText    = `top:0;left:0;right:0;height:${guideY}px`;
  $('ovl-bottom').style.cssText = `top:${guideY + guideH}px;left:0;right:0;bottom:0`;
  $('ovl-left').style.cssText   = `top:${guideY}px;left:0;width:${guideX}px;height:${guideH}px`;
  $('ovl-right').style.cssText  = `top:${guideY}px;left:${guideX + guideW}px;right:0;height:${guideH}px`;

  const corners = {
    'corner-tl': { top: guideY - 2,           left: guideX - 2 },
    'corner-tr': { top: guideY - 2,           left: guideX + guideW - 22 },
    'corner-bl': { top: guideY + guideH - 22, left: guideX - 2 },
    'corner-br': { top: guideY + guideH - 22, left: guideX + guideW - 22 },
  };
  Object.entries(corners).forEach(([id, pos]) => {
    const el = $(id);
    el.style.top  = pos.top  + 'px';
    el.style.left = pos.left + 'px';
  });

  $('cam-guide-label').style.top = (guideY + guideH + 10) + 'px';
}

window.addEventListener('resize', () => { if (guideRect) positionGuide(); });

// ── Flash / torch ─────────────────────────────────────────────────

async function toggleFlash() {
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  if (!track) return;

  const caps = track.getCapabilities?.() || {};
  const btn  = $('cam-flash-btn');

  if (caps.torch) {
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      btn.classList.toggle('on', torchOn);
    } catch (e) {
      console.warn('Torch error:', e);
    }
  } else {
    torchOn = !torchOn;
    btn.classList.toggle('on', torchOn);
    showToast(torchOn ? 'Screen brightness increased' : 'Flash off', false);
  }
}

// ── Capture ───────────────────────────────────────────────────────

function capturePhoto() {
  const video  = $('cam-video');
  const canvas = $('cam-canvas');

  if (!video.srcObject || video.readyState < 2) {
    showToast('Camera not ready yet', true);
    return;
  }

  // Flash feedback
  const flashEl = $('cam-flash');
  flashEl.classList.add('flash');
  setTimeout(() => flashEl.classList.remove('flash'), 120);

  // Draw full video frame
  const vw = video.videoWidth  || 1280;
  const vh = video.videoHeight || 720;
  canvas.width  = vw;
  canvas.height = vh;
  canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);

  // Map guide rect from viewport pixels to video pixels
  const vp        = $('cam-viewport');
  const vpW       = vp.clientWidth;
  const vpH       = vp.clientHeight;
  const videoAspect = vw / vh;
  const vpAspect    = vpW / vpH;
  let dispW, dispH, offsetX, offsetY;

  if (videoAspect > vpAspect) {
    dispH = vpH; dispW = vpH * videoAspect;
    offsetX = (dispW - vpW) / 2; offsetY = 0;
  } else {
    dispW = vpW; dispH = vpW / videoAspect;
    offsetX = 0; offsetY = (dispH - vpH) / 2;
  }

  const scaleX = vw / dispW;
  const scaleY = vh / dispH;
  const cropX  = Math.round((guideRect.x + offsetX) * scaleX);
  const cropY  = Math.round((guideRect.y + offsetY) * scaleY);
  const cropW  = Math.round(guideRect.w * scaleX);
  const cropH  = Math.round(guideRect.h * scaleY);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width  = cropW;
  cropCanvas.height = cropH;
  cropCanvas.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  capturedDataUrl = cropCanvas.toDataURL('image/jpeg', 0.92);
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

function retakePhoto() {
  hidePreviewScreen();
  // Camera stream stays running — just returns to the live viewfinder
}

function usePhoto() {
  if (!capturedDataUrl) return;
  const dataUrl = capturedDataUrl;
  hidePreviewScreen();
  showResultScreen(dataUrl); // defined in results.js
}

// ── Screen helpers ────────────────────────────────────────────────

function showCameraScreen() {
  $('screen-camera').classList.add('active');
  // Position guide immediately so it shows even if camera hasn't loaded yet
  requestAnimationFrame(() => positionGuide());
}

function hideCameraScreen() {
  $('screen-camera').classList.remove('active');
  $('screen-preview').classList.remove('active');
}

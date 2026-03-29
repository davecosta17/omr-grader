// calibration.js — sheet calibration screen
// Depends on: dom.js, store.js, omr.js (buildComputedTemplate, GES_STRUCTURE)
//
// The teacher photographs a blank answer sheet through the normal camera flow.
// This screen then shows the image with 4 draggable handles they position on
// the corner bubbles of the answer grid. The grid overlay updates live.
// On save, a template object is written to IndexedDB.

// ── State ─────────────────────────────────────────────────────────

let calibDataUrl   = null;   // captured sheet image
let calibNatW      = 0;      // natural image dimensions
let calibNatH      = 0;
let calibDragging  = null;   // key of handle being dragged: 'tl'|'tr'|'bl'|'br'
let calibOnSave    = null;   // callback(templateId) after successful save

// Initial handle positions — fractions of the sheet image.
// Derived from the original GES sheet analysis; gives teacher a good starting point.
let calibHandles = {
  tl: { x: 0.131, y: 0.428 },   // Q1-A  (top-left of answer grid)
  tr: { x: 0.860, y: 0.428 },   // Q1-D  (top-right of answer grid)
  bl: { x: 0.131, y: 0.806 },   // Q20-A (bottom-left of answer grid)
  br: { x: 0.860, y: 0.806 },   // Q20-D (bottom-right of answer grid)
};

const HANDLE_R   = 24;  // hit-target radius in canvas pixels
const HANDLE_COLORS = { tl: '#ff6b6b', tr: '#ffd93d', bl: '#6bcb77', br: '#4d96ff' };
const HANDLE_LABELS = { tl: 'Q1 · A',  tr: 'Q1 · D',  bl: 'Q20 · A', br: 'Q20 · D' };

// ── Entry point ───────────────────────────────────────────────────

function showCalibrationScreen(dataUrl, onSave) {
  calibDataUrl  = dataUrl;
  calibOnSave   = onSave || null;
  calibDragging = null;

  // Reset handles to defaults each time
  calibHandles = {
    tl: { x: 0.131, y: 0.428 },
    tr: { x: 0.860, y: 0.428 },
    bl: { x: 0.131, y: 0.806 },
    br: { x: 0.860, y: 0.806 },
  };

  $('calib-name').value    = '';
  $('calib-global').checked = false;

  // Hide normal screens so they don't bleed through
  ['screen-home','screen-create'].forEach(id => $(id).classList.remove('active'));
  $('screen-calibration').classList.add('active');

  // Load image dimensions then draw
  const img = new Image();
  img.onload = () => {
    calibNatW = img.naturalWidth;
    calibNatH = img.naturalHeight;
    drawCalibration();
  };
  img.src = dataUrl;
}

function hideCalibrationScreen() {
  $('screen-calibration').classList.remove('active');
  calibDataUrl  = null;
  calibDragging = null;
  // Restore home screen
  $('screen-home').classList.add('active');
}

// ── Drawing ───────────────────────────────────────────────────────

function getImageDisplayRect(natW, natH, containerW, containerH) {
  const containerAspect = containerW / containerH;
  const imageAspect     = natW / natH;
  let w, h, x, y;
  if (imageAspect > containerAspect) {
    w = containerW; h = w / imageAspect;
    x = 0;          y = (containerH - h) / 2;
  } else {
    h = containerH; w = h * imageAspect;
    x = (containerW - w) / 2; y = 0;
  }
  return { x, y, w, h };
}

function fracToCanvas(fx, fy, rect) {
  return { x: rect.x + fx * rect.w, y: rect.y + fy * rect.h };
}

function canvasToFrac(cx, cy, rect) {
  return {
    x: Math.max(0, Math.min(1, (cx - rect.x) / rect.w)),
    y: Math.max(0, Math.min(1, (cy - rect.y) / rect.h)),
  };
}

function drawCalibration() {
  if (!calibDataUrl) return;
  const canvas    = $('calib-canvas');
  const workspace = $('calib-workspace');
  canvas.width    = workspace.clientWidth;
  canvas.height   = workspace.clientHeight;
  const ctx  = canvas.getContext('2d');
  const rect = getImageDisplayRect(calibNatW, calibNatH, canvas.width, canvas.height);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Dim areas outside the image
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    drawGridOverlay(ctx, rect);
    drawHandles(ctx, rect);
  };
  img.src = calibDataUrl;
}

function drawGridOverlay(ctx, rect) {
  const computed = buildComputedTemplate({
    anchors: calibHandles,
    sampleRadius: 0.022,
    fillThreshold: 0.28,
  });
  const r = Math.max(3, Math.round(0.022 * rect.w));

  ctx.strokeStyle = 'rgba(127,255,212,0.65)';
  ctx.lineWidth   = 1.5;

  computed.columns.forEach(col => {
    computed.rowYs.forEach(ry => {
      col.bubbleXs.forEach(bx => {
        const p = fracToCanvas(bx, ry, rect);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      });
    });
  });
}

function drawHandles(ctx, rect) {
  Object.entries(calibHandles).forEach(([key, pos]) => {
    const p     = fracToCanvas(pos.x, pos.y, rect);
    const color = HANDLE_COLORS[key];
    const label = HANDLE_LABELS[key];

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle   = color + '30';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // Centre dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Label (above handle, with dark background for readability)
    const labelY = p.y - HANDLE_R - 6;
    ctx.font      = 'bold 11px "Space Mono", monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(p.x - tw/2 - 4, labelY - 11, tw + 8, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p.x, labelY);
  });
}

// ── Pointer events ────────────────────────────────────────────────

function initCalibPointerEvents() {
  const canvas = $('calib-canvas');

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const canvasRect = canvas.getBoundingClientRect();
    const cx = (e.clientX - canvasRect.left) * (canvas.width  / canvasRect.width);
    const cy = (e.clientY - canvasRect.top)  * (canvas.height / canvasRect.height);
    const imgRect = getImageDisplayRect(calibNatW, calibNatH, canvas.width, canvas.height);

    let closest = null, closestDist = HANDLE_R * 2.5;
    Object.entries(calibHandles).forEach(([key, pos]) => {
      const p = fracToCanvas(pos.x, pos.y, imgRect);
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < closestDist) { closest = key; closestDist = d; }
    });

    if (closest) {
      calibDragging = closest;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!calibDragging) return;
    e.preventDefault();
    const canvasRect = canvas.getBoundingClientRect();
    const cx = (e.clientX - canvasRect.left) * (canvas.width  / canvasRect.width);
    const cy = (e.clientY - canvasRect.top)  * (canvas.height / canvasRect.height);
    const imgRect = getImageDisplayRect(calibNatW, calibNatH, canvas.width, canvas.height);
    calibHandles[calibDragging] = canvasToFrac(cx, cy, imgRect);
    drawCalibration();
  });

  canvas.addEventListener('pointerup',    () => { calibDragging = null; });
  canvas.addEventListener('pointercancel',() => { calibDragging = null; });
}

// ── Save ──────────────────────────────────────────────────────────

async function saveCalibration() {
  const name = $('calib-name').value.trim();
  if (!name) {
    showToast('Please enter a template name', true);
    return;
  }

  const template = {
    id:           generateUUID(),
    name,
    isGlobal:     $('calib-global').checked,
    anchors:      {
      tl: { ...calibHandles.tl },
      tr: { ...calibHandles.tr },
      bl: { ...calibHandles.bl },
      br: { ...calibHandles.br },
    },
    sampleRadius:  0.022,
    fillThreshold: 0.28,
    createdAt:     Date.now(),
  };

  try {
    await dbPutTemplate(template);
    showToast('Template saved ✓');
    hideCalibrationScreen();
    if (calibOnSave) {
      const cb = calibOnSave;
      calibOnSave = null;
      cb(template.id, template);
    }
  } catch (err) {
    console.error('saveCalibration error:', err);
    showToast('Could not save template: ' + (err.message || err), true);
  }
}

// Called by app.js after DOM is ready
function initCalibration() {
  initCalibPointerEvents();

  // Redraw on resize
  window.addEventListener('resize', () => {
    if (calibDataUrl) drawCalibration();
  });
}
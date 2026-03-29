// calibration.js — sheet calibration screen
// Depends on: dom.js, store.js, omr.js (buildComputedTemplate, GES_STRUCTURE)

// ── State ─────────────────────────────────────────────────────────

let calibDataUrl   = null;
let calibNatW      = 0;
let calibNatH      = 0;
let calibDragging  = null;
let calibOnSave    = null;  // callback(templateId, template) after save

let calibHandles = {
  tl: { x: 0.131, y: 0.428 },
  tr: { x: 0.860, y: 0.428 },
  bl: { x: 0.131, y: 0.806 },
  br: { x: 0.860, y: 0.806 },
};

const HANDLE_R      = 26;
const HANDLE_COLORS = { tl: '#ff6b6b', tr: '#ffd93d', bl: '#6bcb77', br: '#4d96ff' };
const HANDLE_LABELS = { tl: 'Q1 · A',  tr: 'Q1 · D',  bl: 'Q20 · A', br: 'Q20 · D' };

// ── Entry point ───────────────────────────────────────────────────

function showCalibrationScreen(dataUrl, onSave) {
  calibDataUrl  = dataUrl;
  calibOnSave   = onSave || null;
  calibDragging = null;

  calibHandles = {
    tl: { x: 0.131, y: 0.428 },
    tr: { x: 0.860, y: 0.428 },
    bl: { x: 0.131, y: 0.806 },
    br: { x: 0.860, y: 0.806 },
  };

  $('calib-name').value     = '';
  $('calib-global').checked = false;

  // Show calibration screen — its own CSS handles display:flex
  $('screen-calibration').classList.add('active');

  // Load image then draw, deferred so DOM paints first
  const img = new Image();
  img.onload = () => {
    calibNatW = img.naturalWidth;
    calibNatH = img.naturalHeight;
    // requestAnimationFrame ensures the screen has been painted and
    // workspace.clientWidth/clientHeight are non-zero before we draw
    requestAnimationFrame(() => requestAnimationFrame(() => drawCalibration()));
  };
  img.src = dataUrl;
}

function hideCalibrationScreen() {
  $('screen-calibration').classList.remove('active');
  calibDataUrl  = null;
  calibDragging = null;
  $('screen-home').classList.add('active');
}

// ── Drawing ───────────────────────────────────────────────────────

function getImageDisplayRect(natW, natH, containerW, containerH) {
  const imgAspect = natW / natH;
  const conAspect = containerW / containerH;
  let w, h, x, y;
  if (imgAspect > conAspect) {
    w = containerW; h = w / imgAspect;
    x = 0;          y = (containerH - h) / 2;
  } else {
    h = containerH; w = h * imgAspect;
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
  const w = workspace.clientWidth;
  const h = workspace.clientHeight;

  // If DOM hasn't laid out yet, retry next frame
  if (w === 0 || h === 0) {
    requestAnimationFrame(() => drawCalibration());
    return;
  }

  canvas.width  = w;
  canvas.height = h;
  const ctx  = canvas.getContext('2d');
  const rect = getImageDisplayRect(calibNatW, calibNatH, w, h);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
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
  const r = Math.max(4, Math.round(0.022 * rect.w));

  ctx.strokeStyle = 'rgba(127,255,212,0.7)';
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

    // Glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle   = color + '30';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // Dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Label
    const labelY = p.y - HANDLE_R - 6;
    ctx.font      = 'bold 11px "Space Mono", monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(p.x - tw/2 - 4, labelY - 11, tw + 8, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p.x, labelY);
  });
}

// ── Pointer / touch events ────────────────────────────────────────

function initCalibPointerEvents() {
  const canvas = $('calib-canvas');

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const br  = canvas.getBoundingClientRect();
    const cx  = (e.clientX - br.left)  * (canvas.width  / br.width);
    const cy  = (e.clientY - br.top)   * (canvas.height / br.height);
    const imgRect = getImageDisplayRect(calibNatW, calibNatH, canvas.width, canvas.height);

    let closest = null, closestDist = HANDLE_R * 3;
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
    const br  = canvas.getBoundingClientRect();
    const cx  = (e.clientX - br.left)  * (canvas.width  / br.width);
    const cy  = (e.clientY - br.top)   * (canvas.height / br.height);
    const imgRect = getImageDisplayRect(calibNatW, calibNatH, canvas.width, canvas.height);
    calibHandles[calibDragging] = canvasToFrac(cx, cy, imgRect);
    drawCalibration();
  });

  canvas.addEventListener('pointerup',     () => { calibDragging = null; });
  canvas.addEventListener('pointercancel', () => { calibDragging = null; });
}

// ── Save ──────────────────────────────────────────────────────────

async function saveCalibration() {
  const name = $('calib-name').value.trim();
  if (!name) {
    showToast('Please enter a template name', true);
    return;
  }

  const template = {
    id:            generateUUID(),
    name,
    isGlobal:      $('calib-global').checked,
    anchors: {
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

    // Fire callback BEFORE hiding so the callback can navigate
    if (calibOnSave) {
      const cb = calibOnSave;
      calibOnSave = null;
      cb(template.id, template);
    }

    // Only hide if calibOnSave didn't already navigate away
    // (hideCalibrationScreen restores home, but callback may show exam form)
    $('screen-calibration').classList.remove('active');
    calibDataUrl  = null;
    calibDragging = null;

  } catch (err) {
    console.error('saveCalibration error:', err);
    showToast('Could not save template: ' + (err.message || err), true);
  }
}

// Called by app.js after DOM is ready
function initCalibration() {
  initCalibPointerEvents();
  window.addEventListener('resize', () => {
    if (calibDataUrl) drawCalibration();
  });
}
// corner-adjust.js — post-capture 4-corner drag + perspective warp
// Used for: calibration (always) and grading (when user enables "adjust borders")
// Depends on: dom.js, warp.js

let cadjDataUrl    = null;  // full-frame captured image
let cadjNatW       = 0;
let cadjNatH       = 0;
let cadjDragging   = null;  // 'tl'|'tr'|'br'|'bl'
let cadjOnConfirm  = null;  // callback(warpedDataUrl)
let cadjOnCancel   = null;  // callback()
let cadjDetecting  = false;

// Corners in fractions of the source image
let cadjCorners = {
  tl: { x: 0.06, y: 0.06 },
  tr: { x: 0.94, y: 0.06 },
  br: { x: 0.94, y: 0.94 },
  bl: { x: 0.06, y: 0.94 },
};

const CADJ_HANDLE_R  = 28;
const CADJ_LINE_CLR  = 'rgba(127,255,212,0.9)';
const CADJ_FILL_CLR  = 'rgba(127,255,212,0.08)';
const CADJ_HANDLE_CLR = '#7FFFD4';

// ── Entry ─────────────────────────────────────────────────────────

function showCornerAdjust(dataUrl, onConfirm, onCancel, autoDetect) {
  cadjDataUrl   = dataUrl;
  cadjOnConfirm = onConfirm || null;
  cadjOnCancel  = onCancel  || null;
  cadjDragging  = null;
  cadjDetecting = false;

  // Default corners: full image with small margin
  cadjCorners = {
    tl: { x: 0.06, y: 0.06 },
    tr: { x: 0.94, y: 0.06 },
    br: { x: 0.94, y: 0.94 },
    bl: { x: 0.06, y: 0.94 },
  };

  $('screen-corner-adjust').classList.add('active');
  ['screen-home','screen-create','screen-camera',
   'screen-preview','screen-result'].forEach(id => {
    const el = $(id);
    if (el) el.classList.remove('active');
  });

  const img = new Image();
  img.onload = () => {
    cadjNatW = img.naturalWidth;
    cadjNatH = img.naturalHeight;

    if (autoDetect) {
      cadjDetecting = true;
      $('cadj-hint').textContent = 'Detecting edges…';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        drawCornerAdjust();
        detectSheetCorners(dataUrl).then(corners => {
          cadjDetecting = false;
          if (corners) {
            // Convert pixel coords to fractions
            cadjCorners = {
              tl: { x: corners.tl.x / cadjNatW, y: corners.tl.y / cadjNatH },
              tr: { x: corners.tr.x / cadjNatW, y: corners.tr.y / cadjNatH },
              br: { x: corners.br.x / cadjNatW, y: corners.br.y / cadjNatH },
              bl: { x: corners.bl.x / cadjNatW, y: corners.bl.y / cadjNatH },
            };
            $('cadj-hint').textContent = 'Edges detected — drag handles to adjust';
          } else {
            $('cadj-hint').textContent = 'Drag handles to the corners of the answer grid';
          }
          drawCornerAdjust();
        });
      }));
    } else {
      $('cadj-hint').textContent = 'Drag handles to the corners of the answer grid';
      requestAnimationFrame(() => requestAnimationFrame(() => drawCornerAdjust()));
    }
  };
  img.src = dataUrl;
}

function hideCornerAdjust() {
  $('screen-corner-adjust').classList.remove('active');
  cadjDataUrl   = null;
  cadjDragging  = null;
  cadjOnConfirm = null;
  cadjOnCancel  = null;
}

// ── Drawing ───────────────────────────────────────────────────────

function getCornerAdjustDisplayRect() {
  const canvas = $('cadj-canvas');
  return getImageDisplayRect(cadjNatW, cadjNatH, canvas.width, canvas.height);
}

function drawCornerAdjust() {
  if (!cadjDataUrl) return;
  const canvas    = $('cadj-canvas');
  const workspace = $('cadj-workspace');
  const W = workspace.clientWidth;
  const H = workspace.clientHeight;
  if (W === 0 || H === 0) { requestAnimationFrame(drawCornerAdjust); return; }

  canvas.width  = W;
  canvas.height = H;
  const ctx  = canvas.getContext('2d');
  const rect = getImageDisplayRect(cadjNatW, cadjNatH, W, H);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);

    // Darken outside the quad
    const pts = cornersToCanvas(rect);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts.tl.x, pts.tl.y);
    ctx.lineTo(pts.tr.x, pts.tr.y);
    ctx.lineTo(pts.br.x, pts.br.y);
    ctx.lineTo(pts.bl.x, pts.bl.y);
    ctx.closePath();
    ctx.clip();
    // Draw image again inside quad at full brightness (noop — already drawn)
    ctx.restore();

    // Semi-dark overlay outside quad
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts.tl.x, pts.tl.y);
    ctx.lineTo(pts.tr.x, pts.tr.y);
    ctx.lineTo(pts.br.x, pts.br.y);
    ctx.lineTo(pts.bl.x, pts.bl.y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    // Quad outline
    ctx.beginPath();
    ctx.moveTo(pts.tl.x, pts.tl.y);
    ctx.lineTo(pts.tr.x, pts.tr.y);
    ctx.lineTo(pts.br.x, pts.br.y);
    ctx.lineTo(pts.bl.x, pts.bl.y);
    ctx.closePath();
    ctx.strokeStyle = CADJ_LINE_CLR;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // Handles
    Object.entries(pts).forEach(([key, p]) => {
      // Outer ring
      ctx.beginPath();
      ctx.arc(p.x, p.y, CADJ_HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(127,255,212,0.18)';
      ctx.fill();
      ctx.strokeStyle = CADJ_HANDLE_CLR;
      ctx.lineWidth   = 3;
      ctx.stroke();
      // Inner dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = CADJ_HANDLE_CLR;
      ctx.fill();
    });
  };
  img.src = cadjDataUrl;
}

function cornersToCanvas(rect) {
  const out = {};
  for (const [k, v] of Object.entries(cadjCorners)) {
    out[k] = { x: rect.x + v.x * rect.w, y: rect.y + v.y * rect.h };
  }
  return out;
}

// ── Pointer events ────────────────────────────────────────────────

function initCornerAdjustPointerEvents() {
  const canvas = $('cadj-canvas');

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const br  = canvas.getBoundingClientRect();
    const cx  = (e.clientX - br.left)  * (canvas.width  / br.width);
    const cy  = (e.clientY - br.top)   * (canvas.height / br.height);
    const rect = getImageDisplayRect(cadjNatW, cadjNatH, canvas.width, canvas.height);

    let closest = null, closestDist = CADJ_HANDLE_R * 3;
    Object.entries(cadjCorners).forEach(([key, pos]) => {
      const p = { x: rect.x + pos.x * rect.w, y: rect.y + pos.y * rect.h };
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < closestDist) { closest = key; closestDist = d; }
    });

    if (closest) {
      cadjDragging = closest;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!cadjDragging) return;
    e.preventDefault();
    const br   = canvas.getBoundingClientRect();
    const cx   = (e.clientX - br.left)  * (canvas.width  / br.width);
    const cy   = (e.clientY - br.top)   * (canvas.height / br.height);
    const rect = getImageDisplayRect(cadjNatW, cadjNatH, canvas.width, canvas.height);
    cadjCorners[cadjDragging] = {
      x: Math.max(0, Math.min(1, (cx - rect.x) / rect.w)),
      y: Math.max(0, Math.min(1, (cy - rect.y) / rect.h)),
    };
    drawCornerAdjust();
  });

  canvas.addEventListener('pointerup',     () => { cadjDragging = null; });
  canvas.addEventListener('pointercancel', () => { cadjDragging = null; });

  window.addEventListener('resize', () => { if (cadjDataUrl) drawCornerAdjust(); });
}

// ── Confirm ───────────────────────────────────────────────────────

async function confirmCornerAdjust() {
  if (!cadjDataUrl) return;

  $('cadj-confirm-btn').disabled = true;
  $('cadj-confirm-btn').textContent = 'Warping…';

  try {
    // Convert fraction corners to pixel coords
    const pixCorners = {
      tl: { x: cadjCorners.tl.x * cadjNatW, y: cadjCorners.tl.y * cadjNatH },
      tr: { x: cadjCorners.tr.x * cadjNatW, y: cadjCorners.tr.y * cadjNatH },
      br: { x: cadjCorners.br.x * cadjNatW, y: cadjCorners.br.y * cadjNatH },
      bl: { x: cadjCorners.bl.x * cadjNatW, y: cadjCorners.bl.y * cadjNatH },
    };

    // Output at 1200×900 (4:3, good for 3-column answer grid)
    const warpedDataUrl = await warpPerspective(cadjDataUrl, pixCorners, 1200, 900);

    const cb = cadjOnConfirm;
    hideCornerAdjust();
    if (cb) cb(warpedDataUrl);
  } catch (err) {
    console.error('Warp error:', err);
    showToast('Could not warp image: ' + (err.message || err), true);
    $('cadj-confirm-btn').disabled = false;
    $('cadj-confirm-btn').textContent = 'Confirm';
  }
}

function cancelCornerAdjust() {
  const cb = cadjOnCancel;
  hideCornerAdjust();
  if (cb) cb();
}

// Called by app.js after DOM ready
function initCornerAdjust() {
  initCornerAdjustPointerEvents();
}
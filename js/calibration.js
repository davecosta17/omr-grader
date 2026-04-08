// calibration.js — template naming, grid preview, and save
// Receives a WARPED image from corner-adjust.js, runs projection profiles,
// shows detected grid overlay for confirmation, then saves the template.

let calibWarpedUrl = null;
let calibProfile   = null;   // result from detectGridProfile()
let calibOnSave    = null;   // callback(templateId, template)

// ── Entry ─────────────────────────────────────────────────────────

async function showCalibrationScreen(warpedDataUrl, onSave) {
  calibWarpedUrl = warpedDataUrl;
  calibOnSave    = onSave || null;
  calibProfile   = null;

  $('calib-name').value     = '';
  $('calib-global').checked = false;
  $('calib-detect-status').textContent = 'Analysing grid…';
  $('calib-detect-status').className   = 'calib-detect-status';

  $('screen-calibration').classList.add('active');
  ['screen-home','screen-create','screen-corner-adjust'].forEach(id => {
    const el = $(id); if (el) el.classList.remove('active');
  });

  // Run grid detection in next frame so screen paints first.
  // Strategy: try OpenCV Hough line detection first (most accurate),
  // fall back to pure-JS number-anchor detection if OpenCV not loaded.
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    try {
      let profile = null;

      // ── Attempt 1: OpenCV Hough line detection ──────────────
      if (getCv()) {
        $('calib-detect-status').textContent = 'Detecting grid lines…';
        profile = await detectGridLinesOpenCV(warpedDataUrl);
        if (profile) profile.method = 'hough';
      }

      // ── Attempt 2: Pure-JS number-anchor detection ──────────
      if (!profile) {
        $('calib-detect-status').textContent = 'Analysing grid…';
        profile = await detectGridProfile(warpedDataUrl);
        if (profile) profile.method = profile.method || 'anchors';
      }

      // Derive a template-specific fill threshold from the captured sheet
      // so grading is less sensitive to printer/lighting differences.
      if (profile) {
        const estimatedThreshold = await estimateTemplateFillThreshold(warpedDataUrl, profile);
        if (Number.isFinite(estimatedThreshold)) profile.fillThreshold = estimatedThreshold;
      }

      calibProfile = profile;
      drawCalibrationPreview();

      const pct    = Math.round(calibProfile.confidence * 100);
      const method = calibProfile.method === 'hough' ? 'line detection' : 'anchor detection';
      if (calibProfile.confidence >= 0.6) {
        $('calib-detect-status').textContent =
          `Grid detected (${pct}% via ${method}) — check overlay looks correct`;
        $('calib-detect-status').className = 'calib-detect-status good';
      } else {
        $('calib-detect-status').textContent =
          `Low confidence (${pct}%) — drag to adjust the overlay, or re-capture`;
        $('calib-detect-status').className = 'calib-detect-status warn';
      }

    } catch (err) {
      console.error('Grid detection error:', err);
      $('calib-detect-status').textContent = 'Detection failed — using estimated positions';
      $('calib-detect-status').className   = 'calib-detect-status warn';
      calibProfile = {
        rowYs:         GES_STRUCTURE.normalizedRowYs.slice(),
        colGroups:     GES_STRUCTURE.normalizedBubbleXs.map(xs => ({ optionXs: xs })),
        cellW: 0.04,   cellH: 0.018,
        fillThreshold: 0.28,
        confidence:    0, detectedAuto: false,
      };
      drawCalibrationPreview();
    }
  }));
}

function hideCalibrationScreen() {
  $('screen-calibration').classList.remove('active');
  calibWarpedUrl = null;
  calibProfile   = null;
  $('screen-home').classList.add('active');
}

// ── Preview drawing ───────────────────────────────────────────────

function drawCalibrationPreview() {
  if (!calibWarpedUrl || !calibProfile) return;

  const canvas    = $('calib-canvas');
  const workspace = $('calib-workspace');
  const W = workspace.clientWidth;
  const H = workspace.clientHeight;
  if (W === 0 || H === 0) { requestAnimationFrame(drawCalibrationPreview); return; }

  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);

    const rect = getImageDisplayRect(img.naturalWidth, img.naturalHeight, W, H);
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);

    // Draw detected grid overlay
    const halfW = Math.round(calibProfile.cellW * rect.w);
    const halfH = Math.round(calibProfile.cellH * rect.h);
    ctx.strokeStyle = 'rgba(127,255,212,0.75)';
    ctx.lineWidth   = 1.5;

    calibProfile.rowYs.forEach(ry => {
      const cy = rect.y + ry * rect.h;
      calibProfile.colGroups.forEach(group => {
        group.optionXs.forEach(ox => {
          const cx = rect.x + ox * rect.w;
          ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
        });
      });
    });
  };
  img.src = calibWarpedUrl;
}

// ── Save ──────────────────────────────────────────────────────────

async function saveCalibration() {
  const name = $('calib-name').value.trim();
  if (!name) { showToast('Please enter a template name', true); return; }
  if (!calibProfile) { showToast('Grid analysis not complete yet', true); return; }

  const template = {
    id:            generateUUID(),
    name,
    isGlobal:      $('calib-global').checked,
    rowYs:         calibProfile.rowYs.slice(),
    colGroups:     calibProfile.colGroups.map(g => ({ optionXs: g.optionXs.slice() })),
    cellW:         calibProfile.cellW,
    cellH:         calibProfile.cellH,
    fillThreshold: calibProfile.fillThreshold,
    detectedAuto:  calibProfile.detectedAuto,
    confidence:    calibProfile.confidence,
    createdAt:     Date.now(),
  };

  try {
    await dbPutTemplate(template);
    showToast('Template saved ✓');

    if (calibOnSave) {
      const cb = calibOnSave;
      calibOnSave = null;
      cb(template.id, template);
    }

    $('screen-calibration').classList.remove('active');
    calibWarpedUrl = null;
    calibProfile   = null;
  } catch (err) {
    console.error('saveCalibration error:', err);
    showToast('Could not save: ' + (err.message || err), true);
  }
}

// Called once by app.js after DOM is ready
function initCalibration() {
  window.addEventListener('resize', () => {
    if (calibWarpedUrl && calibProfile) drawCalibrationPreview();
  });
}

// ── Threshold calibration ──────────────────────────────────────────
// Estimate a template-specific fill threshold using the calibration image.
// The calibration sheet is typically blank, so we model "unfilled" darkness
// distribution and place the threshold above it with a safety margin.

function estimateTemplateFillThreshold(dataUrl, profile) {
  return new Promise(resolve => {
    if (!profile || !profile.rowYs || !profile.colGroups) {
      resolve(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        if (!W || !H) { resolve(null); return; }

        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, W, H);

        const gray = calibToGrayscale(imageData);
        const halfW = Math.max(1, Math.round((profile.cellW || 0.04) * W));
        const halfH = Math.max(1, Math.round((profile.cellH || 0.018) * H));

        const samples = [];
        profile.rowYs.forEach(ry => {
          const cy = Math.round(ry * H);
          profile.colGroups.forEach(group => {
            (group.optionXs || []).forEach(ox => {
              const cx = Math.round(ox * W);
              samples.push(sampleRectDarkness(gray, W, H, cx, cy, halfW, halfH));
            });
          });
        });

        if (!samples.length) { resolve(null); return; }

        // Use robust statistics against outliers (dust/pen marks/shadows).
        const sorted = samples.slice().sort((a, b) => a - b);
        const q90 = sorted[Math.floor((sorted.length - 1) * 0.90)];
        const median = sorted[Math.floor((sorted.length - 1) * 0.50)];
        const spread = Math.max(0.02, q90 - median);

        // Place threshold above observed blank darkness.
        const estimated = q90 + Math.min(0.16, spread * 1.8 + 0.06);
        const clamped = Math.max(0.18, Math.min(0.45, estimated));
        resolve(Math.round(clamped * 1000) / 1000);
      } catch (err) {
        console.warn('estimateTemplateFillThreshold:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function calibToGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8;
  }
  return gray;
}

function sampleRectDarkness(gray, imgW, imgH, cx, cy, halfW, halfH) {
  const x0 = Math.max(0, Math.round(cx - halfW));
  const x1 = Math.min(imgW - 1, Math.round(cx + halfW));
  const y0 = Math.max(0, Math.round(cy - halfH));
  const y1 = Math.min(imgH - 1, Math.round(cy + halfH));
  let dark = 0;
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      total++;
      if (gray[y * imgW + x] < 128) dark++;
    }
  }
  return total > 0 ? dark / total : 0;
}

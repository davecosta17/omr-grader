// omr.js — OMR image processing engine
//
// Supports two template schemas:
//   LEGACY: { anchors:{tl,tr,bl,br}, sampleRadius, fillThreshold }
//   CURRENT: { rowYs, colGroups:[{optionXs}], cellW, cellH, fillThreshold }
//
// resolveTemplate() normalises either schema into a computed template.

// ── GES Grid Structure (normalised, used by legacy schema only) ───
const GES_STRUCTURE = {
  columns:       3,
  rowsPerColumn: 20,
  optionsPerRow: 4,
  normalizedRowYs: [
    0.0000, 0.0450, 0.0897, 0.1312, 0.1759,
    0.2830, 0.3311, 0.3795, 0.4277, 0.4726,
    0.5551, 0.6001, 0.6485, 0.6966, 0.7450,
    0.8104, 0.8588, 0.9069, 0.9553, 1.0000,
  ],
  normalizedBubbleXs: [
    [0.0000, 0.0626, 0.1250, 0.1876],
    [0.3876, 0.4500, 0.5200, 0.5900],
    [0.7875, 0.8575, 0.9326, 1.0000],
  ],
};

// ── Template resolution ───────────────────────────────────────────
// Converts any stored template into the standard computed form
// used by processSheet(). Call this once when a session starts.

function resolveTemplate(storedTemplate) {
  // ── Current schema ──
  if (storedTemplate.rowYs && storedTemplate.colGroups) {
    return {
      rowYs:         storedTemplate.rowYs,
      columns:       storedTemplate.colGroups.map(g => ({ bubbleXs: g.optionXs })),
      cellW:         storedTemplate.cellW         ?? 0.04,
      cellH:         storedTemplate.cellH         ?? 0.018,
      fillThreshold: storedTemplate.fillThreshold ?? 0.28,
    };
  }

  // ── Legacy schema (anchors) ──
  if (storedTemplate.anchors) {
    return buildComputedTemplate(storedTemplate);
  }

  throw new Error('Unknown template schema');
}

// Legacy interpolation path (kept for backward compatibility)
function buildComputedTemplate(storedTemplate) {
  const { tl, tr, bl, br } = storedTemplate.anchors;

  function bilerp(s, t) {
    return {
      x: (1-s)*(1-t)*tl.x + s*(1-t)*tr.x + (1-s)*t*bl.x + s*t*br.x,
      y: (1-s)*(1-t)*tl.y + s*(1-t)*tr.y + (1-s)*t*bl.y + s*t*br.y,
    };
  }

  const rowYs = GES_STRUCTURE.normalizedRowYs.map(t => {
    return ((bilerp(0, t).y + bilerp(1, t).y) / 2);
  });

  const columns = GES_STRUCTURE.normalizedBubbleXs.map(colXs => {
    const bubbleXs = colXs.map(s => (bilerp(s, 0).x + bilerp(s, 1).x) / 2);
    return { bubbleXs };
  });

  // Legacy uses circular sampling radius
  const radius = storedTemplate.sampleRadius ?? 0.022;
  return {
    rowYs,
    columns,
    cellW:         radius,
    cellH:         radius,
    fillThreshold: storedTemplate.fillThreshold ?? 0.28,
    _legacyCircle: true,  // flag to keep circular sampling for old templates
  };
}

// ── Image processing ──────────────────────────────────────────────

function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    gray[i] = (r*77 + g*150 + b*29) >> 8;
  }
  return gray;
}

// Rectangular sampler — matches the [A][B][C][D] box shape
function sampleRect(gray, imgW, imgH, cx, cy, halfW, halfH) {
  const x0 = Math.max(0, Math.round(cx - halfW));
  const x1 = Math.min(imgW - 1, Math.round(cx + halfW));
  const y0 = Math.max(0, Math.round(cy - halfH));
  const y1 = Math.min(imgH - 1, Math.round(cy + halfH));
  let dark = 0, total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      total++;
      if (gray[y * imgW + x] < 128) dark++;
    }
  }
  return total > 0 ? dark / total : 0;
}

// Legacy circular sampler (kept for backward-compat with old templates)
function sampleBubble(gray, imgW, imgH, cx, cy, radius) {
  let dark = 0, total = 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, cx - radius), x1 = Math.min(imgW - 1, cx + radius);
  const y0 = Math.max(0, cy - radius), y1 = Math.min(imgH - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x-cx)**2 + (y-cy)**2 <= r2) {
        total++;
        if (gray[y * imgW + x] < 128) dark++;
      }
    }
  }
  return total > 0 ? dark / total : 0;
}

function processSheet(dataUrl, computedTemplate, questionCount) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const imageData = canvas.getContext('2d').getImageData(0, 0, img.width, img.height);
      const gray = toGrayscale(imageData);
      const W = img.width, H = img.height;

      const answers = [], bubbleMap = [];
      const letters = ['A', 'B', 'C', 'D'];
      const useCircle = computedTemplate._legacyCircle;
      const halfW  = Math.round(computedTemplate.cellW * W);
      const halfH  = Math.round(computedTemplate.cellH * H);

      for (let q = 0; q < questionCount; q++) {
        const colIndex = Math.floor(q / 20);
        const rowIndex = q % 20;
        if (colIndex >= computedTemplate.columns.length) break;
        if (rowIndex >= computedTemplate.rowYs.length) break;

        const cy  = Math.round(computedTemplate.rowYs[rowIndex] * H);
        const col = computedTemplate.columns[colIndex];

        const darknesses = col.bubbleXs.map(xFrac => {
          const cx = Math.round(xFrac * W);
          return useCircle
            ? sampleBubble(gray, W, H, cx, cy, halfW)
            : sampleRect(gray, W, H, cx, cy, halfW, halfH);
        });

        const filled     = darknesses.map((d, i) => ({
          letter: letters[i], darkness: d, filled: d >= computedTemplate.fillThreshold,
        }));
        const filledOnes = filled.filter(b => b.filled);

        let answer;
        if      (filledOnes.length === 0) answer = 'BLANK';
        else if (filledOnes.length >  1)  answer = 'DOUBLE';
        else                              answer = filledOnes[0].letter;

        answers.push(answer);
        bubbleMap.push({
          qNum: q + 1, cy,
          bubbles: col.bubbleXs.map((xFrac, i) => ({
            cx: Math.round(xFrac * W), cy,
            letter: letters[i], darkness: darknesses[i], filled: filled[i].filled,
            halfW, halfH,
          })),
          answer,
        });
      }
      resolve({ answers, bubbleMap, width: W, height: H });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ── Debug overlay ─────────────────────────────────────────────────
// Draws RECTANGLES instead of circles to match the [A][B][C][D] format

function drawDebugOverlay(dataUrl, bubbleMap, width, height, computedTemplate) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = $('result-canvas');
      const maxW   = canvas.parentElement.clientWidth;
      const scale  = maxW / width;
      canvas.width  = Math.round(width  * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const useCircle = computedTemplate._legacyCircle;
      const halfW = Math.round((computedTemplate.cellW || 0.022) * width  * scale);
      const halfH = Math.round((computedTemplate.cellH || 0.022) * height * scale);

      bubbleMap.forEach(row => {
        row.bubbles.forEach(b => {
          const cx = Math.round(b.cx * scale);
          const cy = Math.round(b.cy * scale);
          let color;
          if (b.letter === row.answer && row.answer !== 'BLANK' && row.answer !== 'DOUBLE') {
            color = '#22c55e'; ctx.lineWidth = 2.5;
          } else if (row.answer === 'DOUBLE') {
            color = '#f59e0b'; ctx.lineWidth = 2;
          } else if (row.answer === 'BLANK') {
            color = '#f59e0b'; ctx.lineWidth = 1.5;
          } else {
            color = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
          }
          ctx.strokeStyle = color;
          if (useCircle) {
            ctx.beginPath();
            ctx.arc(cx, cy, halfW, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
          }
        });
      });
      resolve();
    };
    img.src = dataUrl;
  });
}

// ── Result rendering helpers ──────────────────────────────────────

function getResultCellClass(answer, keyAnswer) {
  if (answer === 'BLANK' || answer === 'DOUBLE') return 'flag';
  return answer === keyAnswer ? 'correct' : 'wrong';
}

function getResultAnswerLabel(answer) {
  if (answer === 'BLANK')  return '–';
  if (answer === 'DOUBLE') return '!!';
  return answer;
}

function renderResultAnswers(answers, key) {
  return answers.map((answer, index) => `
    <div class="result-answer-cell ${getResultCellClass(answer, key[index])}">
      <div class="result-answer-qnum">Q${index + 1}</div>
      <div class="result-answer-letter">${getResultAnswerLabel(answer)}</div>
    </div>`).join('');
}

function buildResultFlagsMessage(answers) {
  const blanks  = answers.map((a,i) => a==='BLANK'  ? `Q${i+1}` : null).filter(Boolean);
  const doubles = answers.map((a,i) => a==='DOUBLE' ? `Q${i+1}` : null).filter(Boolean);
  let msg = '⚠️ ';
  if (doubles.length) msg += `Double-shaded: ${doubles.join(', ')}. `;
  if (blanks.length)  msg += `No answer detected: ${blanks.join(', ')}.`;
  msg += ' These score zero. Check and rescan if needed.';
  return msg;
}
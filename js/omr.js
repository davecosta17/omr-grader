// omr.js — OMR image processing engine
//
// GES_TEMPLATE is gone. Templates are now calibrated by the user and stored
// in IndexedDB. This file provides:
//   • GES_STRUCTURE  — the fixed grid structure (normalised 0–1 coordinates)
//   • buildComputedTemplate(storedTemplate)  — converts anchors → processable template
//   • processSheet, drawDebugOverlay, and result-rendering helpers

// ── GES Grid Structure ────────────────────────────────────────────
// Normalised coordinates derived from the real GES answer sheet.
// These encode the relative positions of rows and bubble options
// WITHIN the answer grid (0 = top/left edge, 1 = bottom/right edge).
// They are fixed by the sheet design and never change.

const GES_STRUCTURE = {
  columns:       3,
  rowsPerColumn: 20,
  optionsPerRow: 4,

  // Y position of each row, normalised between first-row-top (0) and last-row-bottom (1).
  // The non-linear spacing preserves the 5-question groups separated by narrow gaps.
  normalizedRowYs: [
    0.0000, 0.0450, 0.0897, 0.1312, 0.1759,   // Q1–5
    0.2830, 0.3311, 0.3795, 0.4277, 0.4726,   // Q6–10
    0.5551, 0.6001, 0.6485, 0.6966, 0.7450,   // Q11–15
    0.8104, 0.8588, 0.9069, 0.9553, 1.0000,   // Q16–20
  ],

  // X position of each option [A,B,C,D] within each column,
  // normalised between leftmost bubble (0) and rightmost bubble (1).
  normalizedBubbleXs: [
    [0.0000, 0.0626, 0.1250, 0.1876],  // column 1 (Q1–20)
    [0.3876, 0.4500, 0.5200, 0.5900],  // column 2 (Q21–40)
    [0.7875, 0.8575, 0.9326, 1.0000],  // column 3 (Q41–60)
  ],
};

// ── Template interpolation ────────────────────────────────────────
// Takes a stored template (with 4 anchor points) and produces
// a computed template that processSheet() can consume directly.
//
// The 4 anchors define the corners of the answer grid as fractions
// of the captured sheet image:
//   tl = Q1, column 1, option A  (top-left  of answer grid)
//   tr = Q1, column 3, option D  (top-right of answer grid)
//   bl = Q20, column 1, option A (bottom-left  of answer grid)
//   br = Q20, column 3, option D (bottom-right of answer grid)

function buildComputedTemplate(storedTemplate) {
  const { tl, tr, bl, br } = storedTemplate.anchors;

  // Bilinear interpolation — correctly handles slight perspective warp.
  // s=0 is left edge, s=1 is right edge.
  // t=0 is top edge (row 1), t=1 is bottom edge (row 20).
  function bilerp(s, t) {
    return {
      x: (1-s)*(1-t)*tl.x + s*(1-t)*tr.x + (1-s)*t*bl.x + s*t*br.x,
      y: (1-s)*(1-t)*tl.y + s*(1-t)*tr.y + (1-s)*t*bl.y + s*t*br.y,
    };
  }

  // Row Y values: average of left-edge and right-edge Y at each normalised row position.
  // Averaging the two edges accounts for slight horizontal perspective.
  const rowYs = GES_STRUCTURE.normalizedRowYs.map(t => {
    const leftY  = bilerp(0, t).y;
    const rightY = bilerp(1, t).y;
    return (leftY + rightY) / 2;
  });

  // Column bubble X values: average of top-edge and bottom-edge X at each normalised
  // bubble position. Averaging accounts for slight vertical perspective.
  const columns = GES_STRUCTURE.normalizedBubbleXs.map(colXs => {
    const bubbleXs = colXs.map(s => {
      const topX    = bilerp(s, 0).x;
      const bottomX = bilerp(s, 1).x;
      return (topX + bottomX) / 2;
    });
    return { bubbleXs };
  });

  return {
    rowYs,
    columns,
    sampleRadius:   storedTemplate.sampleRadius  ?? 0.022,
    fillThreshold:  storedTemplate.fillThreshold ?? 0.28,
  };
}

// ── Image processing ──────────────────────────────────────────────

function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8; // fast luma
  }
  return gray;
}

function sampleBubble(gray, imgW, imgH, cx, cy, radius) {
  let dark = 0, total = 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, cx - radius), x1 = Math.min(imgW - 1, cx + radius);
  const y0 = Math.max(0, cy - radius), y1 = Math.min(imgH - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        total++;
        if (gray[y * imgW + x] < 128) dark++;
      }
    }
  }
  return total > 0 ? dark / total : 0;
}

// computedTemplate is the output of buildComputedTemplate()
function processSheet(dataUrl, computedTemplate, questionCount) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const gray = toGrayscale(imageData);
      const W = img.width, H = img.height;

      const answers = [], bubbleMap = [];
      const radius  = Math.round(computedTemplate.sampleRadius * W);
      const letters = ['A', 'B', 'C', 'D'];

      for (let q = 0; q < questionCount; q++) {
        const colIndex = Math.floor(q / 20);
        const rowIndex = q % 20;
        if (colIndex >= computedTemplate.columns.length) break;
        if (rowIndex >= computedTemplate.rowYs.length) break;

        const cy  = Math.round(computedTemplate.rowYs[rowIndex] * H);
        const col = computedTemplate.columns[colIndex];

        const darknesses = col.bubbleXs.map(xFrac =>
          sampleBubble(gray, W, H, Math.round(xFrac * W), cy, radius)
        );
        const filled     = darknesses.map((d, i) => ({
          letter: letters[i], darkness: d, filled: d >= computedTemplate.fillThreshold,
        }));
        const filledOnes = filled.filter(b => b.filled);

        let answer;
        if (filledOnes.length === 0)    answer = 'BLANK';
        else if (filledOnes.length > 1) answer = 'DOUBLE';
        else                            answer = filledOnes[0].letter;

        answers.push(answer);
        bubbleMap.push({
          qNum: q + 1, cy,
          bubbles: col.bubbleXs.map((xFrac, i) => ({
            cx: Math.round(xFrac * W), cy,
            letter: letters[i], darkness: darknesses[i], filled: filled[i].filled,
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
      const r = Math.round((computedTemplate.sampleRadius || 0.022) * width * scale);

      bubbleMap.forEach(row => {
        row.bubbles.forEach(b => {
          const cx = Math.round(b.cx * scale);
          const cy = Math.round(b.cy * scale);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          if (b.letter === row.answer && row.answer !== 'BLANK' && row.answer !== 'DOUBLE') {
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.5;
          } else if (row.answer === 'DOUBLE') {
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
          } else if (row.answer === 'BLANK') {
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
          }
          ctx.stroke();
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
  const blanks  = answers.map((a, i) => a === 'BLANK'  ? `Q${i+1}` : null).filter(Boolean);
  const doubles = answers.map((a, i) => a === 'DOUBLE' ? `Q${i+1}` : null).filter(Boolean);
  let msg = '⚠️ ';
  if (doubles.length) msg += `Double-shaded: ${doubles.join(', ')}. `;
  if (blanks.length)  msg += `No answer detected: ${blanks.join(', ')}.`;
  msg += ' These score zero. Check and rescan if needed.';
  return msg;
}
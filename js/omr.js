const GES_TEMPLATE = {
  id: 'ges-standard-v1',
  name: 'GES Standard Answer Sheet',
  aspectRatio: 0.7158,

  // Y center of each question row as a fraction of sheet height.
  // 25 rows across 3 columns — GES sheet supports up to 60 questions.
  // Layout: col1 = Q1–20 (rows 0–19), col2 = Q21–40, col3 = Q41–60.
  rowYs: [
    0.4276, 0.4446, 0.4615, 0.4772, 0.4941,   // rows 1–5
    0.5346, 0.5528, 0.5711, 0.5893, 0.6063,   // rows 6–10
    0.6375, 0.6545, 0.6728, 0.6910, 0.7093,   // rows 11–15
    0.7340, 0.7523, 0.7705, 0.7888, 0.8057,   // rows 16–20
    0.8370, 0.8540, 0.8722, 0.8905, 0.9087,   // rows 21–25 (spare)
  ],

  // Bubble X centers per column [A, B, C, D] as fraction of sheet width.
  // Derived from pixel analysis of the real GES sheet.
  columns: [
    { bubbleXs: [0.1311, 0.1767, 0.2222, 0.2678] }, // Col1: Q1–20
    { bubbleXs: [0.4135, 0.4590, 0.5100, 0.5610] }, // Col2: Q21–40
    { bubbleXs: [0.7049, 0.7559, 0.8106, 0.8597] }, // Col3: Q41–60
  ],

  // Sampling radius as fraction of sheet width
  sampleRadius: 0.022,

  // Fraction of dark pixels needed to count a bubble as filled
  fillThreshold: 0.28,
};

function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8; // fast luma
  }
  return gray;
}

function sampleBubble(gray, imgW, imgH, cx, cy, radius) {
  let dark = 0, total = 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(imgW - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(imgH - 1, cy + radius);
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

function processSheet(dataUrl, template, questionCount) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const gray = toGrayscale(imageData);
      const W = img.width, H = img.height;

      const answers   = [];
      const bubbleMap = [];
      const radius    = Math.round(template.sampleRadius * W);
      const letters   = ['A', 'B', 'C', 'D'];

      for (let q = 0; q < questionCount; q++) {
        const colIndex = Math.floor(q / 20);
        const rowIndex = q % 20;
        if (colIndex >= template.columns.length) break;
        if (rowIndex >= template.rowYs.length) break;

        const cy  = Math.round(template.rowYs[rowIndex] * H);
        const col = template.columns[colIndex];

        const darknesses = col.bubbleXs.map(xFrac =>
          sampleBubble(gray, W, H, Math.round(xFrac * W), cy, radius)
        );
        const filled = darknesses.map((d, i) => ({
          letter: letters[i],
          darkness: d,
          filled: d >= template.fillThreshold,
        }));
        const filledOnes = filled.filter(b => b.filled);

        let answer;
        if (filledOnes.length === 0)    answer = 'BLANK';
        else if (filledOnes.length > 1) answer = 'DOUBLE';
        else                            answer = filledOnes[0].letter;

        answers.push(answer);
        bubbleMap.push({
          qNum: q + 1,
          cy,
          bubbles: col.bubbleXs.map((xFrac, i) => ({
            cx:       Math.round(xFrac * W),
            cy,
            letter:   letters[i],
            darkness: darknesses[i],
            filled:   filled[i].filled,
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

function drawDebugOverlay(dataUrl, bubbleMap, width, height) {
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
      const r = Math.round(GES_TEMPLATE.sampleRadius * width * scale);

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
  const blanks  = answers.map((a, i) => a === 'BLANK'  ? `Q${i + 1}` : null).filter(Boolean);
  const doubles = answers.map((a, i) => a === 'DOUBLE' ? `Q${i + 1}` : null).filter(Boolean);
  let msg = '⚠️ ';
  if (doubles.length) msg += `Double-shaded: ${doubles.join(', ')}. `;
  if (blanks.length)  msg += `No answer detected: ${blanks.join(', ')}.`;
  msg += ' These score zero. Check and rescan if needed.';
  return msg;
}

// warp.js — perspective warp + projection profile grid detection
// Depends on: opencv-loader.js (optional enhancement)

// ── Homography (pure JS) ──────────────────────────────────────────
// Gaussian elimination on an augmented matrix [A|b]
function gaussElim(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null; // singular
    const div = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }
  return M.map(row => row[n]);
}

// Compute 3×3 homography H such that dst_i ≈ H * src_i (homogeneous coords)
// srcPts, dstPts: arrays of 4 {x,y}
function computeHomography(srcPts, dstPts) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcPts[i];
    const { x: xp, y: yp } = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]);
    A.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]);
    b.push(xp, yp);
  }
  const h = gaussElim(A, b);
  if (!h) return null;
  return [h[0],h[1],h[2], h[3],h[4],h[5], h[6],h[7],1];
}

function invert3x3(m) {
  const [a,b,c,d,e,f,g,hh,k] = m;
  const det = a*(e*k - f*hh) - b*(d*k - f*g) + c*(d*hh - e*g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    (e*k-f*hh)/det, -(b*k-c*hh)/det,  (b*f-c*e)/det,
    -(d*k-f*g)/det,  (a*k-c*g)/det,  -(a*f-c*d)/det,
    (d*hh-e*g)/det, -(a*hh-b*g)/det,  (a*e-b*d)/det,
  ];
  return inv;
}

function applyH(H, x, y) {
  const w = H[6]*x + H[7]*y + H[8];
  return { x: (H[0]*x + H[1]*y + H[2]) / w,
           y: (H[3]*x + H[4]*y + H[5]) / w };
}

// Bilinear sample of RGBA imageData at sub-pixel (sx, sy)
function bilinearSample(data, W, H, sx, sy) {
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
  const fx = sx - x0, fy = sy - y0;
  const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4;
  const i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
  const out = [];
  for (let c = 0; c < 4; c++) {
    out.push(
      data[i00+c] * (1-fx)*(1-fy) + data[i10+c] * fx*(1-fy) +
      data[i01+c] * (1-fx)*fy     + data[i11+c] * fx*fy
    );
  }
  return out;
}

// ── Main warp function ────────────────────────────────────────────
// corners: { tl, tr, br, bl } each {x, y} in source image pixels
// Returns a Promise<dataUrl> of the perspective-corrected image
function warpPerspective(srcDataUrl, corners, outW, outH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth, srcH = img.naturalHeight;

      // Try OpenCV first for quality
      const cvLib = getCv(); // from opencv-loader.js
      if (cvLib) {
        try {
          const src = cvLib.imread((() => {
            const c = document.createElement('canvas');
            c.width = srcW; c.height = srcH;
            c.getContext('2d').drawImage(img, 0, 0);
            return c;
          })());
          const dst = new cvLib.Mat();
          const srcCorners = cvLib.matFromArray(4, 1, cvLib.CV_32FC2, [
            corners.tl.x, corners.tl.y,
            corners.tr.x, corners.tr.y,
            corners.br.x, corners.br.y,
            corners.bl.x, corners.bl.y,
          ]);
          const dstCorners = cvLib.matFromArray(4, 1, cvLib.CV_32FC2, [
            0, 0, outW, 0, outW, outH, 0, outH,
          ]);
          const M = cvLib.getPerspectiveTransform(srcCorners, dstCorners);
          const dsize = new cvLib.Size(outW, outH);
          cvLib.warpPerspective(src, dst, M, dsize, cvLib.INTER_LINEAR, cvLib.BORDER_CONSTANT,
            new cvLib.Scalar(255, 255, 255, 255));
          const outCanvas = document.createElement('canvas');
          outCanvas.width = outW; outCanvas.height = outH;
          cvLib.imshow(outCanvas, dst);
          [src, dst, srcCorners, dstCorners, M].forEach(m => m.delete());
          resolve(outCanvas.toDataURL('image/jpeg', 0.92));
          return;
        } catch (e) {
          console.warn('OpenCV warp failed, falling back to pure JS:', e);
        }
      }

      // Pure JS fallback — inverse warp using homography
      const srcPts = [corners.tl, corners.tr, corners.br, corners.bl];
      const dstPts = [{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}];

      // H maps dst → src (inverse warp: for each output pixel, find source pixel)
      const H = computeHomography(dstPts, srcPts);
      if (!H) { reject(new Error('Homography computation failed')); return; }

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = srcW; srcCanvas.height = srcH;
      const srcCtx = srcCanvas.getContext('2d');
      srcCtx.drawImage(img, 0, 0);
      const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

      const outCanvas = document.createElement('canvas');
      outCanvas.width = outW; outCanvas.height = outH;
      const outCtx  = outCanvas.getContext('2d');
      const outImageData = outCtx.createImageData(outW, outH);
      const outData = outImageData.data;

      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const { x: sx, y: sy } = applyH(H, x, y);
          if (sx >= 0 && sx < srcW - 1 && sy >= 0 && sy < srcH - 1) {
            const rgba = bilinearSample(srcData, srcW, srcH, sx, sy);
            const idx  = (y * outW + x) * 4;
            outData[idx]   = rgba[0];
            outData[idx+1] = rgba[1];
            outData[idx+2] = rgba[2];
            outData[idx+3] = rgba[3];
          } else {
            // Out of bounds → white
            const idx = (y * outW + x) * 4;
            outData[idx] = outData[idx+1] = outData[idx+2] = 255;
            outData[idx+3] = 255;
          }
        }
      }
      outCtx.putImageData(outImageData, 0, 0);
      resolve(outCanvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = reject;
    img.src = srcDataUrl;
  });
}

// ── OpenCV edge detection for auto-corner finding ─────────────────
// Returns Promise<{tl,tr,br,bl}> in source image pixel coords,
// or null if no reliable quadrilateral found.
async function detectSheetCorners(dataUrl) {
  let cvLib;
  try { cvLib = await loadOpenCV(); } catch(e) { return null; }

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);

        const src  = cvLib.imread(canvas);
        const gray = new cvLib.Mat();
        const blur = new cvLib.Mat();
        const edges = new cvLib.Mat();
        const contours = new cvLib.MatVector();
        const hierarchy = new cvLib.Mat();

        cvLib.cvtColor(src, gray, cvLib.COLOR_RGBA2GRAY);
        cvLib.GaussianBlur(gray, blur, new cvLib.Size(5,5), 0);
        cvLib.Canny(blur, edges, 50, 150);

        // Dilate slightly to close small gaps in border lines
        const kernel = cvLib.Mat.ones(3, 3, cvLib.CV_8U);
        cvLib.dilate(edges, edges, kernel);

        cvLib.findContours(edges, contours, hierarchy,
          cvLib.RETR_EXTERNAL, cvLib.CHAIN_APPROX_SIMPLE);

        let bestContour = null, bestArea = 0;
        for (let i = 0; i < contours.size(); i++) {
          const cnt  = contours.get(i);
          const area = cvLib.contourArea(cnt);
          if (area > bestArea) { bestArea = area; bestContour = cnt; }
        }

        let result = null;
        if (bestContour) {
          const peri    = cvLib.arcLength(bestContour, true);
          const approx  = new cvLib.Mat();
          cvLib.approxPolyDP(bestContour, approx, 0.02 * peri, true);

          if (approx.rows === 4) {
            const pts = [];
            for (let i = 0; i < 4; i++) {
              pts.push({ x: approx.data32S[i*2], y: approx.data32S[i*2+1] });
            }
            // Sort: tl, tr, br, bl
            pts.sort((a,b) => a.x - b.x);
            const left  = pts.slice(0,2).sort((a,b) => a.y - b.y);
            const right = pts.slice(2,4).sort((a,b) => a.y - b.y);
            result = { tl: left[0], bl: left[1], tr: right[0], br: right[1] };
          }
          approx.delete();
        }

        [src, gray, blur, edges, contours, hierarchy, kernel].forEach(m => {
          try { m.delete(); } catch(_) {}
        });
        resolve(result);
      } catch(e) {
        console.warn('Corner detection error:', e);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ── Hough line grid detection (OpenCV) ───────────────────────────
// After perspective warp produces a flat rectangular image, detect
// the printed grid lines using HoughLinesP. Horizontal lines give
// row positions; vertical lines give column/option positions.
// Returns the same schema as detectGridFromNumbers() so the two can
// be compared or either used independently.

async function detectGridLinesOpenCV(dataUrl) {
  const cvLib = getCv();
  if (!cvLib) return null;  // OpenCV not loaded — caller falls back

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.naturalWidth, H = img.naturalHeight;

        // Draw to canvas for imread
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        canvas.getContext('2d').drawImage(img, 0, 0);

        const src  = cvLib.imread(canvas);
        const gray = new cvLib.Mat();
        const blur = new cvLib.Mat();
        const bin  = new cvLib.Mat();

        cvLib.cvtColor(src, gray, cvLib.COLOR_RGBA2GRAY);
        // Slight blur to reduce noise while keeping line edges sharp
        cvLib.GaussianBlur(gray, blur, new cvLib.Size(3, 3), 0);
        // Adaptive threshold — handles uneven lighting across the sheet
        cvLib.adaptiveThreshold(
          blur, bin, 255,
          cvLib.ADAPTIVE_THRESH_MEAN_C, cvLib.THRESH_BINARY_INV,
          15, 8
        );

        // ── Detect horizontal lines ───────────────────────────
        // Isolate horizontal structure with morphological opening.
        // kernelW = H/3 ensures we only keep lines spanning most of a row group.
        const hKernelW = Math.max(20, Math.round(W / 3));
        const hKernel  = cvLib.getStructuringElement(
          cvLib.MORPH_RECT, new cvLib.Size(hKernelW, 1)
        );
        const hLines = new cvLib.Mat();
        cvLib.morphologyEx(bin, hLines, cvLib.MORPH_OPEN, hKernel);

        // ── Detect vertical lines ─────────────────────────────
        // Isolate vertical structure.
        const vKernelH = Math.max(10, Math.round(H / 5));
        const vKernel  = cvLib.getStructuringElement(
          cvLib.MORPH_RECT, new cvLib.Size(1, vKernelH)
        );
        const vLines = new cvLib.Mat();
        cvLib.morphologyEx(bin, vLines, cvLib.MORPH_OPEN, vKernel);

        // ── Extract Y positions from horizontal lines ─────────
        const hProf = new Float32Array(H);
        for (let y = 0; y < H; y++) {
          let sum = 0;
          for (let x = 0; x < W; x++) sum += hLines.ucharAt(y, x);
          hProf[y] = sum / (W * 255);
        }
        const hSmooth   = gaussianSmooth1D(hProf, 2);
        const hPeaks    = findPeaks(hSmooth, 0.05, Math.round(H / 40));
        // Peaks are the printed separator lines — midpoints are cell centres
        const rowYs     = linePeaksToMidpoints(hPeaks, H);

        // ── Extract X positions from vertical lines ───────────
        const vProf = new Float32Array(W);
        for (let x = 0; x < W; x++) {
          let sum = 0;
          for (let y = 0; y < H; y++) sum += vLines.ucharAt(y, x);
          vProf[x] = sum / (H * 255);
        }
        const vSmooth = gaussianSmooth1D(vProf, 2);
        const vPeaks  = findPeaks(vSmooth, 0.05, Math.round(W / 50));
        const colXs   = linePeaksToMidpoints(vPeaks, W);

        // ── Build colGroups: cluster colXs into 3 groups of 4 ─
        const colGroups = clusterColumnsIntoGroups(colXs, W);

        // ── Clean up OpenCV Mats ──────────────────────────────
        [src, gray, blur, bin, hKernel, hLines, vKernel, vLines]
          .forEach(m => { try { m.delete(); } catch(_){} });

        if (rowYs.length < 8 || colGroups.length < 3) {
          resolve(null);  // not enough detected — caller falls back
          return;
        }

        // ── Cell size from line spacing ───────────────────────
        const rowSpacing = rowYs.length > 1
          ? (rowYs[rowYs.length-1] - rowYs[0]) / (rowYs.length - 1)
          : 0.04;
        const optSpacing = colGroups[0].optionXs.length > 1
          ? colGroups[0].optionXs[1] - colGroups[0].optionXs[0]
          : 0.06;

        resolve({
          rowYs:         rowYs.slice(0, 20),
          colGroups,
          cellW:         Math.max(0.012, Math.min(0.07,  optSpacing * 0.38)),
          cellH:         Math.max(0.008, Math.min(0.045, rowSpacing * 0.40)),
          fillThreshold: 0.28,
          confidence:    computeSpacingConfidence(rowYs.map((y, i) => Math.round(y * H))),
          detectedAuto:  true,
          method:        'hough',
        });

      } catch (err) {
        console.warn('Hough line detection error:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Convert an array of line-peak positions to cell-centre midpoints.
// Each pair of adjacent peaks brackets a cell; the midpoint is the centre.
// Also prepends a virtual "border" at 0 and appends one at maxVal so
// the outermost cells are included.
function linePeaksToMidpoints(peaks, maxVal) {
  if (peaks.length < 2) return [];
  const borders = [0, ...peaks, maxVal];
  const midpoints = [];
  for (let i = 0; i < borders.length - 1; i++) {
    midpoints.push((borders[i] + borders[i+1]) / 2 / maxVal);
  }
  return midpoints;
}

// Cluster column X positions into 3 groups of 4 answer options.
// The three column groups are separated by larger gaps than the
// gaps between options within a group.
function clusterColumnsIntoGroups(colXs, W) {
  if (colXs.length < 12) return [];

  // Find the two largest gaps — these separate the 3 column groups
  const gaps = [];
  for (let i = 1; i < colXs.length; i++) {
    gaps.push({ i, size: colXs[i] - colXs[i-1] });
  }
  gaps.sort((a, b) => b.size - a.size);
  const splitIdxs = gaps.slice(0, 2).map(g => g.i).sort((a, b) => a - b);

  const groups = [
    colXs.slice(0, splitIdxs[0]),
    colXs.slice(splitIdxs[0], splitIdxs[1]),
    colXs.slice(splitIdxs[1]),
  ];

  // Each group should have ~4 options — keep the 4 closest to equally spaced
  return groups.map(grp => {
    const xs = grp.length >= 4 ? grp.slice(0, 4) : grp;
    return { optionXs: xs };
  }).filter(g => g.optionXs.length >= 2);
}

// ── Grid detection via question number anchors ───────────────────
// Pure JS — no OpenCV needed.
// Strategy: question numbers sit in a narrow strip on the LEFT of each
// column group, followed by a visible gap, then [A][B][C][D] boxes.
// We find the 20 number-blob Y positions per group → row centres.
// We find the gap right edge → divide remainder into 4 equal answer boxes.
// Uses adaptive thresholding (integral image) to handle uneven lighting.

function detectGridProfile(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve(detectGridFromNumbers(imageData));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ── Adaptive threshold (integral image) ──────────────────────────
// For each pixel: dark if luma < local_neighbourhood_mean - C
// kernelR: half-width of neighbourhood (pixels). C: offset constant.
// Uses summed area table → O(W×H) total, no per-pixel kernel loop.
function adaptiveThreshold(data, W, H, kernelR, C) {
  // Grayscale
  const luma = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    luma[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
  }
  // Integral image (one extra row+col of zeros for easy boundary handling)
  const iW = W + 1;
  const integral = new Float64Array(iW * (H + 1));
  for (let y = 1; y <= H; y++) {
    for (let x = 1; x <= W; x++) {
      integral[y*iW + x] =
        luma[(y-1)*W + (x-1)]
        + integral[(y-1)*iW + x]
        + integral[y*iW + (x-1)]
        - integral[(y-1)*iW + (x-1)];
    }
  }
  // Threshold
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - kernelR),  x2 = Math.min(W-1, x + kernelR);
      const y1 = Math.max(0, y - kernelR),  y2 = Math.min(H-1, y + kernelR);
      const count = (x2-x1+1) * (y2-y1+1);
      const sum   = integral[(y2+1)*iW + (x2+1)]
                  - integral[y1*iW    + (x2+1)]
                  - integral[(y2+1)*iW + x1]
                  + integral[y1*iW    + x1];
      dark[y*W + x] = luma[y*W + x] < (sum / count - C) ? 1 : 0;
    }
  }
  return dark;
}

// ── Main detection ────────────────────────────────────────────────
function detectGridFromNumbers(imageData) {
  const { data, width: W, height: H } = imageData;

  // Adaptive threshold: 20px neighbourhood, 10 luma units below local mean = dark
  const dark = adaptiveThreshold(data, W, H, 20, 10);

  // ── Step 1: Find column group boundaries ─────────────────────
  // The image has three column groups roughly in equal thirds.
  // Find the two separator valleys in the full-width horizontal projection.
  const hFull = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) s += dark[y*W + x];
    hFull[x] = s / H;
  }
  const hSmooth = gaussianSmooth1D(hFull, 5);

  // Find two valleys (column group separators) between the three groups.
  // Search in the inner two-thirds of the image (avoid edges).
  function findValleyBetween(lo, hi) {
    let minVal = Infinity, minX = Math.round((lo + hi) / 2);
    for (let x = lo; x < hi; x++) {
      if (hSmooth[x] < minVal) { minVal = hSmooth[x]; minX = x; }
    }
    return minX;
  }
  const sep1 = findValleyBetween(Math.round(W * 0.25), Math.round(W * 0.42));
  const sep2 = findValleyBetween(Math.round(W * 0.55), Math.round(W * 0.75));

  const thirds = [
    { x0: 0,    x1: sep1 },
    { x0: sep1, x1: sep2 },
    { x0: sep2, x1: W    },
  ];

  // ── Step 2: Per-column-group detection ───────────────────────
  const groupRowPeaks = [];
  const groupAnswerXs = [];

  for (const { x0, x1 } of thirds) {
    const tw = x1 - x0;
    if (tw < 10) continue;

    // ── 2a: Find row positions via number column ──────────────
    // The number column occupies the leftmost ~22% of this group.
    const numColEnd = x0 + Math.round(tw * 0.22);

    // Vertical projection within the number column strip.
    // Each question number is a dark blob → peak in this profile.
    const vProf = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = x0; x < numColEnd; x++) s += dark[y*W + x];
      vProf[y] = s / (numColEnd - x0);
    }
    const smoothV = gaussianSmooth1D(vProf, 2);

    // Find peaks — these are the question number row centres.
    // minHeight: 0.04 (numbers are reliably dark after adaptive threshold)
    // minDist: H/30 prevents double-counting adjacent dark pixels in one number
    const peaks = findPeaks(smoothV, 0.04, Math.round(H / 30));

    // Keep top 20 by amplitude, then sort by Y position
    peaks.sort((a, b) => smoothV[b] - smoothV[a]);
    const top20 = peaks.slice(0, 20).sort((a, b) => a - b);

    if (top20.length >= 8) {  // need at least 8 rows to be useful
      groupRowPeaks.push(top20);
    }

    // ── 2b: Find answer box X positions ──────────────────────
    // Horizontal projection within this group, across the middle 60% of rows
    // (avoids top/bottom borders that could confuse the gap detection).
    const midY0 = Math.round(H * 0.20);
    const midY1 = Math.round(H * 0.80);

    const hProf = new Float32Array(tw);
    for (let xi = 0; xi < tw; xi++) {
      let s = 0;
      const x = x0 + xi;
      for (let y = midY0; y < midY1; y++) s += dark[y*W + x];
      hProf[xi] = s / (midY1 - midY0);
    }
    const smoothHp = gaussianSmooth1D(hProf, 3);

    // Find the gap: scan from ~15% to 45% of the group width for the minimum.
    // The number column ends and the gap begins in this range.
    const gapSearchLo = Math.round(tw * 0.15);
    const gapSearchHi = Math.round(tw * 0.45);
    let gapX = gapSearchLo, minV = smoothHp[gapSearchLo];
    for (let xi = gapSearchLo; xi < gapSearchHi; xi++) {
      if (smoothHp[xi] < minV) { minV = smoothHp[xi]; gapX = xi; }
    }

    // Answer area starts after the gap (add a small margin).
    const ansStart = Math.min(gapX + Math.round(tw * 0.05), Math.round(tw * 0.48));
    // Answer area ends near the right edge of the group (leave 2% margin).
    const ansEnd   = tw - Math.round(tw * 0.02);
    const ansW     = Math.max(1, ansEnd - ansStart);

    // The four answer boxes are equally spaced within the answer area.
    // Centre of box i = ansStart + (i + 0.5) * ansW/4
    const optionXs = [0, 1, 2, 3].map(i =>
      (x0 + ansStart + (i + 0.5) * ansW / 4) / W
    );
    groupAnswerXs.push({ optionXs });
  }

  // ── Step 3: Merge row positions across column groups ─────────
  let rowYs, confidence;

  if (groupRowPeaks.length > 0) {
    // Use the group with the most detected rows as the primary source.
    // Cross-validate: if multiple groups agree, confidence goes up.
    const best = groupRowPeaks.reduce((a, b) => a.length >= b.length ? a : b);
    confidence = computeSpacingConfidence(best);

    // If we got rows from multiple groups, average their spacings for robustness
    if (groupRowPeaks.length > 1 && best.length >= 15) {
      // Refine row positions: average Y of matching rows across groups
      const allY = best.map(y => {
        const candidates = [y / H];
        for (const other of groupRowPeaks) {
          if (other === best) continue;
          const closest = other.reduce((c, v) =>
            Math.abs(v - y) < Math.abs(c - y) ? v : c, other[0]);
          if (Math.abs(closest - y) < H / 25) candidates.push(closest / H);
        }
        return candidates.reduce((a, b) => a + b, 0) / candidates.length;
      });
      rowYs = allY;
      // Boost confidence when multiple groups agree
      confidence = Math.min(1, confidence * 1.3);
    } else {
      rowYs = best.map(y => y / H);
    }

    // Pad to exactly 20 rows by extrapolating from the detected spacing
    while (rowYs.length < 20) {
      const n = rowYs.length;
      const step = n > 1 ? rowYs[n-1] - rowYs[n-2] : 0.04;
      rowYs.push(Math.min(1, rowYs[n-1] + step));
    }
    rowYs = rowYs.slice(0, 20);

  } else {
    // No groups detected — fall back to GES_STRUCTURE normalised values
    rowYs      = GES_STRUCTURE.normalizedRowYs.slice();
    confidence = 0;
  }

  // ── Step 4: Cell size estimation ─────────────────────────────
  const rowSpacingFrac = rowYs.length > 1
    ? (rowYs[rowYs.length-1] - rowYs[0]) / (rowYs.length - 1)
    : 0.04;
  const cellH = rowSpacingFrac * 0.40;

  // Cell width from spacing between adjacent answer box centres
  let cellW = 0.025;
  if (groupAnswerXs.length > 0 && groupAnswerXs[0].optionXs.length >= 2) {
    const spacing = groupAnswerXs[0].optionXs[1] - groupAnswerXs[0].optionXs[0];
    cellW = spacing * 0.38;
  }

  const colGroups = groupAnswerXs.length === 3
    ? groupAnswerXs
    : GES_STRUCTURE.normalizedBubbleXs.map(xs => ({ optionXs: xs }));

  return {
    rowYs,
    colGroups,
    cellW:         Math.max(0.012, Math.min(0.07, cellW)),
    cellH:         Math.max(0.008, Math.min(0.045, cellH)),
    fillThreshold: 0.28,
    confidence:    Math.round(confidence * 100) / 100,
    detectedAuto:  true,
  };
}

// ── Signal processing helpers ─────────────────────────────────────

function gaussianSmooth1D(arr, sigma) {
  const r     = Math.ceil(sigma * 2);
  const kernel = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i*i) / (2*sigma*sigma));
    kernel.push(v); sum += v;
  }
  const k = kernel.map(v => v / sum);
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0;
    for (let j = 0; j < k.length; j++) {
      const idx = Math.max(0, Math.min(arr.length-1, i - r + j));
      s += arr[idx] * k[j];
    }
    out[i] = s;
  }
  return out;
}

function findPeaks(arr, minHeight, minDist) {
  const peaks = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > minHeight && arr[i] >= arr[i-1] && arr[i] >= arr[i+1]) {
      if (peaks.length === 0 || i - peaks[peaks.length-1] >= minDist) {
        peaks.push(i);
      } else if (arr[i] > arr[peaks[peaks.length-1]]) {
        peaks[peaks.length-1] = i;
      }
    }
  }
  return peaks;
}

function computeSpacingConfidence(peaks) {
  if (peaks.length < 3) return 0.3;
  const spacings = [];
  for (let i = 1; i < peaks.length; i++) spacings.push(peaks[i] - peaks[i-1]);
  const mean = spacings.reduce((a,b) => a+b, 0) / spacings.length;
  const variance = spacings.reduce((a,b) => a + (b-mean)**2, 0) / spacings.length;
  const cv = Math.sqrt(variance) / mean;   // coefficient of variation
  // CV near 0 = very regular, confidence high; CV > 0.5 = irregular, confidence low
  return Math.max(0, Math.min(1, 1 - cv * 2));
}
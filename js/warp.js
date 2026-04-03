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

// ── Projection profile grid detection ────────────────────────────
// Pure JS — no OpenCV needed.
// Analyses a WARPED (flat rectangular) grid image to find row and column positions.
// Returns { rowYs, colGroupXs, confidence }
//   rowYs: array of 20 fractions [0..1] of image height
//   colGroupXs: [[A,B,C,D], [A,B,C,D], [A,B,C,D]] fractions of image width
//   confidence: 0..1 (1 = perfectly regular spacing)
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
      const result = runProjectionProfiles(imageData);
      resolve(result);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function runProjectionProfiles(imageData) {
  const { data, width: W, height: H } = imageData;

  // Build grayscale + threshold
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const luma = (r*77 + g*150 + b*29) >> 8;
    dark[i] = luma < 140 ? 1 : 0;  // slightly lenient threshold
  }

  // ── Horizontal profile ────────────────────────────────────────
  const rowProfile = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = 0; x < W; x++) sum += dark[y * W + x];
    rowProfile[y] = sum / W;
  }
  const smoothRow = gaussianSmooth1D(rowProfile, 3);

  // Find peaks in horizontal profile (answer rows have many dark pixels)
  const rowPeaks = findPeaks(smoothRow, 0.05, Math.round(H / 80));
  // Filter: keep top ~20 by height
  rowPeaks.sort((a, b) => smoothRow[b] - smoothRow[a]);
  const topRowPeaks = rowPeaks.slice(0, 25).sort((a, b) => a - b);

  // ── Vertical profile ──────────────────────────────────────────
  const colProfile = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = 0; y < H; y++) sum += dark[y * W + x];
    colProfile[x] = sum / H;
  }
  const smoothCol = gaussianSmooth1D(colProfile, 3);
  const colPeaks = findPeaks(smoothCol, 0.05, Math.round(W / 60));
  colPeaks.sort((a, b) => smoothCol[b] - smoothCol[a]);
  const topColPeaks = colPeaks.slice(0, 15).sort((a, b) => a - b);

  // ── Build rowYs ───────────────────────────────────────────────
  // We want exactly 20 row centres. If we got close, trust them.
  const rowYs = topRowPeaks.slice(0, 20).map(y => y / H);
  // Pad or interpolate if fewer than 20
  while (rowYs.length < 20) {
    const last = rowYs[rowYs.length - 1] || 0;
    const step = rowYs.length > 1 ? rowYs[1] - rowYs[0] : 0.04;
    rowYs.push(Math.min(1, last + step));
  }

  // ── Build colGroupXs ─────────────────────────────────────────
  // Expect 12 option columns in 3 groups of 4
  const colGroupXs = [];
  if (topColPeaks.length >= 12) {
    for (let g = 0; g < 3; g++) {
      colGroupXs.push({
        optionXs: topColPeaks.slice(g*4, g*4+4).map(x => x / W)
      });
    }
  } else {
    // Fallback: use GES_STRUCTURE normalised values
    colGroupXs.push({ optionXs: [0.1311,0.1767,0.2222,0.2678] });
    colGroupXs.push({ optionXs: [0.4135,0.4590,0.5100,0.5610] });
    colGroupXs.push({ optionXs: [0.7049,0.7559,0.8106,0.8597] });
  }

  // ── Confidence ───────────────────────────────────────────────
  const confidence = computeSpacingConfidence(topRowPeaks);

  // ── Cell size ────────────────────────────────────────────────
  // Estimate from peak spacing
  const avgRowSpacing = topRowPeaks.length > 1
    ? (topRowPeaks[topRowPeaks.length-1] - topRowPeaks[0]) / (topRowPeaks.length - 1)
    : H / 22;
  const avgColSpacing = topColPeaks.length > 1
    ? (topColPeaks[topColPeaks.length-1] - topColPeaks[0]) / (topColPeaks.length - 1)
    : W / 14;

  const cellH = (avgRowSpacing * 0.35) / H;
  const cellW = (avgColSpacing * 0.35) / W;

  return {
    rowYs,
    colGroups: colGroupXs,
    cellW: Math.max(0.015, Math.min(0.07, cellW)),
    cellH: Math.max(0.010, Math.min(0.04, cellH)),
    fillThreshold: 0.28,
    confidence,
    detectedAuto: true,
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
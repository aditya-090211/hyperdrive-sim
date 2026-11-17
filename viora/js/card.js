// Reference card: geometry (single source of truth for the printable page and the detector),
// card detection in a photo, patch measurement and colour correction.
//
// All card geometry is in millimetres from the top-left corner of the printed card.
// Image functions take { data: Uint8ClampedArray (RGBA), width, height } and work on plain
// objects as well as real ImageData, so they run unchanged in Node for testing.

import { DEFAULT_REFS, rgbToLab, deltaE } from './color.js';

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export const CARD = Object.freeze({
  width: 120,
  height: 80,
  fiducialSize: 10,
  // Top-left corners of the four solid black fiducial squares, in corner order TL, TR, BR, BL.
  fiducials: [[4, 4], [106, 4], [106, 66], [4, 66]],
  // Homography anchors: fiducial centres, same order (TL, TR, BR, BL).
  anchors: [[9, 9], [111, 9], [111, 71], [9, 71]],
  // Orientation key: white square hole in the centre of the top-left fiducial.
  keyHole: { cx: 9, cy: 9, size: 4 },
  patchSize: 12,          // neutral and reference patches, and pad outlines
  sampleSize: 8,          // central area that is sampled
  white: { cx: 26, cy: 20, label: 'White' },                    // bare paper
  grey: { cx: 42, cy: 20, hex: '#808080', label: 'Grey' },
  refs: DEFAULT_REFS.map((r, i) => ({ cx: 58 + 16 * i, cy: 20, hex: r.hex, label: 'Ref ' + (i + 1) })),
  slot: { x0: 14, y0: 38, x1: 106, y1: 60 },
  control: { cx: 40, cy: 49, label: 'Control (dry)' },
  test: { cx: 80, cy: 49, label: 'Test (saliva)' },
  // Card-white points kept free of print; the detector checks they are bright.
  blankPoints: [[30, 9], [58, 9], [85, 9], [25, 71], [95, 71], [9, 30], [9, 50], [111, 30], [111, 50], [26, 20]],
  caption: { x: 60, y: 76.5, text: 'Viora reference card v1. Print at 100%, do not scale.' }
});

/**
 * SVG markup of the card at true physical size (width/height in mm, viewBox in mm).
 * Used by card.html; generated from CARD so the printout and the detector cannot drift apart.
 */
export function cardSvg({ id = '' } = {}) {
  const C = CARD, f = C.fiducialSize, p = C.patchSize, h = p / 2;
  const el = [];
  el.push(`<rect x="0.1" y="0.1" width="${C.width - 0.2}" height="${C.height - 0.2}" fill="#ffffff" stroke="#b9b9b9" stroke-width="0.2" stroke-dasharray="1.2 0.8"/>`);
  for (const [x, y] of C.fiducials) el.push(`<rect x="${x}" y="${y}" width="${f}" height="${f}" fill="#000000"/>`);
  const k = C.keyHole;
  el.push(`<rect x="${k.cx - k.size / 2}" y="${k.cy - k.size / 2}" width="${k.size}" height="${k.size}" fill="#ffffff"/>`);
  const label = (x, y, t, size = 2.2, anchor = 'middle') =>
    `<text x="${x}" y="${y}" font-family="IBM Plex Sans, Arial, sans-serif" font-size="${size}" fill="#555555" text-anchor="${anchor}">${t}</text>`;
  // Neutral and reference patches. The white patch is bare paper with a hairline outline.
  el.push(`<rect x="${C.white.cx - h}" y="${C.white.cy - h}" width="${p}" height="${p}" fill="#ffffff" stroke="#c8c8c8" stroke-width="0.15"/>`);
  el.push(`<rect x="${C.grey.cx - h}" y="${C.grey.cy - h}" width="${p}" height="${p}" fill="${C.grey.hex}"/>`);
  for (const r of C.refs) el.push(`<rect x="${r.cx - h}" y="${r.cy - h}" width="${p}" height="${p}" fill="${r.hex}"/>`);
  for (const q of [C.white, C.grey, ...C.refs]) el.push(label(q.cx, q.cy + h + 3, q.label));
  // Strip slot and pad targets.
  const s = C.slot;
  el.push(`<rect x="${s.x0}" y="${s.y0}" width="${s.x1 - s.x0}" height="${s.y1 - s.y0}" rx="1" fill="none" stroke="#9a9a9a" stroke-width="0.25" stroke-dasharray="1.5 1"/>`);
  for (const q of [C.control, C.test]) {
    el.push(`<rect x="${q.cx - h}" y="${q.cy - h}" width="${p}" height="${p}" fill="none" stroke="#5b3d82" stroke-width="0.3"/>`);
    el.push(label(q.cx, s.y0 - 1.6, q.label, 2.4));
  }
  el.push(label(C.caption.x, C.caption.y, C.caption.text, 2));
  return `<svg ${id ? `id="${id}" ` : ''}xmlns="http://www.w3.org/2000/svg" width="${C.width}mm" height="${C.height}mm" viewBox="0 0 ${C.width} ${C.height}" role="img" aria-label="Viora reference card">${el.join('')}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const clamp01 = v => Math.max(0, Math.min(1, v));
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Solve A x = b (n x n, row arrays) by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Homography from 4 source points to 4 destination points (DLT with h33 = 1). Returns 3x3 row-major array. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}
const applyH = (H, x, y) => {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
};

/** Mean luminance of a (2r+1)^2 box in the full-resolution image (clipped to the frame). */
function boxLum(img, cx, cy, r) {
  const { data, width: W, height: H } = img;
  const x0 = Math.max(0, Math.round(cx - r)), x1 = Math.min(W - 1, Math.round(cx + r));
  const y0 = Math.max(0, Math.round(cy - r)), y1 = Math.min(H - 1, Math.round(cy + r));
  if (x1 < x0 || y1 < y0) return NaN;
  let s = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { s += lum(data, (y * W + x) * 4); n++; }
  return s / n;
}

const median = a => { const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

const GRID_LONG = 400;          // long edge of the analysis grid
const ANCHOR_ASPECT = 102 / 62; // anchor rectangle aspect (111-9) / (71-9)
const MAX_CANDIDATES = 36;

/**
 * Find the reference card. Returns null when not confident, else
 * { corners: [[x,y] TL, TR, BR, BL] (fiducial centres in image px), toImage(mmX, mmY), score, H }.
 */
export function detectCard(img) {
  if (!img || !img.data || !img.width || !img.height) return null;
  const { data, width: W, height: H } = img;

  // 1. Downscaled luminance grid (box average). s = full-res px per grid px.
  const s = Math.max(1, Math.max(W, H) / GRID_LONG);
  const gw = Math.max(1, Math.floor(W / s)), gh = Math.max(1, Math.floor(H / s));
  const L = new Float32Array(gw * gh);
  {
    const sum = new Float64Array(gw * gh), cnt = new Uint32Array(gw * gh);
    // Subsample about 2 px per grid cell edge for speed on very large photos.
    const step = Math.max(1, Math.floor(s / 2));
    for (let y = 0; y < H; y += step) {
      const gy = Math.min(gh - 1, Math.floor(y / s)), row = gy * gw;
      for (let x = 0; x < W; x += step) {
        const gx = Math.min(gw - 1, Math.floor(x / s)), i = (y * W + x) * 4;
        sum[row + gx] += lum(data, i); cnt[row + gx]++;
      }
    }
    for (let i = 0; i < L.length; i++) L[i] = cnt[i] ? sum[i] / cnt[i] : 0;
  }

  // 2. Local mean via an integral image; a pixel is "dark" when well below its surroundings.
  const I = new Float64Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++) {
    let rs = 0;
    for (let x = 0; x < gw; x++) { rs += L[y * gw + x]; I[(y + 1) * (gw + 1) + x + 1] = I[y * (gw + 1) + x + 1] + rs; }
  }
  const r = Math.max(5, Math.round(Math.max(gw, gh) / 14));
  const localMean = (x, y) => {
    const x0 = Math.max(0, x - r), x1 = Math.min(gw, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(gh, y + r + 1);
    const S = I[y1 * (gw + 1) + x1] - I[y0 * (gw + 1) + x1] - I[y1 * (gw + 1) + x0] + I[y0 * (gw + 1) + x0];
    return S / ((x1 - x0) * (y1 - y0));
  };
  const hist = new Uint32Array(256);
  for (let i = 0; i < L.length; i++) hist[Math.min(255, L[i] | 0)]++;
  let acc = 0, p95 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= 0.95 * L.length) { p95 = v; break; } }

  const dark = new Uint8Array(gw * gh), lm = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x, m = localMean(x, y);
    lm[i] = m;
    if (m > 0.3 * p95 && L[i] < 0.52 * m) dark[i] = 1;
  }

  // 3. Connected components (4-connected) with moments.
  const lab = new Int32Array(gw * gh).fill(-1), stack = new Int32Array(gw * gh);
  const blobs = [];
  const minA = 10, maxA = (Math.max(gw, gh) / 5) ** 2;
  for (let i0 = 0; i0 < dark.length; i0++) {
    if (!dark[i0] || lab[i0] >= 0) continue;
    let sp = 0, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sl = 0, sm = 0;
    let bx0 = gw, by0 = gh, bx1 = 0, by1 = 0;
    stack[sp++] = i0; lab[i0] = blobs.length;
    while (sp) {
      const i = stack[--sp], x = i % gw, y = (i / gw) | 0;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sl += L[i]; sm += lm[i];
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      if (x > 0 && dark[i - 1] && lab[i - 1] < 0) { lab[i - 1] = blobs.length; stack[sp++] = i - 1; }
      if (x < gw - 1 && dark[i + 1] && lab[i + 1] < 0) { lab[i + 1] = blobs.length; stack[sp++] = i + 1; }
      if (y > 0 && dark[i - gw] && lab[i - gw] < 0) { lab[i - gw] = blobs.length; stack[sp++] = i - gw; }
      if (y < gh - 1 && dark[i + gw] && lab[i + gw] < 0) { lab[i + gw] = blobs.length; stack[sp++] = i + gw; }
    }
    const blob = { n, ok: false };
    blobs.push(blob);
    if (n < minA || n > maxA) continue;
    const cx = sx / n, cy = sy / n;
    const vxx = sxx / n - cx * cx + 1 / 12, vyy = syy / n - cy * cy + 1 / 12, vxy = sxy / n - cx * cy;
    const tr = vxx + vyy, det = vxx * vyy - vxy * vxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (l2 <= 0) continue;
    const elong = Math.sqrt(l1 / l2);                 // 1 for a square or disc
    const compact = 12 * Math.sqrt(det) / n;          // 1 for a solid square, ~1.4 with the key hole
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const fill = n / (bw * bh);
    if (elong > 1.9 || compact < 0.75 || compact > 1.75 || fill < 0.3) continue;
    Object.assign(blob, {
      ok: true, cx, cy, area: n, side: Math.sqrt(n), elong, compact,
      darkness: (sl / n) / (sm / n),                   // blob luminance relative to surroundings
      bbox: [bx0, by0, bx1, by1]
    });
  }
  let cand = blobs.filter(b => b.ok);
  cand.sort((a, b) => (a.darkness + 0.15 * (a.elong - 1)) - (b.darkness + 0.15 * (b.elong - 1)));
  cand = cand.slice(0, MAX_CANDIDATES).sort((a, b) => a.area - b.area);
  if (cand.length < 4) return null;

  // 4. Score every 4-blob combination on geometry; keep the best few for photometric checks.
  const top = [];
  const N = cand.length;
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    if (cand[b].area / cand[a].area > 4) break;
    for (let c = b + 1; c < N; c++) {
      if (cand[c].area / cand[a].area > 4) break;
      for (let d = c + 1; d < N; d++) {
        if (cand[d].area / cand[a].area > 4) break;
        const q = quadCost([cand[a], cand[b], cand[c], cand[d]]);
        if (!q) continue;
        if (top.length < 8 || q.cost < top[top.length - 1].cost) {
          top.push(q); top.sort((x, y) => x.cost - y.cost); if (top.length > 8) top.pop();
        }
      }
    }
  }
  if (!top.length) return null;

  // 5. Refine, orient and verify each geometric candidate at full resolution.
  let best = null;
  for (const q of top) {
    const res = verify(img, q, s);
    if (res && (!best || res.score > best.score)) best = res;
  }
  if (!best || best.score < 0.3) return null;
  const Hm = best.H;
  return { corners: best.corners, toImage: (x, y) => applyH(Hm, x, y), score: +best.score.toFixed(3), H: Hm };
}

/** Geometry cost of 4 blobs as the anchor rectangle under perspective; null if implausible. */
function quadCost(bl) {
  const mx = (bl[0].cx + bl[1].cx + bl[2].cx + bl[3].cx) / 4, my = (bl[0].cy + bl[1].cy + bl[2].cy + bl[3].cy) / 4;
  const o = bl.map(b => [Math.atan2(b.cy - my, b.cx - mx), b]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  const P = o.map(b => [b.cx, b.cy]);
  const d = i => Math.hypot(P[(i + 1) % 4][0] - P[i][0], P[(i + 1) % 4][1] - P[i][1]);
  const sides = [d(0), d(1), d(2), d(3)];
  // Convexity and corner angles.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4];
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const cr = v1[0] * v2[1] - v1[1] * v2[0];
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return null;
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
    if (Math.abs(cos) > 0.6) return null;
  }
  const opp1 = Math.max(sides[0], sides[2]) / Math.min(sides[0], sides[2]);
  const opp2 = Math.max(sides[1], sides[3]) / Math.min(sides[1], sides[3]);
  if (opp1 > 1.8 || opp2 > 1.8) return null;
  const A = (sides[0] + sides[2]) / 2, B = (sides[1] + sides[3]) / 2;
  const aspect = Math.max(A, B) / Math.min(A, B);
  if (aspect < 1.2 || aspect > 2.4) return null;
  const side = o.reduce((t, b) => t + b.side, 0) / 4;
  const scale = Math.max(A, B) / side;               // ~10.6 for the real card
  if (scale < 6.5 || scale > 17) return null;
  const areaRatio = Math.max(...o.map(b => b.area)) / Math.min(...o.map(b => b.area));
  const dk = o.reduce((t, b) => t + b.darkness, 0) / 4;
  const cost = 2 * Math.abs(Math.log(aspect / ANCHOR_ASPECT)) + Math.abs(Math.log(scale / 10.6))
    + 0.5 * Math.log(areaRatio) + Math.log(opp1) + Math.log(opp2) + 1.5 * dk;
  return { blobs: o, longFirst: A >= B, cost };
}

/**
 * Refine a blob centre at full resolution: centroid of dark pixels inside a circle of radius
 * 0.78 x fiducial side around the current estimate (the fiducial's corners sit at 0.71 x side, the
 * card edge at >= 0.9 x side, so the circle never reaches the background). Iterated twice.
 */
function refine(img, b, s) {
  if (b.refined) return b.refined;                 // blobs are shared between candidate quads
  const { data, width: W, height: H } = img;
  let c = [(b.cx + 0.5) * s - 0.5, (b.cy + 0.5) * s - 0.5];   // pixel centres at integer coordinates
  const rad = 0.78 * Math.sqrt(b.area) * s, r2 = rad * rad;
  const step = Math.max(1, Math.floor(rad / 35));
  const hist = new Uint32Array(256);
  for (let it = 0; it < 3; it++) {
    const x0 = Math.max(0, Math.floor(c[0] - rad)), x1 = Math.min(W - 1, Math.ceil(c[0] + rad));
    const y0 = Math.max(0, Math.floor(c[1] - rad)), y1 = Math.min(H - 1, Math.ceil(c[1] + rad));
    hist.fill(0);
    let total = 0;
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step)
      if ((x - c[0]) ** 2 + (y - c[1]) ** 2 <= r2) { hist[lum(data, (y * W + x) * 4) | 0]++; total++; }
    if (total < 9) break;
    // 5th and 95th luminance percentiles from the histogram.
    let acc = 0, lo = -1, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (lo < 0 && acc >= 0.05 * total) lo = v; if (acc >= 0.95 * total) { hi = v; break; } }
    const tLo = lo + 0.2 * (hi - lo), tHi = hi - 0.2 * (hi - lo);
    let sx = 0, sy = 0, n = 0;
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      if ((x - c[0]) ** 2 + (y - c[1]) ** 2 > r2) continue;
      // Soft weight across the edge gives sub-pixel accuracy on blurred edges; white noise weighs 0.
      const w = clamp01((tHi - lum(data, (y * W + x) * 4)) / Math.max(1, tHi - tLo));
      if (w > 0) { sx += w * x; sy += w * y; n += w; }
    }
    if (!n) break;
    const nc = [sx / n, sy / n];
    const moved = Math.hypot(nc[0] - c[0], nc[1] - c[1]);
    c = nc;
    if (moved < 0.2) break;
  }
  return (b.refined = c);
}

/** Orientation-key contrast of a fiducial: 1 = bright centre (key hole), 0 = solid. */
function keyContrast(img, c, sidePx) {
  const centre = boxLum(img, c[0], c[1], Math.max(1, 0.07 * sidePx));
  const body = [], out = [];
  const rb = Math.max(1, 0.06 * sidePx);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    body.push(boxLum(img, c[0] + dx * 0.36 * sidePx, c[1] + dy * 0.36 * sidePx, rb));
    out.push(boxLum(img, c[0] + dx * 0.9 * sidePx, c[1] + dy * 0.9 * sidePx, rb));
  }
  const bd = median(body), wh = median(out);
  if (!(wh - bd > 8)) return 0;
  return (centre - bd) / (wh - bd);
}

function verify(img, q, s) {
  const pts = q.blobs.map(b => refine(img, b, s));
  const sidePx = q.blobs.map(b => b.side * s);
  const kc = pts.map((p, i) => keyContrast(img, p, sidePx[i]));
  // Orientation: the key fiducial is TL; the quad is already ordered clockwise (y down).
  let ki = 0;
  for (let i = 1; i < 4; i++) if (kc[i] > kc[ki]) ki = i;
  const others = kc.filter((_, i) => i !== ki);
  const keyMargin = kc[ki] - Math.max(...others);
  const corners = [0, 1, 2, 3].map(j => pts[(ki + j) % 4]);
  const H = homography(CARD.anchors, corners);
  if (!H) return null;
  // The TL -> TR side must be a long side of the anchor rectangle.
  const longOk = (ki % 2 === 0) === q.longFirst;

  // Photometric verification: card-white points bright, fiducial bodies dark.
  const mmPx = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]) / 102;
  const rr = Math.max(1, 1.2 * mmPx);
  const bright = CARD.blankPoints.map(([x, y]) => { const p = applyH(H, x, y); return boxLum(img, p[0], p[1], rr); });
  const darkPts = [[111, 9], [111, 71], [9, 71], [6, 6], [12, 12]].map(([x, y]) => { const p = applyH(H, x, y); return boxLum(img, p[0], p[1], Math.max(1, 0.7 * mmPx)); });
  if (bright.some(v => isNaN(v)) || darkPts.some(v => isNaN(v))) return null;
  const bSorted = [...bright].sort((a, b) => a - b);
  const bLow = bSorted[1];                       // allow one blank point to be shadowed or covered
  const dHigh = Math.max(...darkPts);
  const contrast = (bLow - dHigh) / Math.max(1, median(bright));
  const evenness = bSorted[0] / Math.max(1, bSorted[bSorted.length - 1]);

  const score = clamp01(contrast / 0.45)
    * clamp01((kc[ki] - 0.1) / 0.3) * clamp01(keyMargin / 0.25)
    * (longOk ? 1 : 0.4)
    * Math.exp(-0.5 * q.cost)
    * (0.6 + 0.4 * clamp01(evenness / 0.6));
  return { corners, H, score, keyContrast: kc[ki], contrast };
}

// ---------------------------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------------------------

/** Sample a square region in card mm (centre cx,cy, half-size h) and return a glare-trimmed mean. */
function sampleRegion(img, det, cx, cy, h, trim = 0.15) {
  const { data, width: W, height: Hh } = img;
  const tl = det.toImage(CARD.anchors[0][0], CARD.anchors[0][1]), tr = det.toImage(CARD.anchors[1][0], CARD.anchors[1][1]);
  const mmPx = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) / 102;
  const n = Math.max(4, Math.min(48, Math.round(2 * h * mmPx)));     // about one sample per pixel, capped
  const px = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [x, y] = det.toImage(cx - h + (i + 0.5) * 2 * h / n, cy - h + (j + 0.5) * 2 * h / n);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= Hh) continue;
    const k = (yi * W + xi) * 4;
    px.push([data[k], data[k + 1], data[k + 2], lum(data, k)]);
  }
  if (!px.length) return { rgb: [NaN, NaN, NaN], sd: NaN };
  px.sort((a, b) => a[3] - b[3]);                 // trim by luminance: glare (top) and shadows/specks (bottom)
  const cut = Math.floor(px.length * trim);
  const keep = px.slice(cut, Math.max(cut + 1, px.length - cut));
  const rgb = [0, 1, 2].map(c => keep.reduce((t, p) => t + p[c], 0) / keep.length);
  const sd = Math.sqrt(keep.reduce((t, p) => t + (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2, 0) / keep.length);
  return { rgb, sd };
}

/** Raw camera RGB of every card region. test/control are { rgb, sd } (sd = RMS RGB distance). */
export function measureCard(img, det) {
  const hs = CARD.sampleSize / 2;
  const at = q => sampleRegion(img, det, q.cx, q.cy, hs);
  // Black: inside the three solid fiducials (TR, BR, BL), central 6 x 6 mm.
  const blacks = CARD.anchors.slice(1).map(([x, y]) => sampleRegion(img, det, x, y, 3, 0.2).rgb);
  const black = [0, 1, 2].map(c => median(blacks.map(b => b[c])));
  return {
    white: at(CARD.white).rgb,
    grey: at(CARD.grey).rgb,
    black,
    refs: CARD.refs.map(r => at(r).rgb),
    test: at(CARD.test),
    control: at(CARD.control)
  };
}

// ---------------------------------------------------------------------------------------------
// Colour correction
// ---------------------------------------------------------------------------------------------

const TARGET_BLACK = 30, TARGET_WHITE = 235;

/**
 * Per-channel linear map: measured black -> 30, measured white -> 235.
 * residual = chroma (max - min channel) of the corrected grey patch.
 * printerOk = every printed reference patch within CIE76 deltaE 18 of its intended hex.
 */
export function buildCorrection(meas) {
  const gain = [], off = [];
  for (let c = 0; c < 3; c++) {
    const span = Math.max(8, meas.white[c] - meas.black[c]);     // guard against a degenerate card read
    gain[c] = (TARGET_WHITE - TARGET_BLACK) / span;
    off[c] = TARGET_BLACK - meas.black[c] * gain[c];
  }
  const apply = rgb => [0, 1, 2].map(c => Math.max(0, Math.min(255, rgb[c] * gain[c] + off[c])));
  const g = apply(meas.grey);
  const residual = Math.max(...g) - Math.min(...g);
  const refErrors = meas.refs.map((r, i) => deltaE(rgbToLab(apply(r)), rgbToLab(hexToRgbLocal(CARD.refs[i].hex))));
  const printerOk = refErrors.every(e => e < 18);
  return { apply, residual, printerOk, gain, offset: off, refErrors };
}
const hexToRgbLocal = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

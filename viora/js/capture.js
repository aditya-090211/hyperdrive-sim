// Guided camera capture: live rear camera in a full-screen modal with a card-shaped guide,
// live checks (light, sharpness, card detected), a 30 s settle countdown that auto-captures the
// best frame, a manual capture button and a clear explanation when the camera is unavailable.
//
//   import { openCapture } from './capture.js';
//   const canvas = await openCapture();   // HTMLCanvasElement at full video resolution, or null

import { detectCard } from './card.js';

const COUNTDOWN_S = 30;      // strip colour needs about 30 s to settle
const BEST_WINDOW_S = 5;     // keep the best passing frame during the final seconds
const TICK_MS = 250;
const ANALYSE_LONG = 480;    // long edge of the downscaled frame used for live checks

const STYLE = `
.cap-modal{padding:0;align-items:stretch}
.cap-wrap{position:relative;display:flex;flex-direction:column;width:100%;height:100%;max-width:1100px;margin:0 auto;color:#fff}
.cap-stage{position:relative;flex:1;min-height:0;background:#000;overflow:hidden}
.cap-stage video,.cap-stage canvas{position:absolute;inset:0;width:100%;height:100%}
.cap-stage video{object-fit:contain}
.cap-count{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;
  font:600 clamp(72px,22vw,180px)/1 var(--serif);color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.6);font-variant-numeric:tabular-nums}
.cap-count.on{display:flex}
.cap-hint{position:absolute;left:0;right:0;top:0;padding:10px 14px;font-size:13.5px;background:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,0));text-align:center}
.cap-bar{padding:10px 14px calc(12px + env(safe-area-inset-bottom));background:#141218;display:flex;flex-direction:column;gap:10px}
.cap-checks{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.cap-check{font-size:12.5px;padding:4px 10px;border-radius:99px;border:1px solid #3a3446;color:#b9b2c4;display:inline-flex;align-items:center;gap:6px}
.cap-check::before{content:"";width:8px;height:8px;border-radius:50%;background:#6b6573}
.cap-check.ok{color:#fff;border-color:#7cc4a8}
.cap-check.ok::before{background:#7cc4a8}
.cap-check.bad{border-color:#e08b72}
.cap-check.bad::before{background:#e08b72}
.cap-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.cap-btns button{flex:1 1 auto;min-width:96px;justify-content:center}
.cap-msg{max-width:520px}
.cap-msg p{margin:10px 0}
@media (prefers-reduced-motion:no-preference){ .cap-check{transition:border-color .2s,color .2s} }
`;

function injectStyle() {
  if (document.getElementById('cap-style')) return;
  const s = document.createElement('style');
  s.id = 'cap-style';
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Explain why the live camera cannot start. */
function unavailableReason(err) {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!window.isSecureContext && !local)
    return 'The live camera only works on a secure page (https) or on localhost. This page was opened over plain http, so the browser blocks camera access.';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    return 'This browser does not support live camera access.';
  const n = err && err.name;
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return 'Camera permission was denied. Allow camera access for this site in your browser settings and try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError')
    return 'No camera was found on this device.';
  if (n === 'NotReadableError' || n === 'AbortError')
    return 'The camera is in use by another app or could not be started. Close other apps using the camera and try again.';
  return 'The camera could not be started' + (err && err.message ? ` (${err.message})` : '') + '.';
}

/** Mean luminance, clipped fraction and a Laplacian sharpness measure of a small RGBA frame. */
function frameStats(img) {
  const { data, width: W, height: H } = img;
  const L = new Float32Array(W * H);
  let sum = 0, sum2 = 0, clipped = 0;
  for (let i = 0, j = 0; i < L.length; i++, j += 4) {
    const v = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    L[i] = v; sum += v; sum2 += v * v;
    if (v > 250) clipped++;
  }
  const n = L.length, mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  let ls = 0, ls2 = 0, m = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const lap = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - W] - L[i + W];
    ls += lap; ls2 += lap * lap; m++;
  }
  const lapVar = m ? ls2 / m - (ls / m) ** 2 : 0;
  // Normalise by contrast so exposure changes do not read as focus changes.
  return { mean, clipped: clipped / n, sharp: Math.sqrt(Math.max(0, lapVar)) / (sd + 4) };
}

/**
 * Open the guided camera. Resolves with a full-resolution canvas, or null when cancelled or
 * when the camera is unavailable (after explaining why).
 */
export function openCapture() {
  injectStyle();
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const modal = document.createElement('div');
    modal.className = 'modal cap-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Guided camera');
    document.body.appendChild(modal);

    let stream = null, timer = null, done = false, keyHandler = null;

    function finish(result) {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      window.removeEventListener('resize', drawOverlay);
      modal.remove();
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
      resolve(result);
    }
    keyHandler = e => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', keyHandler);

    function showUnavailable(err) {
      modal.classList.remove('cap-modal');
      modal.innerHTML = `<div class="modal-inner cap-msg">
        <h2>Live camera unavailable</h2>
        <p>${unavailableReason(err)}</p>
        <p>You can still take a reading: close this and use the photo upload button. On a phone it opens the camera directly, so you can photograph the strip on the card and the analyser will do the rest.</p>
        <div class="row" style="justify-content:flex-end"><button class="primary" type="button" data-close>Close</button></div>
      </div>`;
      const b = modal.querySelector('[data-close]');
      b.addEventListener('click', () => finish(null));
      b.focus();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showUnavailable(null); return; }

    modal.innerHTML = `<div class="cap-wrap">
      <div class="cap-stage">
        <video playsinline muted autoplay></video>
        <canvas></canvas>
        <div class="cap-hint">Line the card up with the guide, camera directly above, in even daylight.</div>
        <div class="cap-count" aria-live="off"></div>
      </div>
      <div class="cap-bar">
        <div class="cap-checks" role="status" aria-live="polite">
          <span class="cap-check" data-k="light">Light</span>
          <span class="cap-check" data-k="sharp">Sharpness</span>
          <span class="cap-check" data-k="card">Card</span>
        </div>
        <div class="cap-btns">
          <button class="primary" type="button" data-act="wet">Strip is wet</button>
          <button type="button" data-act="now">Capture now</button>
          <button type="button" data-act="cancel">Cancel</button>
        </div>
      </div>
    </div>`;
    const video = modal.querySelector('video');
    const overlay = modal.querySelector('.cap-stage canvas');
    const countEl = modal.querySelector('.cap-count');
    const hintEl = modal.querySelector('.cap-hint');
    const wetBtn = modal.querySelector('[data-act="wet"]');
    const checkEls = Object.fromEntries([...modal.querySelectorAll('.cap-check')].map(e => [e.dataset.k, e]));
    modal.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
    modal.querySelector('[data-act="now"]').addEventListener('click', () => { if (video.videoWidth) finish(grabFull()); });

    const small = document.createElement('canvas');
    const sctx = small.getContext('2d', { willReadFrequently: true });
    let sharpMax = 0, lastQuad = null, countdownEnd = 0, best = null;

    function grabFull() {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      return c;
    }

    // Map a point in video pixels to overlay pixels (video uses object-fit: contain).
    function videoToOverlay(p) {
      const cw = overlay.width, ch = overlay.height, vw = video.videoWidth, vh = video.videoHeight;
      const k = Math.min(cw / vw, ch / vh);
      return [(cw - vw * k) / 2 + p[0] * k, (ch - vh * k) / 2 + p[1] * k];
    }

    function drawOverlay() {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(overlay.clientWidth * dpr), h = Math.round(overlay.clientHeight * dpr);
      if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
      const g = overlay.getContext('2d');
      g.clearRect(0, 0, w, h);
      if (!video.videoWidth) return;
      // Card-shaped (3:2) guide inside the visible video area.
      const tl = videoToOverlay([0, 0]), br = videoToOverlay([video.videoWidth, video.videoHeight]);
      const vw = br[0] - tl[0], vh = br[1] - tl[1];
      let gw = vw * 0.82, gh = gw / 1.5;
      if (gh > vh * 0.82) { gh = vh * 0.82; gw = gh * 1.5; }
      const gx = tl[0] + (vw - gw) / 2, gy = tl[1] + (vh - gh) / 2;
      g.lineWidth = 2 * dpr;
      g.setLineDash([10 * dpr, 8 * dpr]);
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.strokeRect(gx, gy, gw, gh);
      g.setLineDash([]);
      if (lastQuad) {
        const q = lastQuad.map(videoToOverlay);
        g.strokeStyle = '#7cc4a8';
        g.lineWidth = 3 * dpr;
        g.beginPath();
        q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath();
        g.stroke();
        // Mark the top-left (orientation key) corner.
        g.fillStyle = '#7cc4a8';
        g.beginPath(); g.arc(q[0][0], q[0][1], 5 * dpr, 0, Math.PI * 2); g.fill();
      }
    }

    function setCheck(k, ok, label) {
      const e = checkEls[k];
      e.classList.toggle('ok', ok === true);
      e.classList.toggle('bad', ok === false);
      e.textContent = label;
    }

    function tick() {
      if (done || !video.videoWidth) return;
      const vw = video.videoWidth, vh = video.videoHeight, k = ANALYSE_LONG / Math.max(vw, vh);
      small.width = Math.round(vw * k); small.height = Math.round(vh * k);
      sctx.drawImage(video, 0, 0, small.width, small.height);
      let img;
      try { img = sctx.getImageData(0, 0, small.width, small.height); } catch (e) { return; }
      const st = frameStats(img);
      sharpMax = Math.max(st.sharp, sharpMax * 0.995);
      const lightOk = st.mean > 60 && st.mean < 215 && st.clipped < 0.04;
      const sharpOk = st.sharp > 0.08 && st.sharp > 0.55 * sharpMax;
      let det = null;
      try { det = detectCard(img); } catch (e) { det = null; }
      if (det && det.score < 0.35) det = null;
      lastQuad = det ? det.corners.map(p => [p[0] / k, p[1] / k]) : null;
      setCheck('light', lightOk, lightOk ? 'Light good' : st.mean <= 60 ? 'Too dark' : 'Too bright');
      setCheck('sharp', sharpOk, sharpOk ? 'Sharp' : 'Hold still');
      setCheck('card', !!det, det ? 'Card found' : 'Card not found');
      drawOverlay();

      if (countdownEnd) {
        const left = (countdownEnd - performance.now()) / 1000;
        const all = lightOk && sharpOk && det;
        if (left <= BEST_WINDOW_S && all) {
          const q = det.score * Math.min(1, st.sharp / Math.max(1e-6, sharpMax));
          if (!best || q >= best.q) best = { q, canvas: grabFull() };
        }
        if (left <= 0) {
          if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* ignore */ }
          finish(best ? best.canvas : grabFull());
          return;
        }
        countEl.textContent = String(Math.ceil(left));
        hintEl.textContent = left <= BEST_WINDOW_S
          ? (all ? 'Capturing the best frame. Keep the camera still.' : 'Hold the card in view, steady and well lit.')
          : 'Waiting for the colour to settle. Keep the strip on the card.';
      }
    }

    wetBtn.addEventListener('click', () => {
      if (countdownEnd) {                              // second press cancels the countdown
        countdownEnd = 0; best = null;
        countEl.classList.remove('on');
        wetBtn.textContent = 'Strip is wet';
        hintEl.textContent = 'Line the card up with the guide, camera directly above, in even daylight.';
        return;
      }
      countdownEnd = performance.now() + COUNTDOWN_S * 1000;
      best = null;
      countEl.textContent = String(COUNTDOWN_S);
      countEl.classList.add('on');
      wetBtn.textContent = 'Stop countdown';
    });

    window.addEventListener('resize', drawOverlay, { passive: true });

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(s => {
      if (done) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      video.srcObject = s;
      const p = video.play();
      if (p && p.catch) p.catch(() => { /* autoplay with muted+playsinline normally succeeds */ });
      timer = setInterval(tick, TICK_MS);
      wetBtn.focus();
      if (reducedMotion()) countEl.style.textShadow = 'none';
    }).catch(err => { if (!done) showUnavailable(err); });
  });
}

// The landing page leaves its last rendered frame in sessionStorage before it navigates; the next page shows that
// frame while it loads, then fades into itself, so the move from the landing page reads as one continuous shot.
export function takeHandoff(dest) {
  try {
    const h = JSON.parse(sessionStorage.getItem('od.handoff') || 'null');
    sessionStorage.removeItem('od.handoff');
    if (h && h.dest === dest && Date.now() - h.at < 20000 && typeof h.img === 'string' && h.img.startsWith('data:image/jpeg;base64,')) return h.img;
  } catch { /* storage blocked or malformed: load normally */ }
  return null;
}

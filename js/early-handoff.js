// Runs in <head>, before the first paint. If the landing page just handed this page its last rendered frame, show
// that frame from the very first paint (js/handoff.js consumes it later), so the move between pages never flashes.
(function () {
  try {
    var h = JSON.parse(sessionStorage.getItem('od.handoff') || 'null');
    var dest = location.pathname.replace(/^\/|\.html$/g, '');
    if (!h || h.dest !== dest || Date.now() - h.at > 20000 || typeof h.img !== 'string' || h.img.indexOf('data:image/jpeg;base64,') !== 0) return;
    var root = document.documentElement;
    root.classList.add('handoff-in');
    root.style.setProperty('--handoff', 'url("' + h.img + '")');
  } catch (e) { /* storage blocked or malformed: load normally */ }
})();

// Runs before the landing page renders. Old simulator links (room invites, password resets) used to point at
// the site root; send them to /sim. A sign-in that came back to the root goes to the page that started it.
(function () {
  var q = location.search, h = location.hash;
  if (!q && !h) return;
  var p = new URLSearchParams(q);
  if (p.has('room') || p.get('reset') === '1') { location.replace('/sim' + q + h); return; }
  if (p.has('code') || p.has('error_description') || /access_token=|error_description=/.test(h)) {
    var to = '/scout';
    try { var r = localStorage.getItem('od.authReturn'); if (r === '/sim' || r === '/scout') to = r; } catch (e) { /* storage blocked */ }
    location.replace(to + q + h);
  }
})();

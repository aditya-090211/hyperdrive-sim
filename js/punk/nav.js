// OVERDRIVE 009 site bar (styles in css/punk-nav.css). Injected at the top of <body> on the content pages:
// home, /simulator, /about, /robot and Viora. The apps (/sim, /scout, /signin) keep their own chrome.
// Phones get logo + Scout + a Menu button; the menu is a disclosure that traps focus while open and closes on Esc.

const SPONSOR = '/about#sponsors';   // the sponsors card on /about (deep link, js/punk/cards-nav.js)

// [key, href, label, accessible name (must start with the label), phone-menu note]
const LINKS = [
  ['sim', '/sim', 'Play', 'Play the simulator', 'the HYPERDRIVE simulator'],
  ['robot', '/robot', 'Aryan', 'Aryan, our robot', 'our robot'],
  ['about', '/about', 'Team', 'Team: about us', 'who we are'],
  ['viora', '/viora/', 'Viora', 'Viora', 'our dehydration test strip'],
  ['sponsor', SPONSOR, 'Sponsor', 'Sponsor us', 'sponsors and contact'],
];

function here() {
  let p = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  if (p === '/') return { key: 'home', exact: true };
  if (p === '/viora') return { key: 'viora', exact: true };
  if (p.startsWith('/viora/')) return { key: 'viora', exact: false };
  const k = { '/robot': 'robot', '/about': 'about', '/scout': 'scout' }[p];
  return k ? { key: k, exact: true } : { key: null };
}

function el(tag, attrs, html) {
  const n = document.createElement(tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (html != null) n.innerHTML = html;
  return n;
}

function build() {
  if (document.querySelector('body > .sn')) return;
  const cur = here();
  const mark = (key) => (cur.key === key ? (cur.exact ? 'page' : 'true') : null);

  const nav = el('nav', { class: 'sn', 'aria-label': 'Site' });

  nav.appendChild(el('a', { class: 'sn-brand', href: '/', 'aria-label': 'Overdrive 009 home', 'aria-current': mark('home') },
    '<img src="/assets/punk/logo.png" alt="" width="38" height="38" decoding="async"><span aria-hidden="true">Overdrive <b>009</b></span>'));

  const right = el('div', { class: 'sn-right' });
  right.appendChild(el('a', { class: 'sn-scout', href: '/scout', 'aria-current': mark('scout') },
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M10 10l4.5 4.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/></svg>Scout'));

  const btn = el('button', { class: 'sn-menu', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sn-links' },
    '<i aria-hidden="true"></i><span>Menu</span>');
  const list = el('ul', { class: 'sn-links', id: 'sn-links' });
  LINKS.forEach(([key, href, label, name, note], i) => {
    const li = el('li', { class: key === 'sponsor' ? 'sn-sponsor' : null, style: '--i:' + i });
    li.appendChild(el('a', { href, 'aria-label': name, 'aria-current': mark(key) },
      '<span>' + label + '</span><small aria-hidden="true">' + note + '</small>'));
    list.appendChild(li);
  });
  right.appendChild(btn);
  right.appendChild(list);
  nav.appendChild(right);
  const scrim = el('div', { class: 'sn-scrim', 'aria-hidden': 'true' });
  nav.appendChild(scrim);

  document.body.prepend(nav);

  // ---- phone menu ----
  const phone = matchMedia('(max-width: 719px)');
  const isOpen = () => nav.classList.contains('open');
  function setOpen(open, refocus) {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.querySelector('span').textContent = open ? 'Close' : 'Menu';
    if (open) list.querySelector('a').focus();
    else if (refocus) btn.focus();
  }
  btn.addEventListener('click', () => setOpen(!isOpen(), false));
  scrim.addEventListener('click', () => setOpen(false, true));
  list.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false, false); });
  phone.addEventListener('change', () => { if (!phone.matches && isOpen()) setOpen(false, false); });
  document.addEventListener('click', (e) => { if (isOpen() && !nav.contains(e.target)) setOpen(false, false); });

  nav.addEventListener('keydown', (e) => {
    if (isOpen() && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false, true); return; }
    if (isOpen() && e.key === 'Tab') {
      // trap: the bar's own controls plus the open menu
      const f = [...nav.querySelectorAll('a[href], button')].filter((n) => n.offsetParent !== null);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    // the card decks turn pages on arrows, Space, PageUp/Down, Home and End from window listeners: not while in the bar
    if (/^(Arrow|Page)|^(Home|End| )$/.test(e.key)) e.stopPropagation();
  });
  // and swipe or wheel on the open menu must not flip the card behind it
  ['touchstart', 'touchend', 'wheel'].forEach((t) => nav.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
  // Esc while focus has wandered outside (e.g. clicked page text) still closes
  document.addEventListener('keydown', (e) => { if (isOpen() && e.key === 'Escape') setOpen(false, true); });
}

if (document.body) build();
else document.addEventListener('DOMContentLoaded', build, { once: true });

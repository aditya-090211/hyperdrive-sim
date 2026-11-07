// The shared Overdrive sign-in page (/signin?next=/sim|/scout|/). One email-and-password account for the simulator and
// Scout: sign in, create an account, or reset a password. A match plays at the venue behind the panel.
import { getClient, RETURN_PAGES } from './auth-client.js';
import { stacked } from './layout.js';

const $ = (s) => document.querySelector(s);
const qp = new URLSearchParams(location.search);
const next = RETURN_PAGES.includes(qp.get('next')) ? qp.get('next') : '/';
const err = $('#err');
const say = (m) => { err.textContent = m || ''; };
const friendly = (e) => {
  const m = (e && (e.message || String(e))) || 'Something went wrong';
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you, then sign in.';
  if (/already registered|already been registered|user already exists/i.test(m)) return 'That email already has an account. Sign in instead, or reset the password.';
  if (/password should be|weak password|at least/i.test(m)) return 'Choose a longer password: at least 8 characters.';
  if (/database error saving new user/i.test(m)) return 'Could not create the account. Try again in a moment.';
  if (/signups not allowed|signup is disabled/i.test(m)) return 'New accounts are switched off for this site right now.';
  if (/failed to fetch|network/i.test(m)) return 'Could not reach the server. Check your connection.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  return 'Sign-in did not complete. Please try again.';
};

// ----- the match in the background (desktop and capable phones; the still image stays underneath otherwise)
(async () => {
  try {
    // no throwaway WebGL probe (it costs as much as the real context); if WebGL fails, the still image stays
    if (!window.WebGL2RenderingContext || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const { createStadium } = await import('./stadium.js');
    const st = await createStadium($('#stage'), { mobile });
    const lens = () => {
      const w = window.innerWidth, h = window.innerHeight, cam = st.camera;
      st.shot.film = !stacked() ? -0.18 * cam.filmGauge * 2 * Math.tan(cam.fov * Math.PI / 360) * Math.min(w / h, 2.2) : 0;
      if (stacked()) { st.shot.height = 6.8; st.shot.radius = 11.5; st.shot.base = -2.55; }
    };
    lens(); window.addEventListener('resize', lens);
    st.start();
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('live')));
  } catch (e) { console.warn('stadium', e); }
})();

// ----- account
const client = getClient();
const show = (id) => { $('#signed-out').hidden = id !== 'out'; $('#signed-in').hidden = id !== 'in'; };
async function render() {
  // the form is there from the first paint; it only gives way if a saved session turns up
  show('out'); if (qp.get('mode') === 'signup') setMode('up');
  if (!client) { say('Sign-in could not load. Check your connection and reload.'); return; }
  if (qp.get('error') || qp.get('error_description')) say(friendly({ message: qp.get('error_description') || '' }));
  let user = null;
  try { const { data } = await Promise.race([client.auth.getSession(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 5000))]); user = data.session?.user || null; } catch { /* stay on the form */ }
  if (!user) return;
  // just came back from an email link (confirmation or reset): go where they were heading
  if (qp.has('code')) { location.replace(next); return; }
  show('in');
  const { data: prof } = await client.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  const name = prof?.display_name || user.user_metadata?.full_name || user.email || 'Signed in';
  $('#who-name').textContent = name;
  $('#who-email').textContent = user.email || '';
  const seg = (w) => (Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(w)].map((x) => x.segment) : [...w]);
  $('#who-initials').textContent = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => { const g = seg(w)[0] || ''; return g.length === 1 ? g.toUpperCase() : g; }).join('') || '?';
  const { data: mem } = await client.from('scout_members').select('role, scout_teams(number, name)').eq('user_id', user.id).maybeSingle();
  $('#who-team').textContent = mem?.scout_teams ? `Team ${mem.scout_teams.number} · ${mem.scout_teams.name}` : 'Not on an Overdrive Scout team yet.';
  const go = $('#go-next'); go.href = next; go.textContent = next === '/sim' ? 'Back to the simulator' : next === '/scout' ? 'Back to Scout' : 'Continue';
}

// ----- sign in / create account
let mode = 'in';
const form = $('#auth-form'), submit = $('#submit');
function setMode(m) {
  mode = m; say('');
  $('#tab-in').setAttribute('aria-selected', String(m === 'in')); $('#tab-in').setAttribute('aria-pressed', String(m === 'in'));
  $('#tab-up').setAttribute('aria-selected', String(m === 'up')); $('#tab-up').setAttribute('aria-pressed', String(m === 'up'));
  $('.mode-seg').style.setProperty('--i', m === 'up' ? '1' : '0');
  $('#name-fld').hidden = m !== 'up'; $('#pw-help').hidden = m !== 'up'; $('#forgot').hidden = m === 'up';
  $('#pw').autocomplete = m === 'up' ? 'new-password' : 'current-password';
  submit.textContent = m === 'up' ? 'Create account' : 'Sign in';
  (m === 'up' ? $('#nm') : $('#em')).focus();
}
$('#tab-in').addEventListener('click', () => setMode('in'));
$('#tab-up').addEventListener('click', () => setMode('up'));
$('#pw-eye').addEventListener('click', (e) => {
  const on = $('#pw').type === 'password'; $('#pw').type = on ? 'text' : 'password';
  e.currentTarget.textContent = on ? 'Hide' : 'Show'; e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.setAttribute('aria-label', on ? 'Hide password' : 'Show password');
});
form.addEventListener('submit', async (e) => {
  e.preventDefault(); say('');
  const email = $('#em').value.trim(), password = $('#pw').value, name = $('#nm').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Enter a valid email address.'); $('#em').focus(); return; }
  if (password.length < (mode === 'up' ? 8 : 1)) { say(mode === 'up' ? 'Choose a password of at least 8 characters.' : 'Enter your password.'); $('#pw').focus(); return; }
  if (mode === 'up' && name.length < 2) { say('Enter your name, as your team will see it.'); $('#nm').focus(); return; }
  submit.disabled = true;
  try {
    if (mode === 'in') {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.replace(next);
    } else {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${location.origin}/signin?next=${encodeURIComponent(next)}`, data: { display_name: name.slice(0, 32) } },
      });
      if (error) throw error;
      // with email confirmation on there is no session yet; an existing address comes back with no identities
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) { say('That email already has an account. Sign in instead, or reset the password.'); setMode('in'); $('#em').value = email; submit.disabled = false; return; }
      if (data.session) { location.replace(next); return; }
      say(`Check ${email} for a link to confirm your account, then sign in here.`);
      setMode('in'); $('#em').value = email; $('#pw').value = '';
      submit.disabled = false;
    }
  } catch (x) { say(friendly(x)); submit.disabled = false; }
});
$('#forgot').addEventListener('click', async () => {
  const email = $('#em').value.trim();
  if (!email) { say('Enter your email first, then press Forgot your password.'); $('#em').focus(); return; }
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/sim?reset=1` });
    if (error) throw error;
    say('If that email has an account, a reset link is on its way. Open it in this browser.');
  } catch (x) { say(friendly(x)); }
});
$('#signout').addEventListener('click', async () => {
  try { await client.auth.signOut(); } catch { /* signed out locally */ }
  // Scout's cached team data and drafts leave with the account (reports still waiting to sync and pick lists stay)
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('od.scout.') && k !== 'od.scout.queue' && !k.startsWith('od.scout.picks.')) localStorage.removeItem(k); } catch { /* storage blocked */ }
  location.reload();
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => render()); else render();

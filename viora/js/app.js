import { store } from './store.js';

const ROUTES=['home','check','today','trends','study','model','team','settings'];
const view=document.getElementById('view');
let unmount=null, current=null;

function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'), 2600);
}
const navigate=hash=>{ location.hash=hash; };
const ctx={ store, navigate, toast };

async function route(){
  const name=(location.hash.replace('#','').split('?')[0]) || 'home';
  const r=ROUTES.includes(name) ? name : 'home';
  if(r===current && view.childElementCount) return;
  current=r;
  document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('on', a.getAttribute('href')==='#'+r));
  if(typeof unmount==='function'){ try{ unmount(); }catch(e){ console.error(e); } }
  unmount=null;
  document.body.dataset.route=r;
  view.innerHTML='';
  const el=document.createElement('div');
  view.appendChild(el);
  try{
    const mod=await import(`./views/${r}.js`);
    if(current!==r) return;
    unmount=await mod.mount(el, ctx);
  }catch(e){
    console.error(e);
    el.innerHTML=`<div class="card" style="margin-top:22px"><h2>This page failed to load</h2><p class="sub">${String(e.message||e).replace(/</g,'&lt;')}</p></div>`;
  }
  window.scrollTo(0,0);
}

async function renderProfiles(){
  const sel=document.getElementById('profileSel');
  const active=await store.activeProfile();
  const list=await store.profiles.list();
  sel.innerHTML=list.map(p=>`<option value="${p.id}"${p.id===active.id?' selected':''}>${p.name.replace(/</g,'&lt;')}</option>`).join('');
}
document.getElementById('profileSel').onchange=e=>{
  store.setActiveProfile(e.target.value);
  // re-mount current view so it picks up the new profile
  const c=current; current=null; if(c) route();
};
store.on('change', ({kind})=>{ if(kind==='profiles') renderProfiles(); });

window.addEventListener('hashchange', route);
renderProfiles().then(route);

// Background helpers owned by other modules; they are optional so failures never block the app.
import('./sync.js').then(m=>m.startSync && m.startSync()).catch(()=>{});
import('./views/today.js').then(m=>m.startReminders && m.startReminders(ctx)).catch(()=>{});

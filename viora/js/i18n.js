// Interface translation (English, Hindi, Marathi) applied to the rendered DOM.
// Views are written in English. This module watches the page and swaps each piece of text for its
// translation from i18n/<lang>.json, keeping inline markup (links, bold) and restoring English on demand.
//
// Keys: a "unit" is an element whose content is text plus inline elements only. Its key is the text
// with inline elements replaced by numbered tags, e.g. 'Take a reading on the <0>Check</0> page.'
// If no exact match exists, numbers are replaced by {0}, {1}... and the template is looked up instead.

export const LANGS = { en:'English', hi:'हिन्दी', mr:'मराठी' };
const INLINE = new Set(['A','STRONG','EM','B','I','SPAN','CODE','BR','SMALL','SUB','SUP','ABBR','TIME','MARK','U','S','KBD']);
const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','CANVAS','VIDEO','svg:defs']);
const ATTRS = ['placeholder','aria-label','title','alt'];
const NUM = /\d+(?:[.,:]\d+)*/g;

let lang = 'en', dict = null, observer = null, busy = false;
const orig = new WeakMap();      // element|textNode -> { key, nodes|text, out }
const attrOrig = new WeakMap();  // element -> { attr: original }
const collecting = (()=>{ try{ return localStorage.getItem('hs_i18n_collect')==='1'; }catch(e){ return false; } })();
// developer-only: when collecting, every key seen is kept across page loads for building translation files
const collect = new Set(collecting ? JSON.parse(localStorage.getItem('hs_i18n_keys')||'[]') : []);
let saveT=0;
const remember = k => { const n=collect.size; collect.add(k); if(collect.size!==n && !saveT) saveT=setTimeout(()=>{ saveT=0; try{ localStorage.setItem('hs_i18n_keys', JSON.stringify([...collect])); }catch(e){} }, 300); };

const norm = s => s.replace(/\s+/g,' ').trim();
const hasWords = s => /[A-Za-z]{2,}/.test(s) && !/^#[0-9a-f]{3,8}$/i.test(s);
// numbers become {0},{1}... but the numbered inline-markup markers (<0>, </0>, <0/>) are left alone
const TAG = /(<\/?\d+\/?>)/;
const template = s => { let i=0; const vals=[];
  const t=s.split(TAG).map(p=>TAG.test(p) ? p : p.replace(NUM, m=>{ vals.push(m); return `{${i++}}`; })).join('');
  return { t, vals }; };

export function getLang(){ try{ return localStorage.getItem('hs_lang') || 'en'; }catch(e){ return 'en'; } }

// Translate a plain string (used for confirm/alert and by modules that want it).
export function t(s){
  if(!dict || lang==='en' || !s) return s;
  const n=norm(String(s));
  if(dict[n]) return dict[n];
  const { t:tp, vals }=template(n);
  if(tp!==n && dict[tp]) return dict[tp].replace(/\{(\d+)\}/g,(m,i)=>vals[+i] ?? m);
  return s;
}
function lookup(key){
  if(collecting && hasWords(key)){ const tp=template(key).t; remember(tp!==key ? tp : key); }
  if(!dict || lang==='en') return null;
  if(dict[key]) return dict[key];
  const { t:tp, vals }=template(key);
  if(tp!==key && dict[tp]) return dict[tp].replace(/\{(\d+)\}/g,(m,i)=>vals[+i] ?? m);
  if(collecting) console.debug('[i18n] missing', key);
  return null;
}

// ---- serialise a unit to a key and rebuild it from a translated key
function serialise(el, parts){
  let out='';
  for(const n of el.childNodes){
    if(n.nodeType===3) out+=n.nodeValue.replace(/[<>]/g,c=>c==='<'?'‹':'›');
    else if(n.nodeType===1){
      const i=parts.length; parts.push(n);
      if(n.tagName==='BR') out+=`<${i}/>`;
      else out+=`<${i}>${serialise(n, parts)}</${i}>`;
    }
  }
  return out;
}
function rebuild(str, parts){
  const frag=document.createDocumentFragment();
  const stack=[frag];
  const re=/<(\d+)\/>|<(\d+)>|<\/(\d+)>|([^<]+|<)/g; let m;
  while((m=re.exec(str))){
    const top=stack[stack.length-1];
    if(m[1]!==undefined){ const p=parts[+m[1]]; top.appendChild(p?p.cloneNode(false):document.createElement('br')); }
    else if(m[2]!==undefined){ const p=parts[+m[2]]; const e=p?p.cloneNode(false):document.createElement('span'); top.appendChild(e); stack.push(e); }
    else if(m[3]!==undefined){ if(stack.length>1) stack.pop(); }
    else top.appendChild(document.createTextNode(m[4].replace(/[‹›]/g,c=>c==='‹'?'<':'>')));
  }
  return frag;
}

function isUnit(el){
  let text=false;
  for(const n of el.childNodes){
    if(n.nodeType===3){ if(n.nodeValue.trim()) text=true; }
    else if(n.nodeType===1){
      if(!INLINE.has(n.tagName) || n.hasAttribute('translate') || n.id) return false;
      for(const d of n.querySelectorAll('*')) if(!INLINE.has(d.tagName)) return false;
    }
  }
  return text;
}
const skipped = el => el.closest('[translate="no"],[contenteditable="true"],code,pre');

function translateUnit(el){
  const rec=orig.get(el);
  if(rec && rec.out===el.innerHTML && rec.lang===lang) return;
  let parts, key, nodes;
  if(rec && (rec.out===el.innerHTML)){ parts=rec.parts; key=rec.key; nodes=rec.nodes; }
  else{
    parts=[]; key=norm(serialise(el, parts));
    nodes=[...el.childNodes].map(n=>n.cloneNode(true));
  }
  if(!hasWords(key)){ orig.delete(el); return; }
  const tr=lookup(key);
  if(tr){ el.replaceChildren(rebuild(tr, parts)); }
  else if(rec && rec.out===el.innerHTML){ el.replaceChildren(...nodes.map(n=>n.cloneNode(true))); }
  orig.set(el,{ key, parts, nodes, out:el.innerHTML, lang });
}
function translateText(node){
  const rec=orig.get(node);
  if(rec && rec.out===node.nodeValue && rec.lang===lang) return;
  const src=(rec && rec.out===node.nodeValue) ? rec.text : node.nodeValue;
  const key=norm(src); if(!hasWords(key)) return;
  const tr=lookup(key);
  const lead=src.match(/^\s*/)[0], trail=src.match(/\s*$/)[0];
  node.nodeValue = tr ? lead+tr+trail : src;
  orig.set(node,{ text:src, out:node.nodeValue, lang });
}
function translateAttrs(el){
  for(const a of ATTRS){
    if(!el.hasAttribute(a)) continue;
    const store=attrOrig.get(el)||{};
    const cur=el.getAttribute(a);
    const rec=store[a];
    const src=(rec && rec.out===cur) ? rec.src : cur;
    const tr=hasWords(src) ? lookup(norm(src)) : null;
    const out=tr||src;
    if(out!==cur) el.setAttribute(a,out);
    store[a]={ src, out }; attrOrig.set(el,store);
  }
}

function walk(root){
  if(root.nodeType===3){ if(root.parentElement && !skipped(root.parentElement)) translateText(root); return; }
  if(root.nodeType!==1 || skipped(root)) return;
  translateAttrs(root);                       // inputs have no text, but their placeholder and label do
  if(SKIP.has(root.tagName)) return;
  if(isUnit(root)){ translateUnit(root); return; }
  for(const n of [...root.childNodes]){
    if(n.nodeType===3){ if(n.nodeValue.trim()) translateText(n); }
    else walk(n);
  }
}

function apply(root=document.body){
  if(busy) return;
  busy=true; observer && observer.disconnect();
  try{
    walk(root);
    if(root===document.body){
      if(!document.documentElement.dataset.title) document.documentElement.dataset.title=document.title;
      const tt=lookup(norm(document.documentElement.dataset.title));
      document.title=tt||document.documentElement.dataset.title;
    }
  } finally {
    busy=false; observe();
  }
}
let pending=new Set(), raf=0;
function observe(){
  if(!observer) observer=new MutationObserver(ms=>{
    for(const m of ms){
      let n=m.type==='characterData' ? m.target : m.target;
      if(n.nodeType===3) n=n.parentElement||n;
      pending.add(n);
    }
    if(!raf) raf=setTimeout(()=>{ raf=0; const list=[...pending]; pending.clear();
      // translate the nearest unit ancestor so sentences stay whole
      for(let el of list){ if(!el.isConnected) continue; let u=el; while(u.parentElement && u.parentElement!==document.body && isUnit(u.parentElement)) u=u.parentElement; apply(u); }
    }, 0);
  });
  observer.observe(document.body,{ childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:ATTRS });
}

async function loadDict(l){
  if(l==='en') return null;
  try{ const r=await fetch(`i18n/${l}.json`,{cache:'no-cache'}); if(!r.ok) throw new Error(r.status); const j=await r.json(); return j.strings||j; }
  catch(e){ console.warn('translation file missing for', l, e); return null; }
}

export async function setLang(l){
  if(!LANGS[l]) l='en';
  try{ localStorage.setItem('hs_lang', l); }catch(e){}
  lang=l; dict=await loadDict(l);
  document.documentElement.lang = l==='en' ? 'en' : l;
  document.querySelectorAll('select.lang-sel').forEach(s=>s.value=l);
  apply(document.body);
  window.dispatchEvent(new CustomEvent('langchange',{ detail:l }));
}

function injectSwitcher(){
  const header=document.querySelector('header.top'); if(!header || header.querySelector('.lang-sel')) return;
  const sel=document.createElement('select');
  sel.className='lang-sel'; sel.setAttribute('aria-label','Language'); sel.setAttribute('translate','no');
  sel.innerHTML=Object.entries(LANGS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  sel.value=getLang();
  sel.onchange=()=>setLang(sel.value);
  const pill=header.querySelector('.profile-pill');
  const wrap=document.createElement('div'); wrap.style.cssText='display:flex;gap:10px;align-items:center';
  if(pill){ pill.replaceWith(wrap); wrap.append(sel, pill); } else header.appendChild(sel);
}

// confirm / alert dialogs are not part of the DOM, so translate their messages here
const _confirm=window.confirm.bind(window), _alert=window.alert.bind(window);
window.confirm=m=>_confirm(t(m)); window.alert=m=>_alert(t(m));

window.__i18n={ dump:()=>[...collect].sort(), count:()=>collect.size, setLang, t, apply };

injectSwitcher();
setLang(getLang());

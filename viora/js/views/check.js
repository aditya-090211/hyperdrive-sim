import { analyzeCanvas, drawMarker } from '../analyze.js';
import { bandFor, BANDS } from '../color.js';
import { TAGS, computeBaseline, compareToBaseline, explainReading } from '../insights.js';

const SAMPLES=[
  ['assets/sample-dehydrated.jpg','10-12 h no water'],
  ['assets/sample-after-water.jpg','After water'],
  ['assets/sample-normal.jpg','1-3 h no water']
];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const wait=ms=>new Promise(r=>setTimeout(r,ms));

export async function mount(el, { store, toast, navigate }){
  el.innerHTML=`
  <div class="page-head">
    <h1>Saliva Hydration Check</h1>
    <p>Photograph your test strip on the reference card after it has touched saliva. The analyser corrects the colour against the card, compares the test pad with the dry control pad and tells you how hydrated you are.</p>
  </div>
  <div class="grid2">
    <div class="card">
      <h2>1. Photo</h2>
      <p class="sub">Best results: strip on the printed <a href="card">reference card</a>, daylight, camera directly above, 30 seconds after wetting.</p>
      <div id="drop" style="border:1.5px dashed var(--line);border-radius:12px;min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:22px;cursor:pointer">
        <div style="font-family:var(--serif);font-size:19px;margin-bottom:6px">Drop a photo here</div>
        <div class="sub" style="margin:0">or use one of the options below</div>
        <div class="row" style="justify-content:center;margin-top:16px">
          <button class="primary" id="guided">Guided camera</button>
          <button id="pick">Upload photo</button>
          <button id="snap">Phone camera</button>
        </div>
        <div class="row" style="justify-content:center;margin-top:18px" id="samples">
          ${SAMPLES.map(([src,l])=>`<button class="small" data-src="${src}" style="flex-direction:column;padding:4px;color:var(--muted)"><img src="${src}" alt="" style="width:48px;height:58px;object-fit:cover;border-radius:6px;display:block">${l}</button>`).join('')}
        </div>
        <div class="sub" style="margin:8px 0 0">Or try a sample from the lab trial</div>
      </div>
      <input type="file" id="file" accept="image/*" hidden>
      <input type="file" id="cam" accept="image/*" capture="environment" hidden>
      <div id="stage" style="display:none">
        <canvas id="cv" style="max-width:100%;max-height:440px;width:auto;height:auto;margin:0 auto;display:block;border-radius:10px;cursor:crosshair;background:#000"></canvas>
        <div class="row" style="justify-content:space-between;margin-top:10px">
          <span class="sub" style="margin:0">Tap the test pad to re-sample a different spot.</span>
          <button id="reset" class="small">New photo</button>
        </div>
      </div>
    </div>

    <div class="card" id="panel">
      <h2>2. Result</h2>
      <div id="idle">
        <p class="sub">Waiting for a photo.</p>
        <ol style="padding-left:18px;margin:0;color:var(--muted)">
          <li>Avoid food, drink and brushing teeth for 30 minutes.</li>
          <li>Touch only the right-hand (test) pad to your tongue for 5 seconds.</li>
          <li>Lay the strip on the card, dry pad on the left outline.</li>
          <li>Open Guided camera and press "Strip is wet". It captures automatically after 30 seconds.</li>
        </ol>
      </div>
      <div id="working" style="display:none">
        <p class="sub">Analysing photo</p>
        <ul class="steps" id="steps">
          <li><span class="s"></span>Looking for the reference card</li>
          <li><span class="s"></span>Correcting colour against the card</li>
          <li><span class="s"></span>Measuring test and control pads</li>
          <li><span class="s"></span>Matching against calibration curve</li>
          <li><span class="s"></span>Comparing with your baseline</li>
        </ul>
      </div>
      <div id="result" style="display:none"></div>
    </div>
  </div>`;

  const $=s=>el.querySelector(s);
  const cv=$('#cv'), ctx2=cv.getContext('2d');
  let srcCanvas=null, res=null, savedId=null, busy=false, source='upload';
  let draft={ tags:[], baseline:false, labels:{ hoursSinceDrink:null, weightKg:null, urineColour:null, notes:'' } };
  const profile=await store.activeProfile();
  let model=null, modelMod=null;
  try{ modelMod=await import('../model.js'); model=modelMod.loadModel(); }catch(e){ /* model module optional */ }

  const show=w=>['idle','working','result'].forEach(k=>$('#'+k).style.display=k===w?'block':'none');

  $('#pick').onclick=e=>{ e.stopPropagation(); $('#file').click(); };
  $('#snap').onclick=e=>{ e.stopPropagation(); $('#cam').click(); };
  $('#guided').onclick=async e=>{
    e.stopPropagation();
    try{
      const { openCapture }=await import('../capture.js');
      const c=await openCapture();
      if(c){ source='camera'; useCanvas(c); }
    }catch(err){ console.error(err); toast('Camera module failed to load. Use Upload photo instead.'); }
  };
  $('#drop').onclick=()=>$('#file').click();
  el.querySelectorAll('#samples button').forEach(b=>b.onclick=e=>{ e.stopPropagation(); source='sample'; loadSrc(b.dataset.src); });
  const onFile=e=>{ const f=e.target.files[0]; if(f){ source='upload'; loadFile(f); } };
  $('#file').onchange=onFile; $('#cam').onchange=onFile;
  const drop=$('#drop');
  ['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault(); drop.style.borderColor='var(--accent)';}));
  ['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault(); drop.style.borderColor='';}));
  drop.addEventListener('drop',e=>{ const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith('image/')){ source='upload'; loadFile(f); } });
  $('#reset').onclick=reset;

  function loadFile(f){ const r=new FileReader(); r.onload=()=>loadSrc(r.result); r.readAsDataURL(f); }
  function loadSrc(src){
    const im=new Image();
    im.onload=()=>{ const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight; c.getContext('2d').drawImage(im,0,0); useCanvas(c); };
    im.onerror=()=>toast('That file could not be opened as an image.');
    im.src=src;
  }
  let dispScale=1;
  function paint(marker){
    dispScale=Math.min(1, 900/Math.max(srcCanvas.width, srcCanvas.height));
    cv.width=Math.round(srcCanvas.width*dispScale); cv.height=Math.round(srcCanvas.height*dispScale);
    ctx2.drawImage(srcCanvas,0,0,cv.width,cv.height);
    if(marker) drawMarker(ctx2, marker, dispScale);
  }
  function useCanvas(c){
    srcCanvas=c; savedId=null;
    draft={ tags:[], baseline:false, labels:{ hoursSinceDrink:null, weightKg:null, urineColour:null, notes:'' } };
    drop.style.display='none'; $('#stage').style.display='block';
    paint(null); run(null);
  }
  function reset(){
    srcCanvas=null; res=null; savedId=null;
    drop.style.display='flex'; $('#stage').style.display='none';
    $('#file').value=''; $('#cam').value='';
    show('idle');
  }
  cv.addEventListener('click',e=>{
    if(!srcCanvas||busy) return;
    const r=cv.getBoundingClientRect();
    run({ x:(e.clientX-r.left)*cv.width/r.width/dispScale, y:(e.clientY-r.top)*cv.height/r.height/dispScale });
  });

  async function run(point){
    busy=true; show('working'); savedId=null;
    const lis=[...el.querySelectorAll('#steps li')]; lis.forEach(li=>li.className='');
    const fast=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const job=analyzeCanvas(srcCanvas,{point});
    for(let i=0;i<lis.length;i++){
      lis[i].className='run';
      await wait(fast?40:220+Math.random()*180);
      if(i===0) await job;
      lis[i].className='done';
    }
    res=await job; busy=false;
    paint(res.marker);
    render();
  }

  async function baselineNow(){
    const list=await store.readings.list({profileId:profile.id});
    return computeBaseline(list.filter(r=>r.id!==savedId));
  }

  async function render(){
    show('result');
    const R=$('#result');
    if(res.error){
      R.innerHTML=`<div class="flag">${esc(res.error)}</div><p class="note">Retake the photo with the strip centred and in focus, or tap the pad in the image to sample it manually.</p>`;
      return;
    }
    const band=bandFor(res.score);
    const base=await baselineNow();
    const cmp=compareToBaseline(res, base);
    const reading={...res, tags:draft.tags};
    const why=explainReading(reading, base);
    let pred=null;
    if(model && modelMod){ try{ pred=modelMod.predict(model, reading); }catch(e){ console.warn(e); } }
    const settings=store.settings();

    R.innerHTML=`
      ${res.flags.length?`<div class="flag" style="margin-bottom:12px">${res.flags.map(esc).join(' ')}</div>`:''}
      <div class="row" style="gap:16px;flex-wrap:nowrap;margin:4px 0 16px">
        <div style="width:64px;height:64px;border-radius:12px;border:1px solid var(--line);flex:none;background:${res.test.hex}"></div>
        <div>
          <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Hydration status</div>
          <div style="font-family:var(--serif);font-size:30px;line-height:1.1">${band.name}</div>
        </div>
      </div>
      <div style="height:12px;border-radius:99px;position:relative;background:linear-gradient(90deg,#9a5f93,#7d5b8f 35%,#6c6aa0 70%,#5f78ab)">
        ${base?`<div title="Your baseline" style="position:absolute;top:0;bottom:0;left:${Math.max(0,base.meanScore-base.sdScore)}%;width:${Math.min(100,2*base.sdScore)}%;background:rgba(255,255,255,.35);border-radius:99px"></div>`:''}
        <div style="position:absolute;top:-6px;width:4px;height:24px;background:var(--ink);border-radius:2px;transform:translateX(-50%);left:${res.score}%"></div>
      </div>
      <div class="row" style="justify-content:space-between;font-size:12px;color:var(--muted);margin-top:6px"><span>Dehydrated</span>${base?'<span>shaded: your normal range</span>':''}<span>Well hydrated</span></div>
      <div class="stats" style="grid-template-columns:repeat(2,1fr)">
        <div class="stat"><div class="k">Score</div><div class="v">${res.score}/100</div></div>
        <div class="stat"><div class="k">Est. saliva pH</div><div class="v">${res.ph.toFixed(1)}</div></div>
        <div class="stat"><div class="k">Confidence</div><div class="v">${res.conf}%</div></div>
        <div class="stat"><div class="k">Method</div><div class="v" style="font-size:15px;padding-top:4px">${res.mode==='card'?'Reference card':res.correction.method==='whitebalance'?'Free photo, auto light':'Free photo'}</div></div>
      </div>
      ${cmp?`<p class="note"><strong>Your baseline.</strong> ${esc(cmp.text)}</p>`:`<p class="sub">No personal baseline yet. Tick "Baseline reading" on ${3-(base?.n||0)>0?'at least 3':'more'} morning readings to compare against your own normal.</p>`}
      ${pred?`<p class="note"><strong>Learned model.</strong> Predicts <strong>${esc(pred.cls)}</strong> (${Math.round((pred.probs[pred.cls]||0)*100)}% probability), trained on ${model.n} of your labelled readings.</p>`:''}
      <p class="note">${esc(band.advice)}</p>
      ${why.map(t=>`<p class="note" style="border-color:var(--warn)">${esc(t)}</p>`).join('')}
      ${res.control?`
        <h3 style="margin-top:16px">Control pad comparison</h3>
        <div class="row" style="font-size:13.5px;margin:6px 0 2px">
          <span class="swatch-sm" style="background:${res.control.hex}"></span> Dry control
          <span class="swatch-sm" style="background:${res.test.hex};margin-left:10px"></span> Test
          <span style="color:var(--muted);margin-left:auto">hue shift ${res.hueShift>0?'+':''}${res.hueShift} deg</span>
        </div>
        <p class="sub" style="margin:0">Scoring uses the test colour adjusted for how far this strip's dry pad differs from a standard dry pad.</p>`:''}
      <h3 style="margin-top:16px">Closest lab references</h3>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        ${res.nearest.map((n,i)=>`<div class="row" style="font-size:13.5px;flex-wrap:nowrap"><span class="swatch-sm" style="background:${n.ref.hex};width:20px;height:20px"></span><span style="flex:1;${i?'':'font-weight:600'}">${esc(n.ref.name)}</span><span style="color:var(--muted)">${Math.max(0,Math.round(100-n.d*2))}% match</span></div>`).join('')}
      </div>
      <h3 style="margin-top:18px">Context</h3>
      <p class="sub" style="margin-bottom:8px">Tag anything that could affect this reading.</p>
      <div class="chips" id="tags">${TAGS.map(t=>`<button class="chip${draft.tags.includes(t.id)?' on':''}" data-tag="${t.id}">${t.label}</button>`).join('')}</div>
      <label class="switch" style="margin-top:14px"><input type="checkbox" id="baseline" ${draft.baseline?'checked':''}> Baseline reading (morning, before eating or drinking)</label>
      ${settings.studyMode?`<h3 style="margin-top:18px">Study labels</h3><p class="sub" style="margin-bottom:8px">Record an independent measure so the strip can be validated.</p><div id="labels"></div>`:''}
      <div class="row" style="margin-top:18px">
        <button class="primary" id="save">${savedId?'Saved':'Save reading'}</button>
        <button id="again">Check another</button>
        ${savedId?'<button id="toTrends" class="small">View trends</button>':''}
      </div>`;

    R.querySelectorAll('#tags .chip').forEach(c=>c.onclick=()=>{
      const id=c.dataset.tag;
      draft.tags=draft.tags.includes(id)?draft.tags.filter(x=>x!==id):[...draft.tags,id];
      persist(); render();
    });
    R.querySelector('#baseline').onchange=e=>{ draft.baseline=e.target.checked; persist(); };
    if(settings.studyMode){
      try{
        const { renderLabelForm }=await import('./study.js');
        renderLabelForm(R.querySelector('#labels'), { ...res, labels:draft.labels }, labels=>{ draft.labels=labels; persist(); });
      }catch(e){ R.querySelector('#labels').innerHTML='<p class="sub">Study form unavailable.</p>'; }
    }
    R.querySelector('#again').onclick=reset;
    const tt=R.querySelector('#toTrends'); if(tt) tt.onclick=()=>navigate('#trends');
    const sv=R.querySelector('#save');
    sv.disabled=!!savedId;
    sv.onclick=save;
    store.kv.set('hs_last',{ hex:res.test.hex, controlHex:res.control?.hex||null, t:Date.now() });
    R._pred=pred;
  }

  function toReading(){
    const pred=$('#result')._pred||null;
    const { nearest, marker, error, ...rest }=res;
    return { ...rest, id:savedId||undefined, profileId:profile.id, t:Date.now(), source,
      tags:draft.tags, baseline:draft.baseline, labels:draft.labels, model:pred };
  }
  async function save(){
    const r=toReading();
    savedId=await store.readings.add(r);
    r.id=savedId;
    toast('Reading saved');
    try{ const { pushReading }=await import('../sync.js'); pushReading(r, profile); }catch(e){}
    render();
  }
  let persistT=null;
  function persist(){
    if(!savedId) return;
    clearTimeout(persistT);
    persistT=setTimeout(async()=>{
      const old=await store.readings.get(savedId);
      if(old) await store.readings.update({ ...old, tags:draft.tags, baseline:draft.baseline, labels:draft.labels });
    }, 300);
  }
}

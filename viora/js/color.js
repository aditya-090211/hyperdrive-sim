// Colour maths, indicator curve and the colour-rule calibration shared by every module.

export function hexToRgb(h){ h=String(h).replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
export function rgbToHex(r,g,b){ if(Array.isArray(r)) [r,g,b]=r; return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }

export function rgbToHsv(r,g,b){
  if(Array.isArray(r)) [r,g,b]=r;
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0;
  if(d){ if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0) h+=360; }
  return [h, mx?d/mx:0, mx];
}

export function rgbToLab(r,g,b){
  if(Array.isArray(r)) [r,g,b]=r;
  const f=c=>{ c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
  const R=f(r),G=f(g),B=f(b);
  let X=(R*0.4124+G*0.3576+B*0.1805)/0.95047, Y=R*0.2126+G*0.7152+B*0.0722, Z=(R*0.0193+G*0.1192+B*0.9505)/1.08883;
  const t=v=>v>0.008856 ? Math.cbrt(v) : 7.787*v+16/116;
  X=t(X); Y=t(Y); Z=t(Z);
  return [116*Y-16, 500*(X-Y), 200*(Y-Z)];
}

export function deltaE(p,q){ return Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]); }
// Lightness down-weighted: lighting changes L far more than chroma.
export function labDist(p,q){ return Math.sqrt(0.25*(p[0]-q[0])**2 + (p[1]-q[1])**2 + (p[2]-q[2])**2); }
export function hueDelta(a,b){ let d=(a-b)%360; if(d>180) d-=360; if(d<-180) d+=360; return d; }
export const hueOf = hex => rgbToHsv(hexToRgb(hex))[0];
// Indicator hues run from red (~0/360) through magenta, purple, blue to green. Reds just past 0
// belong to the acidic end, so unwrap them above 360.
export const unwrapHue = h => (h < 30 ? h + 360 : h);

export function colourOf(rgb){
  const hex=rgbToHex(rgb);
  return { rgb: rgb.map(v=>Math.round(v)), hex, hue: rgbToHsv(rgb)[0], lab: rgbToLab(rgb) };
}

// Anthocyanin (purple cabbage) hue -> pH. An approximation from typical red-cabbage indicator
// behaviour, nudged to the saliva trial hues; not calibrated against the buffer photo (beaker order unrecorded).
const PH_CURVE=[[345,4.5],[320,5.4],[300,6.0],[288,6.6],[255,7.3],[230,7.7],[180,8.5],[120,9.5],[70,11]];
export function hueToPh(h){
  h=unwrapHue(h);
  if(h>=PH_CURVE[0][0]) return PH_CURVE[0][1];
  for(let i=0;i<PH_CURVE.length-1;i++){
    const [h1,p1]=PH_CURVE[i],[h2,p2]=PH_CURVE[i+1];
    if(h<=h1 && h>=h2) return p1+(p2-p1)*(h1-h)/(h1-h2);
  }
  return PH_CURVE[PH_CURVE.length-1][1];
}

// Reference colours from the saliva trial (tube pairs averaged, white-balanced against the bench).
export const DEFAULT_REFS=[
  { id:'dehy',  name:'10-12 h without water',   hex:'#735a78', score:15, ph:6.0 },
  { id:'after', name:'5-15 min after drinking', hex:'#5b4963', score:55, ph:6.6 },
  { id:'norm',  name:'1-3 h without water',     hex:'#7a7698', score:85, ph:7.3 }
];
export const DEFAULT_CONTROL_HEX='#6f5f86';

const LS=(k,d)=>{ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } };
const LSset=(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} };
export function getRefs(){ return LS('hs_refs', null) || DEFAULT_REFS.map(r=>({...r})); }
export function setRefs(refs){ LSset('hs_refs', refs); }
export function getControlRef(){ return LS('hs_control', DEFAULT_CONTROL_HEX); }
export function setControlRef(hex){ LSset('hs_control', hex); }

// Hydration score from hue: interpolate between references sorted by hue (higher hue = pinker = drier).
export function hueToScore(h, refs=getRefs()){
  h=unwrapHue(h);
  const pts=refs.map(r=>[unwrapHue(hueOf(r.hex)), +r.score]).sort((a,b)=>b[0]-a[0]);
  if(h>=pts[0][0]) return clamp(pts[0][1]-(h-pts[0][0])*1.5);
  const last=pts[pts.length-1];
  if(h<=last[0]) return clamp(last[1]+(last[0]-h)*0.6);
  for(let i=0;i<pts.length-1;i++){
    const [h1,s1]=pts[i],[h2,s2]=pts[i+1];
    if(h<=h1 && h>=h2) return clamp(h1===h2 ? (s1+s2)/2 : s1+(s2-s1)*(h1-h)/(h1-h2));
  }
  return 50;
}
const clamp=v=>Math.max(0,Math.min(100,v));

export const BANDS=[
  { max:30,  name:'Dehydrated',        advice:'Drink 500 ml of water over the next 30 minutes, then test again. If you also feel dizzy or have a headache, rest somewhere cool.' },
  { max:50,  name:'Mildly dehydrated', advice:'Have a glass or two of water (250 to 500 ml) and retest in about 30 minutes.' },
  { max:75,  name:'Hydrated',          advice:'You are in a normal range. Keep sipping water through the day, especially before exercise.' },
  { max:101, name:'Well hydrated',     advice:'Your saliva reads well buffered. No extra water needed right now.' }
];
export const bandFor = s => BANDS.find(b=>s<b.max) || BANDS[BANDS.length-1];
export const BAND_COLOURS={ 'Dehydrated':'#9a5f93', 'Mildly dehydrated':'#7d5b8f', 'Hydrated':'#6c6aa0', 'Well hydrated':'#5f78ab' };

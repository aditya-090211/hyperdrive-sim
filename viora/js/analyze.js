// Photo -> reading. Card mode (reference card + control pad) when the card is found,
// otherwise the free-photo pipeline (auto pad location + white balance from neutral pixels).
import { rgbToHsv, rgbToLab, labDist, deltaE, hueDelta, hueOf, colourOf, hueToPh, hueToScore,
         bandFor, getRefs, getControlRef, unwrapHue, hexToRgb } from './color.js';

let cardMod=null;
async function card(){
  if(cardMod===null){ try{ cardMod=await import('./card.js'); }catch(e){ console.warn('card.js unavailable', e); cardMod=false; } }
  return cardMod || null;
}

function scaled(src, maxEdge){
  const s=Math.min(1, maxEdge/Math.max(src.width, src.height));
  const c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(src.width*s)); c.height=Math.max(1,Math.round(src.height*s));
  c.getContext('2d').drawImage(src,0,0,c.width,c.height);
  return { canvas:c, scale:s };
}
const getData=c=>c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height);

// ---------- free-photo helpers ----------
function whiteBalance(img){
  const {data,width:W,height:H}=img;
  let wr=0,wg=0,wb=0,wn=0;
  for(let i=0;i<data.length;i+=16){
    const r=data[i],g=data[i+1],b=data[i+2], [,s,v]=rgbToHsv(r,g,b);
    if(s<0.08 && v>0.6){ wr+=r; wg+=g; wb+=b; wn++; }
  }
  if(wn <= (W*H/4)*0.03) return { gain:[1,1,1], applied:false };
  const m=[wr/wn,wg/wn,wb/wn], avg=(m[0]+m[1]+m[2])/3;
  return { gain:m.map(c=>Math.max(0.92,Math.min(1.08,avg/c))), applied:true };
}

function locatePad(img, gain){
  const {data,width:W,height:H}=img;
  const bins=new Array(36).fill(0), px=[];
  for(let y=0;y<H;y+=3) for(let x=0;x<W;x+=3){
    const i=(y*W+x)*4, [h,s,v]=rgbToHsv(data[i]*gain[0],data[i+1]*gain[1],data[i+2]*gain[2]);
    if(s>0.12 && v>0.22 && v<0.98){ const b=Math.floor(h/10)%36; bins[b]+=s; px.push([x,y,b]); }
  }
  if(!px.length) return null;
  // indicator colours run pink -> purple -> blue -> teal; ignore wood, skin and warm backgrounds when possible
  const isInd=k=>k>=17||k===0;
  const total=bins.reduce((a,b)=>a+b,0), ind=bins.reduce((a,b,k)=>a+(isInd(k)?b:0),0);
  const restrict=ind>total*0.12;
  let best=0,bs=-1;
  for(let k=0;k<36;k++){ if(restrict&&!isInd(k)) continue; const sc=bins[k]+bins[(k+1)%36]+bins[(k+35)%36]; if(sc>bs){bs=sc;best=k;} }
  const near=b=>Math.min(Math.abs(b-best),36-Math.abs(b-best))<=2;
  const xs=[],ys=[];
  for(const [x,y,b] of px) if(near(b)){ xs.push(x); ys.push(y); }
  const n=xs.length; if(!n) return null;
  xs.sort((a,b)=>a-b); ys.sort((a,b)=>a-b);
  const spread=Math.min(xs[Math.floor(n*.75)]-xs[Math.floor(n*.25)], ys[Math.floor(n*.75)]-ys[Math.floor(n*.25)]);
  return { cx:xs[n>>1], cy:ys[n>>1], r:Math.max(6, Math.min(spread*0.6, Math.min(W,H)*0.12)) };
}

function sampleDisc(img, cx, cy, r, gain=[1,1,1]){
  const {data,width:W,height:H}=img, out=[];
  for(let y=Math.max(0,Math.floor(cy-r)); y<Math.min(H,cy+r); y++)
    for(let x=Math.max(0,Math.floor(cx-r)); x<Math.min(W,cx+r); x++){
      if((x-cx)**2+(y-cy)**2>r*r) continue;
      const i=(y*W+x)*4, p=[data[i]*gain[0],data[i+1]*gain[1],data[i+2]*gain[2]];
      out.push([p[0],p[1],p[2],rgbToHsv(p)[1]]);
    }
  if(!out.length) return null;
  out.sort((a,b)=>b[3]-a[3]);                    // trim the least saturated 20% (glare, paper edges)
  const keep=out.slice(0,Math.max(1,Math.floor(out.length*0.8)));
  const rgb=[0,1,2].map(c=>keep.reduce((t,p)=>t+p[c],0)/keep.length);
  const sd=Math.sqrt(keep.reduce((t,p)=>t+(p[0]-rgb[0])**2+(p[1]-rgb[1])**2+(p[2]-rgb[2])**2,0)/keep.length);
  return { rgb, sd };
}

function crop(src, cx, cy, size, out=96){
  const c=document.createElement('canvas'); c.width=c.height=out;
  c.getContext('2d').drawImage(src, cx-size/2, cy-size/2, size, size, 0, 0, out, out);
  try{ return c.toDataURL('image/jpeg',0.75); }catch(e){ return ''; }
}

// ---------- main ----------
export async function analyzeCanvas(src, { point=null }={}){
  const flags=[];
  const photo=scaled(src, 640).canvas.toDataURL('image/jpeg',0.8);
  const work=scaled(src, 1600), img=getData(work.canvas), k=work.scale;   // k: work px per source px
  const toSrc=v=>v/k;

  let det=null, cm=await card();
  if(cm){ try{ det=cm.detectCard(img); if(det && det.score<0.35) det=null; }catch(e){ console.warn(e); det=null; } }

  let mode='free', test=null, control=null, correction, marker, sd=0, thumbAt;
  if(det){
    const meas=cm.measureCard(img, det), corr=cm.buildCorrection(meas);
    correction={ method:'card', residual:+corr.residual.toFixed(1), printerOk:corr.printerOk };
    if(point){
      const s=sampleDisc(img, point.x*k, point.y*k, Math.max(5, Math.min(img.width,img.height)*0.02));
      test=colourOf(corr.apply(s.rgb)); sd=s.sd;
      marker={ type:'circle', cx:point.x, cy:point.y, r:Math.max(5,Math.min(img.width,img.height)*0.02)/k };
    } else {
      test=colourOf(corr.apply(meas.test.rgb)); sd=meas.test.sd;
      control=colourOf(corr.apply(meas.control.rgb));
    }
    mode='card';
    const tp=det.toImage(80,49), cp=det.toImage(40,49), mmPx=Math.hypot(...[0,1].map(i=>det.toImage(90,49)[i]-tp[i]))/10;
    marker=marker || { type:'card', corners:det.corners.map(p=>p.map(toSrc)), pads:[[...cp.map(toSrc), 6*mmPx/k],[...tp.map(toSrc), 6*mmPx/k]] };
    thumbAt=point ? [point.x, point.y, 60] : [tp[0]/k, tp[1]/k, 20*mmPx/k];
    if(!corr.printerOk) flags.push('The printed reference colours on the card look wrong. Print the card at 100% on a colour printer for accurate readings.');
    if(corr.residual>28) flags.push('Lighting across the card is uneven or tinted. Photograph in even daylight without shadows.');
  } else {
    const wb=whiteBalance(img);
    correction={ method: wb.applied?'whitebalance':'none', residual:null, printerOk:null };
    let at=point ? { cx:point.x*k, cy:point.y*k, r:Math.max(6,Math.min(img.width,img.height)*0.04) } : locatePad(img, wb.gain);
    if(!at) return { error:'No coloured strip found in the photo. Make sure the pad is in focus and well lit, or tap it in the image.', photo };
    const s=sampleDisc(img, at.cx, at.cy, at.r, wb.gain);
    if(!s) return { error:'Could not sample that spot. Tap directly on the coloured pad.', photo };
    test=colourOf(s.rgb); sd=s.sd;
    marker={ type:'circle', cx:toSrc(at.cx), cy:toSrc(at.cy), r:toSrc(at.r) };
    thumbAt=[toSrc(at.cx), toSrc(at.cy), toSrc(at.r)*2.4];
    if(!wb.applied) flags.push('No white background was found to correct the lighting. Use the reference card or a white sheet for better accuracy.');
  }

  // control-pad compensation: shift the test hue by how far this strip's dry pad drifts from the expected dry colour
  let hueShift=null, adjHue=test.hue;
  if(control){
    hueShift=+hueDelta(test.hue, control.hue).toFixed(1);
    const drift=hueDelta(control.hue, hueOf(getControlRef()));
    if(Math.abs(drift)>25) flags.push('The dry control pad is an unusual colour, so this strip batch may be faulty or old. The reading was not adjusted for it.');
    else adjHue=(test.hue-drift+360)%360;
    if(deltaE(test.lab, control.lab)<3) flags.push('The test pad looks the same as the dry control pad. It may not have touched saliva.');
  }

  const [,sat,val]=rgbToHsv(test.rgb), hh=unwrapHue(adjHue);
  if(sat<0.07) flags.push('The pad looks almost grey. The strip may be dry, faded or the photo too dim, so treat this reading with caution.');
  if(hh<200) flags.push('This colour is outside the normal saliva range (it reads alkaline). Check the strip has not touched soap, toothpaste or a drink.');
  if(hh>335) flags.push('This colour reads strongly acidic, which usually means food or a drink was consumed recently. Rinse with water, wait 30 minutes and retest.');
  if(val<0.18) flags.push('The photo is very dark. Retake it in daylight for an accurate reading.');

  const refs=getRefs();
  const adjLab=rgbToLab(test.rgb);
  const nearest=refs.map(r=>({ ref:r, d:labDist(adjLab, rgbToLab(hexToRgb(r.hex))) })).sort((a,b)=>a.d-b.d);
  const score=Math.round(hueToScore(adjHue, refs));
  const ph=+hueToPh(adjHue).toFixed(2);
  let conf=100 - nearest[0].d*1.4 - sd*0.35 - (sat<0.12?25:0) - flags.length*10 + (mode==='card'?8:0) - (correction.method==='none'?8:0);
  conf=Math.round(Math.max(15, Math.min(97, conf)));

  return {
    mode, test, control, hueShift, adjHue:+adjHue.toFixed(1), correction,
    score, ph, conf, band:bandFor(score).name, flags, nearest, marker,
    thumb: crop(src, thumbAt[0], thumbAt[1], thumbAt[2]), photo
  };
}

export function drawMarker(ctx, marker, scale=1){
  if(!marker) return;
  ctx.save();
  ctx.lineWidth=Math.max(2, ctx.canvas.width/300);
  ctx.strokeStyle='#fff'; ctx.shadowColor='rgba(0,0,0,.6)'; ctx.shadowBlur=6;
  const ring=(x,y,r)=>{ ctx.beginPath(); ctx.arc(x*scale,y*scale,r*scale,0,Math.PI*2); ctx.stroke(); };
  if(marker.type==='circle'){
    ring(marker.cx, marker.cy, marker.r);
    ctx.setLineDash([6,5]); ring(marker.cx, marker.cy, marker.r+ctx.lineWidth*2.5/scale);
  } else if(marker.type==='card'){
    ctx.setLineDash([8,6]); ctx.beginPath();
    marker.corners.forEach(([x,y],i)=>i?ctx.lineTo(x*scale,y*scale):ctx.moveTo(x*scale,y*scale));
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    for(const [x,y,r] of marker.pads) ring(x,y,r);
  }
  ctx.restore();
}

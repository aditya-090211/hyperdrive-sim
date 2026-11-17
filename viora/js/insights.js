// Personal baseline and context-tag explanations.

export const TAGS=[
  { id:'ate',      label:'Just ate',          effect:'acid',        note:'Food lowers saliva pH for 20 to 40 minutes, so the strip reads drier than you are.' },
  { id:'coffee',   label:'Coffee or tea',     effect:'acid',        note:'Coffee and tea are acidic and can push the strip towards the dehydrated colour.' },
  { id:'juice',    label:'Juice or soda',     effect:'acid',        note:'Acidic and sugary drinks lower saliva pH for up to an hour.' },
  { id:'exercise', label:'After exercise',    effect:'dehydrating', note:'Sweat loss during exercise genuinely dehydrates you, so a low reading is likely real.' },
  { id:'brushed',  label:'Brushed teeth',     effect:'alkaline',    note:'Toothpaste is alkaline and can make the strip read better hydrated than you are.' },
  { id:'alcohol',  label:'Alcohol',           effect:'dehydrating', note:'Alcohol increases urine output and commonly leads to real dehydration.' },
  { id:'sick',     label:'Unwell',            effect:'unreliable',  note:'Illness, fever and some medicines change saliva, so treat this reading with caution.' },
  { id:'morning',  label:'Just woke up',      effect:'none',        note:'Morning readings, before eating or drinking, are the best ones for your baseline.' },
  { id:'heat',     label:'Hot weather',       effect:'dehydrating', note:'Heat raises sweat loss, so a low reading is likely real.' }
];
export const tagById = id => TAGS.find(t=>t.id===id);

export function computeBaseline(readings){
  const b=readings.filter(r=>r.baseline).sort((a,b)=>a.t-b.t).slice(-10);
  if(b.length<3) return null;
  const scores=b.map(r=>r.score), n=b.length;
  const mean=scores.reduce((a,c)=>a+c,0)/n;
  const sd=Math.sqrt(scores.reduce((a,c)=>a+(c-mean)**2,0)/(n-1));
  const meanHue=b.reduce((a,r)=>a+r.adjHue,0)/n;
  return { n, meanScore:mean, sdScore:Math.max(sd,4), meanHue }; // floor SD so tiny samples do not over-alarm
}

export function compareToBaseline(reading, base){
  if(!base) return null;
  const delta=reading.score-base.meanScore, z=delta/base.sdScore;
  const pts=Math.abs(Math.round(delta));
  let text;
  if(Math.abs(z)<1) text=`Within your normal range (${pts} point${pts===1?'':'s'} from your baseline of ${Math.round(base.meanScore)}).`;
  else if(z<0) text=`${pts} points below your personal baseline of ${Math.round(base.meanScore)}${z<-2?', a clear drop for you':''}.`;
  else text=`${pts} points above your personal baseline of ${Math.round(base.meanScore)}.`;
  return { delta, z, text };
}

// Explain a reading using its context tags. Returns plain sentences.
export function explainReading(reading, base){
  const out=[];
  const low = base ? reading.score < base.meanScore - base.sdScore : reading.score < 50;
  const high = base ? reading.score > base.meanScore + base.sdScore : reading.score > 80;
  for(const id of reading.tags||[]){
    const t=tagById(id); if(!t) continue;
    if(t.effect==='acid' && low) out.push(`Probably explained by "${t.label}": ${t.note} Rinse your mouth, wait 30 minutes and retest to confirm.`);
    else if(t.effect==='alkaline' && high) out.push(`Probably explained by "${t.label}": ${t.note}`);
    else if(t.effect==='dehydrating' && low) out.push(`Consistent with "${t.label}": ${t.note}`);
    else if(t.effect==='unreliable') out.push(t.note);
  }
  return out;
}

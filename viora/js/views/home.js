// Landing page: the Changemakers story, with a live indicator-ink hero, an interactive strip and the impact plan.
import { getRefs, hexToRgb, rgbToHex, rgbToHsv, hueToScore, hueToPh, bandFor } from '../color.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICON = {
  school:'<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M7 11v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5"/><path d="M21 9v6"/></svg>',
  work:'<svg viewBox="0 0 24 24"><path d="M4 15a8 8 0 0116 0"/><path d="M2 15h20v2H2z"/><path d="M12 7V4"/><path d="M9 8l-.5-2M15 8l.5-2"/></svg>',
  elder:'<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M10 21l1-7-2-3 3-3 3 3"/><path d="M14 21l-1-5"/><path d="M17 11v10"/></svg>',
  sport:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M21 10l-5 0M3 10h5M7 19l2.5-4.5M17 19l-2.5-4.5"/></svg>',
  clinic:'<svg viewBox="0 0 24 24"><path d="M4 21V8l8-5 8 5v13"/><path d="M12 10v6M9 13h6"/><path d="M9 21v-3h6v3"/></svg>',
  eye:'<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  lab:'<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/><path d="M7 15h10"/></svg>',
  sun:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
};

export async function mount(el){
  const refs=getRefs();
  el.innerHTML=`
  <div class="hm">
    <div class="hm-bleed hm-hero" id="hmHero">
      <canvas id="hmGl" aria-hidden="true"></canvas>
      <div class="hm-hero-inner">
        <span class="hm-eyebrow">Changemakers project</span>
        <h1 class="hm-title" translate="no">Viora</h1>
        <p class="hm-lede">A saliva test strip made from purple cabbage and filter paper, read by any phone camera. It tells you if you are dehydrated in thirty seconds, for less than a rupee.</p>
        <div class="hm-ctas">
          <a class="hm-btn solid" href="#check">Take a reading</a>
          <a class="hm-btn" href="#hmProblem" data-scroll>Why it matters</a>
        </div>
        <p class="hm-hint">Move or tap the ink. Blue means hydrated.</p>
      </div>
    </div>

    <section class="hm-sec" id="hmProblem">
      <p class="hm-kicker">The problem</p>
      <div class="hm-split">
        <h2 class="hm-h2">Dehydration is <em>invisible</em> until it is already a problem.</h2>
        <p class="hm-p" style="margin-top:8px">Mild dehydration slows thinking, causes headaches and raises the risk of heat illness, yet most people only notice it when they are already short of water. The tools that measure it properly sit in labs and clinics. The people most exposed to heat rarely have access to them.</p>
      </div>
      <div class="hm-cols c3">
        <div><span class="ix">01</span><h3>Thirst arrives late</h3><p>The body signals thirst after water loss has begun. Children absorbed in play and older adults, whose sense of thirst weakens with age, often miss it entirely.</p></div>
        <div><span class="ix">02</span><h3>Testing needs a lab</h3><p>Blood tests and urine analysers are accurate but need equipment, trained staff or privacy. None of them fit a school field, a building site or a village street.</p></div>
        <div><span class="ix">03</span><h3>Heat is rising</h3><p>Heatwaves are becoming longer and more frequent. Every extra hot day puts students, outdoor workers and elderly people at greater risk, especially where cooling is scarce.</p></div>
      </div>
    </section>

    <section class="hm-sec" id="hmDemo">
      <p class="hm-kicker">The idea</p>
      <div class="hm-split">
        <h2 class="hm-h2">A strip that <em>changes colour</em> with your hydration.</h2>
        <p class="hm-p" style="margin-top:8px">Purple cabbage contains anthocyanins, natural dyes that change colour with pH. When you are short of water you make less saliva, it carries less bicarbonate and becomes more acidic. The strip turns pinker. Drag the slider to see it.</p>
      </div>
      <div class="hm-demo">
        <div class="hm-stage">
          <svg viewBox="0 0 600 400" id="hmStrip" role="img" aria-label="Test strip on the reference card">
            <defs>
              <linearGradient id="hmPaper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf9f6"/><stop offset="1" stop-color="#ece7e0"/></linearGradient>
              <radialGradient id="hmWet"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".6" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
              <clipPath id="hmPadClip"><rect x="376" y="186" width="84" height="84" rx="6"/></clipPath>
              <filter id="hmTex"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .12 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
            </defs>
            <g transform="rotate(-4 300 200)">
              <rect x="40" y="40" width="520" height="340" rx="16" fill="url(#hmPaper)"/>
              ${[[58,58],[502,58],[58,322],[502,322]].map(([x,y],i)=>`<rect x="${x}" y="${y}" width="40" height="40" fill="#111"/>${i===0?`<rect x="${x+12}" y="${y+12}" width="16" height="16" fill="#fbf9f6"/>`:''}`).join('')}
              <rect x="128" y="76" width="44" height="44" rx="3" fill="#fff" stroke="#ddd"/>
              <rect x="186" y="76" width="44" height="44" rx="3" fill="#808080"/>
              ${refs.map((r,i)=>`<rect x="${244+i*58}" y="76" width="44" height="44" rx="3" fill="${r.hex}"/>`).join('')}
              <rect x="80" y="210" width="440" height="36" rx="5" fill="#f3efe7" stroke="#d9d2c6"/>
              <rect x="136" y="186" width="84" height="84" rx="6" fill="#6f5f86" id="hmCtrl"/>
              <rect x="376" y="186" width="84" height="84" rx="6" fill="#7a7698" id="hmPad"/>
              <g clip-path="url(#hmPadClip)"><circle cx="418" cy="228" r="0" fill="url(#hmWet)" id="hmWick"/></g>
              <rect x="136" y="186" width="84" height="84" rx="6" filter="url(#hmTex)" fill="#000"/>
              <rect x="376" y="186" width="84" height="84" rx="6" filter="url(#hmTex)" fill="#000"/>
              <text x="178" y="296" text-anchor="middle" font-size="15" fill="#6b6573" font-family="IBM Plex Sans,sans-serif">Control (dry)</text>
              <text x="418" y="296" text-anchor="middle" font-size="15" fill="#6b6573" font-family="IBM Plex Sans,sans-serif">Test (saliva)</text>
            </g>
          </svg>
        </div>
        <div class="hm-readout">
          <div>
            <div class="hm-small">Hours without water</div>
            <input type="range" class="hm-range" id="hmHours" min="0" max="12" step="0.1" value="2" aria-label="Hours without water">
            <div class="row" style="justify-content:space-between"><span class="hm-small">Just drank</span><span class="hm-small" id="hmHoursV">2.0 h</span><span class="hm-small">12 h</span></div>
          </div>
          <div class="hm-big" id="hmBand">Hydrated</div>
          <div class="hm-meter"><i id="hmPin" style="left:80%"></i></div>
          <div class="hm-mini">
            <div><div class="k">Score</div><div class="v" id="hmScore">80</div></div>
            <div><div class="k">Saliva pH</div><div class="v" id="hmPh">7.2</div></div>
            <div><div class="k">Colour</div><div class="v" id="hmHex" style="font-size:15px;padding-top:4px" translate="no">#7a7698</div></div>
          </div>
          <p class="hm-small">Illustration using the colours measured in our first saliva trial. Real readings come from the analyser on the <a href="#check">Check</a> page.</p>
        </div>
      </div>
    </section>

    <section class="hm-sec">
      <p class="hm-kicker">How it works</p>
      <h2 class="hm-h2">From a vegetable to an answer in <em>four steps</em>.</h2>
      <div class="hm-pipe">
        <div class="hm-step"><div class="n">01</div>
          <svg viewBox="0 0 200 110"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path class="draw" style="--len:330" d="M100 20c-40 0-62 26-62 50s28 32 62 32 62-8 62-32-22-50-62-50z"/>
            <path class="draw" style="--len:200" d="M100 26v74M100 50c-14-6-26-4-38 6M100 50c14-6 26-4 38 6M100 74c-16-6-30-2-44 8M100 74c16-6 30-2 44 8"/></g>
            <circle class="pop" cx="100" cy="66" r="10" fill="currentColor" opacity=".35"/></svg>
          <h3>Cabbage</h3><p>Boil purple cabbage, keep the dark purple water. That extract is the indicator.</p></div>
        <div class="hm-step"><div class="n">02</div>
          <svg viewBox="0 0 200 110"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path class="draw" style="--len:420" d="M20 48h160v16H20z"/></g>
            <rect class="pop" x="42" y="40" width="30" height="32" rx="3" fill="#6f5f86"/><rect class="pop" x="128" y="40" width="30" height="32" rx="3" fill="#a23b6c"/></svg>
          <h3>Strip</h3><p>Soak filter paper squares, dry them and stick two on a strip. One stays dry as a control.</p></div>
        <div class="hm-step"><div class="n">03</div>
          <svg viewBox="0 0 200 110"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path class="draw" style="--len:380" d="M64 12h72a8 8 0 018 8v72a8 8 0 01-8 8H64a8 8 0 01-8-8V20a8 8 0 018-8z"/>
            <path class="draw" style="--len:120" d="M76 34h48v40H76z"/></g>
            <circle class="pop" cx="100" cy="54" r="9" fill="currentColor" opacity=".5"/></svg>
          <h3>Photo</h3><p>Touch the test pad to your tongue, lay the strip on the printed card and take a photo.</p></div>
        <div class="hm-step"><div class="n">04</div>
          <svg viewBox="0 0 200 110"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path class="draw" style="--len:300" d="M24 92a76 76 0 01152 0"/>
            <path class="draw" style="--len:90" d="M100 92l34-44"/></g>
            <circle class="pop" cx="100" cy="92" r="7" fill="currentColor"/></svg>
          <h3>Answer</h3><p>The phone corrects the lighting against the card, reads the colour and tells you how hydrated you are.</p></div>
      </div>
    </section>

    <section class="hm-sec">
      <p class="hm-kicker">Who it helps</p>
      <div class="hm-split">
        <h2 class="hm-h2">Built for the people <em>heat reaches first</em>.</h2>
        <p class="hm-p" style="margin-top:8px">Viora is cheap enough to hand out by the hundred and simple enough to use without training. These are the groups we designed it around.</p>
      </div>
      <div class="hm-list">
        <div class="hm-row">${ICON.school}<h3>Schools in hot regions</h3><p>A class-wide check before sports day or an outdoor assembly. Teachers see who needs water before anyone faints in the sun.</p><div class="use">Morning check, under a minute per student</div></div>
        <div class="hm-row">${ICON.work}<h3>Outdoor workers</h3><p>Construction crews and delivery riders work through the hottest hours. A strip in the pocket turns &ldquo;drink more water&rdquo; into a number they can act on.</p><div class="use">Midday check on the job</div></div>
        <div class="hm-row">${ICON.elder}<h3>Older adults and carers</h3><p>Thirst fades with age, and dehydration in older people is easy to mistake for confusion or tiredness. Carers get an objective daily check.</p><div class="use">Daily baseline, alerts when it drops</div></div>
        <div class="hm-row">${ICON.sport}<h3>Sports teams</h3><p>Players test before and after training and the coach sees the whole squad on one dashboard, with anyone who is dry highlighted at the top.</p><div class="use">Live team dashboard, built in</div></div>
        <div class="hm-row">${ICON.clinic}<h3>Community health workers</h3><p>In places without a lab, a health worker with a phone and a stack of strips can screen a whole street during a heatwave and prioritise who to help first.</p><div class="use">Works offline, no lab needed</div></div>
      </div>
    </section>

    <section class="hm-sec">
      <p class="hm-kicker">Why it can scale</p>
      <h2 class="hm-h2">Cheap to make, <em>free to share</em>, private by design.</h2>
      <div class="hm-nums">
        <div class="hm-num"><div class="v">&lt;&#8202;&#8377;1</div><div class="k">Estimated cost per strip</div><div class="f">Our estimate: one cabbage and a few sheets of filter paper make hundreds of pads.</div></div>
        <div class="hm-num"><div class="v">30 s</div><div class="k">From wet strip to result</div><div class="f">The guided camera captures automatically once the colour settles.</div></div>
        <div class="hm-num"><div class="v">0</div><div class="k">Photos uploaded</div><div class="f">All analysis runs on the phone. Teams share only scores.</div></div>
        <div class="hm-num"><div class="v">Open</div><div class="k">Card, recipe and code</div><div class="f">Anyone can print the card and make strips with kitchen equipment.</div></div>
      </div>
    </section>

    <section class="hm-sec">
      <p class="hm-kicker">Our early evidence</p>
      <div class="hm-split">
        <div>
          <h2 class="hm-h2">The colour <em>moved</em> with hydration.</h2>
          <div class="hm-tubes" style="margin-top:28px">
            ${[['10 to 12 h','without water',refs[0]],['5 to 15 min','after drinking',refs[1]],['1 to 3 h','without water',refs[2]]].map(([a,b,r])=>`<div class="hm-tube"><div class="glass"><div class="liq" style="background:${r.hex}"></div></div><div><b>${a}</b>${b}</div></div>`).join('')}
          </div>
        </div>
        <div>
          <p class="hm-p">In our first trial, saliva collected after ten to twelve hours without water turned the indicator the pinkest of all three samples, exactly as the chemistry predicts. We also showed that salt concentration alone did not change the colour, so the strip is reading pH rather than saltiness.</p>
          <p class="hm-p">The trial was small: one person, two samples per condition, and the sample taken just after drinking did not sit neatly between the other two. We say so openly. That is why the app includes a study mode, a reference card and a control pad, so the next round of testing can prove, or disprove, that the strip works.</p>
          <div class="hm-ctas"><a class="hm-btn" href="methods">Read the full methods</a></div>
        </div>
      </div>
    </section>

    <section class="hm-sec">
      <p class="hm-kicker">Impact plan</p>
      <h2 class="hm-h2">From one experiment to <em>thousands of strips</em>.</h2>
      <div class="hm-road">
        <div class="hm-phase now"><div class="when">Phase 1, now</div><h3>Validate</h3><ul><li>Recruit 30 volunteers at school</li><li>Record every reading against the urine colour chart</li><li>Train and test the model on real data</li></ul></div>
        <div class="hm-phase"><div class="when">Phase 2, next term</div><h3>Pilot</h3><ul><li>Run with school sports teams through the hot months</li><li>Coaches use the live squad dashboard</li><li>Measure how often players drink after a low reading</li></ul></div>
        <div class="hm-phase"><div class="when">Phase 3, year one</div><h3>Share</h3><ul><li>Publish the card, strip recipe and app openly</li><li>Strip-making workshops for other schools</li><li>The app is already available in Hindi and Marathi</li></ul></div>
        <div class="hm-phase"><div class="when">Phase 4, beyond</div><h3>Scale</h3><ul><li>Partner with NGOs running heat action plans</li><li>Kits for care homes and construction sites</li><li>Train community health workers to screen during heatwaves</li></ul></div>
      </div>
    </section>

    <section class="hm-sec">
      <p class="hm-kicker">Global goals</p>
      <h2 class="hm-h2">Aligned with the UN <em>Sustainable Development Goals</em>.</h2>
      <div class="hm-sdg">
        <div><div class="big">3</div><div class="lab">Good health and well-being</div><p>Early, everyday detection of dehydration before it becomes heat illness.</p></div>
        <div><div class="big">10</div><div class="lab">Reduced inequalities</div><p>A health check that costs almost nothing and needs no lab, clinic or specialist.</p></div>
        <div><div class="big">13</div><div class="lab">Climate action</div><p>A practical tool for adapting to longer, hotter heatwaves in the communities hit hardest.</p></div>
      </div>
    </section>

    <div class="hm-bleed hm-final"><div class="in">
      <p class="hm-kicker">Try it</p>
      <h2 class="hm-h2">Make a strip. Take a photo. <em>Know.</em></h2>
      <p class="hm-p">Print the reference card, make a strip with the recipe and take your first reading. Every labelled reading helps prove whether the strip works.</p>
      <div class="hm-ctas">
        <a class="hm-btn solid" href="#check">Take a reading</a>
        <a class="hm-btn" href="card">Print the card</a>
        <a class="hm-btn" href="#study">Join the study</a>
      </div>
    </div></div>
    <p class="hm-note">Viora is a student research prototype and has not been clinically validated. The impact plan describes what we intend to do, and the cost per strip is our own estimate. It is not a medical device; anyone who feels dizzy or confused, or has stopped urinating, should seek medical help.</p>
  </div>`;

  const cleanups=[];
  const on=(t,ev,fn,o)=>{ t.addEventListener(ev,fn,o); cleanups.push(()=>t.removeEventListener(ev,fn,o)); };
  el.querySelectorAll('[data-scroll]').forEach(a=>on(a,'click',e=>{ e.preventDefault(); el.querySelector(a.getAttribute('href')).scrollIntoView({behavior:reduce()?'auto':'smooth'}); }));
  cleanups.push(startHero(el.querySelector('#hmHero'), el.querySelector('#hmGl')));

  // pipeline drawings sketch themselves once when they come into view
  const io=new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('on'); io.unobserve(e.target); } }),{threshold:.35});
  el.querySelectorAll('.hm-step').forEach(s=>io.observe(s));
  cleanups.push(()=>io.disconnect());

  // interactive strip
  const dry=hexToRgb(refs[2].hex), wet=hexToRgb(refs[0].hex);
  const $=id=>el.querySelector('#'+id);
  let lastWick=0;
  const setHours=h=>{
    const t=Math.min(1,Math.max(0,h/12)), e=t*t*(3-2*t)*0.6+t*0.4;
    const rgb=dry.map((v,i)=>v+(wet[i]-v)*e), hex=rgbToHex(rgb), hue=rgbToHsv(rgb)[0];
    const score=Math.round(hueToScore(hue, refs)), band=bandFor(score);
    $('hmPad').setAttribute('fill',hex);
    $('hmHoursV').textContent=`${h.toFixed(1)} h`;
    $('hmBand').textContent=band.name;
    $('hmPin').style.left=score+'%';
    $('hmScore').textContent=score;
    $('hmPh').textContent=hueToPh(hue).toFixed(1);
    $('hmHex').textContent=hex;
    const now=performance.now();
    if(!reduce() && now-lastWick>500){ lastWick=now; const w=$('hmWick'); w.classList.remove('wick'); void w.getBBox(); w.classList.add('wick'); }
  };
  on($('hmHours'),'input',e=>setHours(+e.target.value));
  setHours(2);

  return ()=>{ cleanups.forEach(f=>{ try{ f(); }catch(e){} }); };
}

// ---------------------------------------------------------------- hero (WebGL indicator ink)
const FRAG=`
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uMouseOn;
uniform vec4 uRip[6]; uniform vec3 uBg;
float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*n(p); p=m*p; a*=.5; } return v; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  float t=uTime;
  // one slow organic field breaks up every edge (drops, cursor, page edges) so nothing reads as a hard shape
  float org=n(p*2.2+vec2(t*.05,-t*.04));
  float wet=0.;
  for(int i=0;i<6;i++){
    vec4 rp=uRip[i]; if(rp.z<0.) continue;
    float age=t-rp.z; if(age>9.) continue;
    vec2 d=p-rp.xy; float L=length(d)+(org-.5)*.24;
    float front=.05+.42*(1.-exp(-age*.5));              // spreads quickly, then settles like a drop in water
    float life=smoothstep(0.,.6,age)*(1.-smoothstep(4.5,9.,age));
    float ring=exp(-pow((L-front)*6.,2.))*life;
    p+=normalize(d+1e-4)*sin(L*8.-age*2.2)*ring*.028;
    wet+=smoothstep(front,front-.45,L)*life;
  }
  vec2 m=(uMouse-.5*uRes)/uRes.y;
  float dm=length(p-m)+(org-.5)*.32;
  float near=uMouseOn*smoothstep(.72,0.,dm); near*=near;
  float stir=near*.28+wet*.12;                          // the cursor stirs the flow instead of sitting on top of it
  vec2 q=vec2(fbm(p*1.5+t*.045+stir), fbm(p*1.5+vec2(5.2,1.3)-t*.04-stir));
  vec2 r=vec2(fbm(p*1.5+3.6*q+vec2(1.7,9.2)+t*.06), fbm(p*1.5+3.6*q+vec2(8.3,2.8)-t*.05));
  float f=fbm(p*1.5+3.6*r);
  float hyd=clamp(.22+.55*r.x-.25*q.y+near*1.35+wet*1.05, 0., 1.);
  vec3 pink=vec3(.80,.33,.52), magenta=vec3(.60,.30,.60), violet=vec3(.43,.30,.66), indigo=vec3(.30,.44,.88);
  vec3 col=mix(pink,magenta,smoothstep(.0,.35,hyd));
  col=mix(col,violet,smoothstep(.3,.62,hyd));
  col=mix(col,indigo,smoothstep(.58,.95,hyd));
  vec3 bg=vec3(.043,.035,.063);
  float dens=clamp(f*1.55-.28+.35*length(r)-.12*length(q),0.,1.);
  vec3 c=mix(bg,col,dens);
  c+=pow(max(f-.56,0.)*2.3,3.)*vec3(1.,.93,1.)*.6;
  c*=1.-.3*pow(length(uv-vec2(.5,.5))*1.1,2.2);
  c+=(h(gl_FragCoord.xy+fract(t)*91.)-.5)*.03;
  // the ink bleeds into the page colour along an uneven edge, top and bottom
  float edge=(f-.5)*.24+(org-.5)*.10;
  float fadeB=smoothstep(.27,.02,uv.y+edge);
  float fadeT=smoothstep(.84,1.02,uv.y+edge*.6);
  c=mix(c,uBg,max(fadeB,fadeT));
  gl_FragColor=vec4(c,1.);
}`;
const VERT='attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }';

function startHero(hero, canvas){
  const gl=canvas.getContext('webgl',{antialias:false,premultipliedAlpha:false,powerPreference:'high-performance'});
  if(!gl){ hero.classList.add('nogl'); canvas.remove(); return ()=>{}; }
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog;
  try{
    prog=gl.createProgram();
    gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));
    gl.linkProgram(prog); if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  }catch(e){ console.warn(e); hero.classList.add('nogl'); canvas.remove(); return ()=>{}; }
  gl.useProgram(prog);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(prog,'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const U=k=>gl.getUniformLocation(prog,k);
  const uRes=U('uRes'), uTime=U('uTime'), uMouse=U('uMouse'), uMouseOn=U('uMouseOn'), uRip=U('uRip'), uBg=U('uBg');
  let bgc=[.043,.035,.063];
  const readBg=()=>{ const m=getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g); if(m&&m.length>=3) bgc=m.slice(0,3).map(v=>v/255); if(still) draw(8); };
  const mq=matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change',readBg);
  const rip=new Float32Array(24).fill(-1); let ripI=0;
  const still=reduce();
  let W=0,H=0, scale=0.6, mx=0,my=0, mOn=0, mTarget=0, smx=0, smy=0;
  const t0=performance.now(); let raf=0, visible=true, frames=0, slowT=0;

  const resize=()=>{
    const r=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
    W=Math.max(2,Math.round(r.width*dpr*scale)); H=Math.max(2,Math.round(r.height*dpr*scale));
    canvas.width=W; canvas.height=H; gl.viewport(0,0,W,H);
    if(still) draw(8);
  };
  const toGl=(e)=>{ const r=canvas.getBoundingClientRect(); return [(e.clientX-r.left)/r.width*W, (1-(e.clientY-r.top)/r.height)*H]; };
  const now=()=>(performance.now()-t0)/1000;
  const addRipple=(x,y)=>{ const k=ripI++%6; rip[k*4]=(x-.5*W)/H; rip[k*4+1]=(y-.5*H)/H; rip[k*4+2]=now(); rip[k*4+3]=0; if(still) draw(8); };

  function draw(t){
    smx+=(mx-smx)*.06; smy+=(my-smy)*.06; mOn+=(mTarget-mOn)*.035;
    gl.uniform2f(uRes,W,H); gl.uniform1f(uTime,t); gl.uniform2f(uMouse,smx,smy); gl.uniform1f(uMouseOn,mOn);
    gl.uniform4fv(uRip,rip); gl.uniform3f(uBg,bgc[0],bgc[1],bgc[2]);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function loop(){
    const s=performance.now();
    draw(now());
    // adaptive resolution: drop the render scale on slow GPUs
    frames++; slowT+=performance.now()-s;
    if(frames===40){ if(slowT/40>14 && scale>0.35){ scale-=0.15; resize(); } frames=0; slowT=0; }
    raf=visible?requestAnimationFrame(loop):0;
  }
  const onMove=e=>{ [mx,my]=toGl(e); mTarget=1; };
  const onLeave=()=>{ mTarget=0; };
  const onDown=e=>{ const [x,y]=toGl(e); addRipple(x,y); };
  canvas.addEventListener('pointermove',onMove); canvas.addEventListener('pointerleave',onLeave); canvas.addEventListener('pointerdown',onDown);
  hero.addEventListener('pointermove',onMove);
  readBg();
  const ro=new ResizeObserver(resize); ro.observe(canvas); resize();
  const io=new IntersectionObserver(([e])=>{ visible=e.isIntersecting; if(visible && !raf && !still) raf=requestAnimationFrame(loop); });
  io.observe(hero);
  // an opening "drop" so the hero comes alive on load
  setTimeout(()=>addRipple(W*.68,H*.5), still?0:700);
  if(!still) raf=requestAnimationFrame(loop); else draw(8);
  return ()=>{ cancelAnimationFrame(raf); visible=false; ro.disconnect(); io.disconnect(); mq.removeEventListener('change',readBg); hero.removeEventListener('pointermove',onMove); const ext=gl.getExtension('WEBGL_lose_context'); ext && ext.loseContext(); };
}


const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/adity/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
(async () => {
 const browser = await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page = await browser.newPage();
 await page.route('**/*', r => r.request().url().startsWith('http://127.0.0.1:8766') ? r.continue() : r.abort());
 const errors=[];page.on('pageerror', e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766');await page.waitForFunction(()=>window.__sim);
 const results=await page.evaluate(async()=>{
  const {Online}=await import('/js/online.js');const {SignedRoom}=await import('/js/signed-room.js');
  const assert=(ok,name)=>{if(!ok)throw new Error(name);checks.push(name)};const checks=[];
  const o=new Online({robots:[{squad:'red'},{squad:'red'},{squad:'blue'},{squad:'blue'}]});o.role='host';o.room={sendAll(){}};o.epoch=1;o.lobby={seats:['guest',null,null,null]};o.changed=()=>{};
  o.onMsg('guest',{t:'in',n:1,e:1,s:[null]});assert(!o.inputs[0],'Null input rejected');
  const input=(n,g=0)=>o.onMsg('guest',{t:'in',n,e:1,s:[[0,0.5,0,0,g,0]]});
  input(1);input(2,10000);assert(o.inputs[0].g===0,'10000-action input rejected');
  input(Number.MAX_SAFE_INTEGER);input(2);assert(o.inputs[0].n===2,'Sequence poisoning rejected; normal controls recover');
  o.inputs=[];o.applied=[];input(5000,200);
  let oldPresses=0;o.applyRemote({id:0,enabled:true,toggleGrip(){oldPresses++},cargoAction(){oldPresses++}});
  assert(o.inputs[0]?.n===5000&&oldPresses===0,'Late seat accepts current sequence without replaying historical presses');
  input(5001,201);o.applyRemote({id:0,enabled:true,toggleGrip(){oldPresses++},cargoAction(){oldPresses++}});
  assert(oldPresses===1,'Late seat responds to its next real button press');
  let actions=0;o.applied[0]={g:0,c:0};o.inputs[0].g=10000;o.applyRemote({id:0,enabled:true,toggleGrip(){actions++},cargoAction(){}});assert(actions===4,'Actuator work capped at four per frame');
  let hp=0;o.hooks.hpAction=()=>hp++;o.onMsg('guest',{t:'hp',sq:'red',a:'pl',r:2});o.onMsg('guest',{t:'hp',sq:'red',a:'pl',r:999});assert(hp===0,'Opponent and invalid payload targets rejected');o.onMsg('guest',{t:'hp',sq:'red',a:'pl',r:0});assert(hp===1,'Own-alliance payload request works');
  let menu=0;o.role='guest';o.room.hostId='host';o.hooks.menu=()=>menu++;o.onMsg('attacker',{t:'menu'});assert(menu===0,'Non-host menu command rejected');o.onMsg('host',{t:'menu'});assert(menu===1,'Host menu command works');
  const a=await SignedRoom.create('TEST'),b=await SignedRoom.create('TEST'),other=await SignedRoom.create('ELSE');let envelope=await a.sign('msg',{to:'*',m:{t:'menu'}});
  assert(!!await b.verify('msg',envelope),'Signed message accepted');assert(!await b.verify('msg',envelope),'Replay rejected');assert(!await other.verify('msg',envelope),'Cross-room replay rejected');
  envelope=await a.sign('msg',{to:'*',m:{t:'menu'}});envelope.body.payload.from='victim';assert(!await b.verify('msg',envelope),'Forged sender rejected');
  envelope=await a.sign('msg',{to:'*',m:{t:'menu'}});envelope.body.payload.m.t='restart';assert(!await b.verify('msg',envelope),'Tampered command rejected');
  __sim.ctx.startGame('match');__sim.game.start();const before=__sim.game.time;__sim.tick(0.05,false,1);assert(Math.abs(__sim.game.time-before-1)<1e-7,'Match clock follows elapsed wall time under slow rendering');
  __sim.advance(154);assert(__sim.game.state==='final'&&__sim.game.time===150,'Full match finalizes at 150 seconds');
  assert(__sim.game.payloadAction(999)===false,'Invalid direct payload ID rejected');
  return checks;
 });
 for(const size of [{width:844,height:390},{width:1920,height:400},{width:320,height:568}]){
  await page.setViewportSize(size);await page.evaluate(()=>__sim.ctx.toMenu());await page.waitForTimeout(100);
  const clipped=await page.evaluate(()=>[...document.querySelectorAll('#menu .mode,#menu .learn,#menu .menu-foot')].filter(e=>e.getBoundingClientRect().bottom>innerHeight).map(e=>e.textContent.trim()));
  if(clipped.length)throw new Error(`Clipped menu ${JSON.stringify(size)}: ${clipped}`);results.push(`Menu fits ${size.width}x${size.height}`);
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{__sim.ctx.startGame('match');__sim.setCamera(0)});
 if(await page.evaluate(()=>__sim.camera.fov)!==80)throw Error('Portrait FOV');await page.setViewportSize({width:1200,height:700});await page.waitForTimeout(100);if(await page.evaluate(()=>__sim.camera.fov)!==56)throw Error('Landscape FOV');results.push('Camera lens updates on orientation change');
 const compiler=await page.evaluate(async()=>{
  const sources=['using namespace std','using namespace std;','void loop(){ auto x = [','void loop(int a[','namespace Test {'];const results=[];
  for(const text of sources){
   const code=`import {compileFiles} from 'http://127.0.0.1:8766/js/cpp.js';import {RUNTIME_INFO} from 'http://127.0.0.1:8766/js/nrl.js';onmessage=e=>{try{compileFiles([{name:'test.cpp',text:e.data}],RUNTIME_INFO);postMessage('ok')}catch(e){postMessage(e.message)}}`;
   const worker=new Worker(URL.createObjectURL(new Blob([code],{type:'text/javascript'})),{type:'module'});
   const answer=await new Promise(resolve=>{const timer=setTimeout(()=>{worker.terminate();resolve('TIMEOUT')},2000);worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data)};worker.postMessage(text)});results.push({text,answer});
  }return results;
 });if(compiler.some(x=>x.answer==='TIMEOUT'))throw Error(JSON.stringify(compiler));
 console.log(JSON.stringify({passed:results,compiler,pageErrors:errors},null,2));
 fs.writeFileSync('security-regression-results.json',JSON.stringify({passed:results,compiler,pageErrors:errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

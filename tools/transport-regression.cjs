const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/adity/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8766')?r.continue():r.abort());await page.goto('http://127.0.0.1:8766');await page.waitForFunction(()=>window.__sim);
 console.log(await page.evaluate(async()=>{
 const {Account}=await import('/js/account.js'),{Room}=await import('/js/net.js'),{Online}=await import('/js/online.js');const saved=Account.client;const channels=[],state={},checks=[];
 const assert=(x,s)=>{if(!x)throw Error(s);checks.push(s)};
 Account.client={channel(name,opts){const handlers=[];const channel={handlers,on(type,filter,fn){handlers.push({type,filter,fn});return this},subscribe(fn){setTimeout(()=>fn('SUBSCRIBED'),0)},async track(meta){state[opts.config.presence.key]=[meta];for(const c of channels)for(const h of c.handlers)if(h.type==='presence')h.fn()},presenceState(){return state},async send(message){for(const c of channels)if(c!==channel)for(const h of c.handlers)if(h.type==='broadcast'&&h.filter.event===message.event)await h.fn({payload:message.payload})},async untrack(){delete state[opts.config.presence.key]}};channels.push(channel);return channel},async removeChannel(){}};
 const host=new Room({code:'TEST',isHost:true,name:'Host'}),guest=new Room({code:'TEST',isHost:false,name:'Guest'});guest.connectToHost=()=>{};
 try{await host.open();await guest.open();await new Promise(r=>setTimeout(r,150));assert(guest.hostId===host.id,'Signed host discovery succeeds');
 const online=new Online({});online.role='guest';online.room=guest;online.lobby={phase:'game'};let menus=0;online.hooks.menu=()=>menus++;guest.on('msg',(from,m)=>online.onMsg(from,m));
 await host.ch.send({type:'broadcast',event:'msg',payload:{from:host.id,to:guest.id,m:{t:'menu'}}});assert(menus===0,'Unsigned relay impersonation is rejected at channel boundary');
 const signed=await host.signer.sign('msg',{to:guest.id,m:{t:'menu'}});await host.ch.send({type:'broadcast',event:'msg',payload:signed});assert(menus===1,'Real host command passes full relay path');await host.ch.send({type:'broadcast',event:'msg',payload:signed});assert(menus===1,'Replay is rejected at channel boundary');
 const attacker=new Room({code:'TEST',isHost:false,name:'Attacker'});attacker.connectToHost=()=>{};await attacker.open();try{await attacker.broadcast('msg',{to:guest.id,m:{t:'menu'}});assert(menus===1,'Signed room member cannot impersonate host commands');const forged=await attacker.signer.sign('msg',{to:guest.id,m:{t:'menu'}});forged.body.payload.from=host.id;await attacker.ch.send({type:'broadcast',event:'msg',payload:forged});assert(menus===1,'Signed envelope with forged host identity rejected')}finally{await attacker.close(false)}
 const {compileFiles}=await import('/js/cpp.js'),{RUNTIME_INFO}=await import('/js/nrl.js');assert(compileFiles([{name:'valid.cpp',text:'void loop() { int x = 1; x++; }'}],RUNTIME_INFO).js.includes('loop'),'Normal robot code still compiles');
 try{compileFiles([{name:'bad.cpp',text:'using namespace std'}],RUNTIME_INFO);throw Error('missing failure')}catch(e){assert(e.message.includes('Unexpected end'),'Malformed code reports an error immediately')}
 return checks;
 }finally{await guest.close(false);await host.close(false);Account.client=saved}
 }));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

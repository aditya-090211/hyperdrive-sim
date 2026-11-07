const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/adity/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');const fs=require('fs');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});const results={checks:[],errors:[]};let host,guest;try{
 const hc=await browser.newContext({viewport:{width:1366,height:768}}),gc=await browser.newContext();host=await hc.newPage();guest=await gc.newPage();
 for(const p of [host,guest])p.on('pageerror',e=>results.errors.push(e.message));
 await Promise.all([host.goto('https://hyperdrive-sim.vercel.app/sim'),guest.goto('https://hyperdrive-sim.vercel.app/sim')]);
 await Promise.all([host.waitForFunction(()=>window.__sim,{},{timeout:60000}),guest.waitForFunction(()=>window.__sim,{},{timeout:60000})]);results.checks.push('Public production site boots in two independent browsers');
 await host.evaluate(()=>__sim.ctx.startGame('match'));await host.locator('#btn-go').click();await host.waitForFunction(()=>__sim.game.state==='running');await host.locator('#scorebar').focus();await host.keyboard.press('Space');await host.waitForTimeout(100);if(await host.evaluate(()=>__sim.game.state)!=='running')throw Error('Scoreboard shortcut paused game');results.checks.push('Live Start match button and scoreboard shortcut work');
 await host.evaluate(()=>__sim.ctx.toMenu());
 const code=await host.evaluate(()=>__sim.net.host('Deployment check host'));results.checks.push('Fresh production multiplayer test room created');
 await guest.evaluate(code=>__sim.net.join(code,'Deployment check guest'),code);
 await guest.waitForFunction(()=>__sim.net.lobby?.players?.length>=2,{},{timeout:20000});results.checks.push('Guest joins and receives signed lobby');
 await guest.evaluate(()=>__sim.net.takeSeat(0));await host.waitForFunction(()=>__sim.net.lobby.seats[0]!==null,{},{timeout:10000});results.checks.push('Guest seat claim reaches host');
 await host.evaluate(()=>__sim.net.startMatch());await guest.waitForFunction(()=>__sim.net.inGame,{},{timeout:15000});await host.evaluate(()=>__sim.ctx.toggleStart());await guest.waitForFunction(()=>__sim.game.state==='running',{},{timeout:15000});
 const start=await host.evaluate(()=>__sim.robots[0].body.translation());await guest.keyboard.down('w');await guest.waitForTimeout(1200);await guest.keyboard.up('w');const end=await host.evaluate(()=>__sim.robots[0].body.translation());if(Math.hypot(end.x-start.x,end.z-start.z)<.02)throw Error('Remote guest driving did not move host robot');results.checks.push('Live guest keyboard control moves host-authoritative robot');
 results.link=await guest.evaluate(()=>__sim.net.hostLink());results.checks.push('Host state and physics mirrored to guest');
 }finally{for(const p of [guest,host])if(p)await p.evaluate(async()=>{if(window.__sim?.net.active)await __sim.net.leave()}).catch(()=>{});await browser.close();fs.writeFileSync('production-smoke-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))}})().catch(e=>{console.error(e);process.exitCode=1});

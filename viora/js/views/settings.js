import { getRefs, setRefs, DEFAULT_REFS, getControlRef, setControlRef, DEFAULT_CONTROL_HEX, hueOf } from '../color.js';

const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export async function mount(el, { store, toast }){
  async function render(){
    const profiles=await store.profiles.list();
    const active=await store.activeProfile();
    const s=store.settings();
    const refs=getRefs(), ctrl=getControlRef(), last=store.kv.get('hs_last',null);
    const counts={};
    for(const r of await store.readings.list()) counts[r.profileId]=(counts[r.profileId]||0)+1;

    el.innerHTML=`
    <div class="page-head"><h1>Settings</h1><p>Profiles, calibration and preferences. Everything is stored on this device only, unless you join a team.</p></div>
    <div class="stack">
      <div class="card">
        <h2>Profiles</h2>
        <p class="sub">Each person testing on this device gets a profile, so baselines and history stay separate. The team field groups players on the Team page.</p>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Name</th><th>Team</th><th>Readings</th><th></th></tr></thead>
          <tbody>${profiles.map(p=>`<tr data-id="${p.id}">
            <td><input class="inp" data-k="name" value="${esc(p.name)}" style="width:100%;max-width:200px" aria-label="Name"></td>
            <td><input class="inp" data-k="team" value="${esc(p.team)}" placeholder="none" style="width:100%;max-width:160px" aria-label="Team"></td>
            <td class="num">${counts[p.id]||0}</td>
            <td style="white-space:nowrap">${p.id===active.id?'<span class="sub" style="margin:0">Active</span>':`<button class="small" data-act="use">Use</button>`} <button class="small danger" data-act="del">Delete</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="row" style="margin-top:12px">
          <input class="inp" id="newName" placeholder="New profile name" style="flex:1;min-width:160px">
          <input class="inp" id="newTeam" placeholder="Team (optional)" style="width:160px">
          <button class="primary" id="add">Add profile</button>
        </div>
      </div>

      <div class="card">
        <h2>Calibration references</h2>
        <p class="sub">The colour rule interpolates between these three colours. Defaults come from the saliva trial (test tubes). Replace them with real strip readings: analyse a strip taken in a known state on the Check page, then press "Use last reading" on the matching row.</p>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Colour</th><th>Condition</th><th>Score</th><th>Hue</th><th></th></tr></thead>
          <tbody>${refs.map((r,i)=>`<tr data-i="${i}">
            <td><input type="color" data-k="hex" value="${r.hex}" aria-label="Reference colour"></td>
            <td><input class="inp" data-k="name" value="${esc(r.name)}" style="width:100%;min-width:140px"></td>
            <td><input class="inp" data-k="score" type="number" min="0" max="100" value="${r.score}" style="width:70px"></td>
            <td class="num">${Math.round(hueOf(r.hex))} deg</td>
            <td><button class="small" data-act="last" ${last?'':'disabled'}>Use last reading</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="row" style="margin-top:12px"><button id="refReset">Restore trial defaults</button>${last?`<span class="sub" style="margin:0">Last reading <span class="swatch-sm" style="background:${last.hex}"></span> ${last.hex}</span>`:''}</div>
      </div>

      <div class="card">
        <h2>Control pad standard</h2>
        <p class="sub">The expected colour of a fresh, dry indicator pad. Each strip's control pad is compared with this, and the test colour is shifted by the difference, which cancels out paper and extract batch variation. After making a new batch, analyse a fresh strip on the card and press "Use last control pad".</p>
        <div class="row">
          <input type="color" id="ctrl" value="${ctrl}" aria-label="Control colour">
          <span class="sub" style="margin:0">${ctrl} (hue ${Math.round(hueOf(ctrl))} deg)</span>
          <button class="small" id="ctrlLast" ${last&&last.controlHex?'':'disabled'}>Use last control pad</button>
          <button class="small" id="ctrlReset">Default</button>
        </div>
      </div>

      <div class="card">
        <h2>Preferences</h2>
        <div class="grid2" style="margin:8px 0 0">
          <label class="field">Daily water goal (ml)<input type="number" id="goal" min="500" max="6000" step="100" value="${s.intakeGoalMl}"></label>
          <label class="field">Drink reminders
            <select id="rem">${[0,30,60,90,120].map(m=>`<option value="${m}"${s.reminderMins===m?' selected':''}>${m?`Every ${m} minutes without a drink`:'Off'}</option>`).join('')}</select>
          </label>
        </div>
        <label class="switch" style="margin-top:14px"><input type="checkbox" id="study" ${s.studyMode?'checked':''}> Study mode (ask for labels such as urine colour on every reading)</label>
      </div>

      <div class="card">
        <h2>Team sync</h2>
        <p class="sub">Join a team so a coach can see readings live. Requires the site to be running from <code>server.py</code>. Only scores, bands and tags are shared, never photos.</p>
        <div class="grid2" style="margin:8px 0 0">
          <label class="field">Team code<input id="code" value="${esc(s.teamCode)}" placeholder="e.g. u16-football"></label>
          <label class="field">Server address (blank = this site)<input id="url" value="${esc(s.syncUrl)}" placeholder="http://192.168.1.20:8460"></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="primary" id="saveSync">Save team settings</button></div>
      </div>

      <div class="card">
        <h2>Data</h2>
        <p class="sub">Download everything as JSON for backup, or delete all readings for the active profile.</p>
        <div class="row"><button id="backup">Download backup</button><button class="danger" id="wipe">Delete ${esc(active.name)}'s readings</button></div>
      </div>
    </div>`;

    const $=q=>el.querySelector(q);
    // profiles
    el.querySelectorAll('tr[data-id]').forEach(tr=>{
      const id=tr.dataset.id, p=profiles.find(x=>x.id===id);
      tr.querySelectorAll('input').forEach(inp=>inp.onchange=async()=>{ p[inp.dataset.k]=inp.value.trim(); if(!p.name) p.name='Player'; await store.profiles.update(p); toast('Profile updated'); });
      const use=tr.querySelector('[data-act=use]'); if(use) use.onclick=()=>{ store.setActiveProfile(id); render(); };
      tr.querySelector('[data-act=del]').onclick=async()=>{
        if(!confirm(`Delete ${p.name} and all ${counts[id]||0} of their readings? This cannot be undone.`)) return;
        await store.profiles.remove(id); render();
      };
    });
    $('#add').onclick=async()=>{
      const name=$('#newName').value.trim(); if(!name){ $('#newName').focus(); return; }
      const p=await store.profiles.add({ name, team:$('#newTeam').value.trim() });
      store.setActiveProfile(p.id); toast(`Switched to ${p.name}`); render();
    };
    // refs
    el.querySelectorAll('tr[data-i]').forEach(tr=>{
      const i=+tr.dataset.i;
      tr.querySelectorAll('input').forEach(inp=>inp.onchange=()=>{
        const r=getRefs(); r[i][inp.dataset.k]=inp.dataset.k==='score'?Math.max(0,Math.min(100,+inp.value||0)):inp.value; setRefs(r); render();
      });
      tr.querySelector('[data-act=last]').onclick=()=>{ const r=getRefs(); r[i].hex=last.hex; setRefs(r); toast('Reference updated'); render(); };
    });
    $('#refReset').onclick=()=>{ setRefs(DEFAULT_REFS.map(r=>({...r}))); render(); };
    $('#ctrl').onchange=e=>{ setControlRef(e.target.value); render(); };
    $('#ctrlLast').onclick=()=>{ setControlRef(last.controlHex); toast('Control standard updated'); render(); };
    $('#ctrlReset').onclick=()=>{ setControlRef(DEFAULT_CONTROL_HEX); render(); };
    // prefs
    $('#goal').onchange=e=>store.setSettings({ intakeGoalMl:Math.max(500,+e.target.value||2000) });
    $('#rem').onchange=e=>store.setSettings({ reminderMins:+e.target.value });
    $('#study').onchange=e=>store.setSettings({ studyMode:e.target.checked });
    $('#saveSync').onclick=()=>{
      const code=$('#code').value.trim().toLowerCase();
      if(code && !/^[a-z0-9-]{3,32}$/.test(code)){ toast('Team code: 3 to 32 letters, numbers or dashes'); return; }
      store.setSettings({ teamCode:code, syncUrl:$('#url').value.trim().replace(/\/$/,'') });
      toast(code?`Joined team ${code}`:'Team sync off');
    };
    $('#backup').onclick=async()=>{
      const data={ exportedAt:new Date().toISOString(), profiles:await store.profiles.list(), readings:await store.readings.list(), intake:await store.intake.list(), settings:store.settings(), refs:getRefs(), control:getControlRef() };
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      a.download=`viora-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    };
    $('#wipe').onclick=async()=>{
      const list=await store.readings.list({profileId:active.id});
      if(!list.length){ toast('No readings to delete'); return; }
      if(!confirm(`Permanently delete ${list.length} readings for ${active.name}? This cannot be undone.`)) return;
      for(const r of list) await store.readings.remove(r.id);
      toast('Readings deleted'); render();
    };
  }
  await render();
}

// Local data layer: IndexedDB for profiles, readings and water intake; localStorage for settings.
const DB_NAME='hydrastrip', DB_VER=1;
let dbp=null;
function db(){
  if(dbp) return dbp;
  dbp=new Promise((resolve,reject)=>{
    const rq=indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded=()=>{
      const d=rq.result;
      if(!d.objectStoreNames.contains('profiles')) d.createObjectStore('profiles',{keyPath:'id'});
      if(!d.objectStoreNames.contains('readings')){ const s=d.createObjectStore('readings',{keyPath:'id'}); s.createIndex('profileId','profileId'); }
      if(!d.objectStoreNames.contains('intake')){ const s=d.createObjectStore('intake',{keyPath:'id'}); s.createIndex('profileId','profileId'); }
    };
    rq.onsuccess=()=>resolve(rq.result);
    rq.onerror=()=>reject(rq.error);
  });
  return dbp;
}
function tx(name, mode, fn){
  return db().then(d=>new Promise((resolve,reject)=>{
    const t=d.transaction(name, mode), s=t.objectStore(name);
    let out; const r=fn(s);
    if(r && 'onsuccess' in r) r.onsuccess=()=>{ out=r.result; };
    t.oncomplete=()=>resolve(out);
    t.onerror=()=>reject(t.error);
    t.onabort=()=>reject(t.error);
  }));
}
const all=(name)=>tx(name,'readonly',s=>s.getAll());
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

const listeners=new Set();
function emit(kind){ listeners.forEach(fn=>{ try{ fn({kind}); }catch(e){ console.error(e); } }); }

const kv={
  get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
};
const DEFAULT_SETTINGS={ intakeGoalMl:2000, reminderMins:0, studyMode:false, teamCode:'', syncUrl:'' };

export const store={
  kv,
  on(ev, fn){ if(ev==='change') listeners.add(fn); return ()=>listeners.delete(fn); },
  settings(){ return { ...DEFAULT_SETTINGS, ...kv.get('hs_settings',{}) }; },
  setSettings(patch){ kv.set('hs_settings',{ ...store.settings(), ...patch }); emit('settings'); },

  profiles:{
    async list(){ return (await all('profiles')).sort((a,b)=>a.name.localeCompare(b.name)); },
    async add({name, team=''}){ const p={ id:uid(), name:String(name||'Player').trim()||'Player', team, createdAt:Date.now() }; await tx('profiles','readwrite',s=>s.put(p)); emit('profiles'); return p; },
    async update(p){ await tx('profiles','readwrite',s=>s.put(p)); emit('profiles'); },
    async remove(id){
      await tx('profiles','readwrite',s=>s.delete(id));
      for(const r of await store.readings.list({profileId:id})) await tx('readings','readwrite',s=>s.delete(r.id));
      for(const r of await store.intake.list({profileId:id})) await tx('intake','readwrite',s=>s.delete(r.id));
      if(kv.get('hs_active',null)===id) kv.set('hs_active',null);
      emit('profiles'); emit('readings'); emit('intake');
    }
  },
  async activeProfile(){
    const list=await store.profiles.list();
    const id=kv.get('hs_active',null);
    let p=list.find(x=>x.id===id) || list[0];
    if(!p) p=await store.profiles.add({name:'Me'});
    if(p.id!==id) kv.set('hs_active',p.id);
    return p;
  },
  setActiveProfile(id){ kv.set('hs_active',id); emit('profiles'); },

  readings:{
    async add(r){ r={ ...r, id:r.id||uid() }; await tx('readings','readwrite',s=>s.put(r)); emit('readings'); return r.id; },
    async update(r){ await tx('readings','readwrite',s=>s.put(r)); emit('readings'); },
    async remove(id){ await tx('readings','readwrite',s=>s.delete(id)); emit('readings'); },
    async get(id){ return tx('readings','readonly',s=>s.get(id)); },
    async list({profileId}={}){
      const rows=await all('readings');
      return rows.filter(r=>!profileId || r.profileId===profileId).sort((a,b)=>a.t-b.t);
    }
  },
  intake:{
    async add({profileId, ml, t=Date.now()}){ const r={ id:uid(), profileId, ml:+ml, t }; await tx('intake','readwrite',s=>s.put(r)); emit('intake'); return r.id; },
    async remove(id){ await tx('intake','readwrite',s=>s.delete(id)); emit('intake'); },
    async list({profileId, from, to}={}){
      const rows=await all('intake');
      return rows.filter(r=>(!profileId||r.profileId===profileId)&&(from==null||r.t>=from)&&(to==null||r.t<to)).sort((a,b)=>a.t-b.t);
    }
  }
};

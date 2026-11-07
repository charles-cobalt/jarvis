/* MAMBA saving protection candidate. Local development only. */
(function(root){
'use strict';
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const stable=x=>x===undefined?'undefined':x===null?'null':Array.isArray(x)?'['+x.map(stable).join(',')+']':typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>stable(a)===stable(b);
const sameEntry=(key,a,b)=>{if(/^[cipst]:/.test(key)&&a&&b&&typeof a==='object'&&typeof b==='object'){const clean=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['mod','at','edited','editedAt'].includes(k)));return equal(clean(a),clean(b));}return equal(a,b);};
const rid=()=>crypto.randomUUID();
function mergeOrder(b,m,r){if(!b||!m||!r)return null;const out={};for(const k of new Set([...Object.keys(b),...Object.keys(m),...Object.keys(r)])){const bb=b[k]||[],mm=m[k]||[],rr=r[k]||[];const reordered=a=>!equal(a.filter(x=>bb.includes(x)),bb.filter(x=>a.includes(x)));const mc=reordered(mm),rc=reordered(rr);if(mc&&rc&&!equal(mm,rr))return null;const seq=mc?mm:rr;out[k]=[...seq,...(mc?rr:mm).filter(x=>!seq.includes(x))];}return out;}
function reconcile(base,mine,remote,held={},times={},remoteTimes={}){
 const data=copy(remote)||{},conflicts=copy(held)||{},changed=[];
 for(const key of new Set([...Object.keys(base||{}),...Object.keys(mine||{}),...Object.keys(remote||{})])){
  const b=base&&base[key],m=mine&&mine[key],r=remote&&remote[key],eq=(a,b)=>sameEntry(key,a,b);
  if(conflicts[key]){
   if(!eq(m,b)&&!eq(m,r))addVersion(conflicts[key],m,times[key]||null,'This tab');
   continue;
  }
  if(eq(m,b)||eq(m,r))continue;
  if(eq(r,b)){
   if(m===undefined)delete data[key];else data[key]=copy(m);
   changed.push(key);
  }else{
   if(key==='@order'){const order=mergeOrder(b,m,r);if(order){data[key]=order;changed.push(key);continue;}}
   const c={id:rid(),key,base:copy(b),versions:[],created:Date.now()};
   addVersion(c,r,remoteTimes[key]||null,'Saved version');
   addVersion(c,m,times[key]||null,'This tab');
   conflicts[key]=c;
  }
 }
 return {data,conflicts,changed};
}
function addVersion(c,value,edited,source){
 if(c.versions.some(v=>sameEntry(c.key,v.value,value)))return;
 c.id=rid();c.versions.push({id:rid(),deleted:value===undefined,value:copy(value),edited:edited||null,source});
}
class SavingProtection{
 constructor(app){this.app=app;this.owner='';this.db=null;this.base={};this.times={};this.queue=Promise.resolve();this.state=null;this.tab=rid();this.error='';this.onchange=()=>{};this.channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('standalone-saving-v2-'+app):null;if(this.channel)this.channel.onmessage=e=>{if(e.data.owner===this.owner)this.refresh().catch(e=>this.fail(e))};}
 async open(owner,legacy){
  await this.queue;
  if(!this.db)this.db=await new Promise((res,rej)=>{const q=indexedDB.open('standalone-saving-v2-'+this.app,1);q.onupgradeneeded=()=>q.result.createObjectStore('owners');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);q.onblocked=()=>rej(new Error('Storage blocked by another tab'));});
  this.owner=owner||'anon';this.times={};
  const s=await this.tx(current=>current||{schema:2,rev:0,data:copy(legacy||{}),conflicts:{},drafts:{},times:{},history:[],migration:{at:Date.now(),source:copy(legacy||{})}});
  this.base=copy(s.data);this.state=s;return copy(s.data);
 }
 fail(e){this.error=String(e&&e.message||e);this.onchange();throw e;}
 tx(fn,expectedOwner=this.owner){
  return new Promise((res,rej)=>{let out;const t=this.db.transaction('owners','readwrite'),s=t.objectStore('owners'),q=s.get(expectedOwner);
   q.onsuccess=()=>{try{out=fn(q.result);if(out!==undefined)s.put(out,expectedOwner)}catch(e){t.abort();rej(e)}};
   t.oncomplete=()=>res(copy(out));t.onerror=t.onabort=()=>rej(t.error||new Error('Save did not complete'));q.onerror=()=>rej(q.error);
  });
 }
 async read(owner=this.owner){return new Promise((res,rej)=>{const t=this.db.transaction('owners','readonly'),q=t.objectStore('owners').get(owner);q.onsuccess=()=>res(copy(q.result));q.onerror=()=>rej(q.error);t.onabort=()=>rej(t.error)});}
 run(fn){const task=this.queue.then(fn);this.queue=task.catch(()=>{});return task.catch(e=>this.fail(e));}
 mark(keys,at=Date.now()){for(const k of keys)this.times[k]=at;}
 commit(mine,base){
  const owner=this.owner,m=copy(mine),explicitBase=copy(base),times=copy(this.times);
  return this.run(async()=>{
   const b=explicitBase===undefined?copy(this.base):explicitBase;
   const s=await this.tx(current=>{
    if(!current)throw new Error('Saved account copy is unavailable');
    const r=reconcile(b,m,current.data,current.conflicts,times,current.times);
    for(const k of r.changed){current.history.push({kind:'saved-version',key:k,value:copy(current.data[k]),deleted:current.data[k]===undefined,edited:current.times[k]||null,at:Date.now()});current.times[k]=times[k]||null;}
    current.data=r.data;current.conflicts=r.conflicts;current.rev++;return current;
   },owner);
   if(owner===this.owner){this.state=s;this.base=copy(s.data);this.error='';this.notify();}
   return {data:copy(s.data),conflicts:copy(s.conflicts),owner};
  });
 }
 async refresh(){const owner=this.owner,s=await this.read(owner);if(owner!==this.owner)return;if(s&&(!this.state||s.rev!==this.state.rev)){this.state=s;this.onchange();}return s;}
 notify(){if(this.channel)this.channel.postMessage({owner:this.owner});this.onchange();}
 hold(key,versions,base){const owner=this.owner;return this.run(async()=>{const s=await this.tx(c=>{let h=c.conflicts[key];if(!h)h=c.conflicts[key]={id:rid(),key,base:copy(base),created:Date.now(),versions:[]};for(const v of versions)addVersion(h,v.value,v.edited,v.source);c.rev++;return c;},owner);if(owner===this.owner){this.state=s;this.notify();}return s;});}
 resolve(key,conflictId,versionId){const owner=this.owner;return this.run(async()=>{const s=await this.tx(c=>{
   const h=c.conflicts[key];if(!h||h.id!==conflictId)throw new Error('The versions changed. Review them again.');const v=h.versions.find(v=>v.id===versionId);if(!v)throw new Error('That version is no longer available');
   c.history.push({kind:'review-choice',conflict:copy(h),chosen:versionId,at:Date.now()});c.decisions=c.decisions||{};c.decisions[key]={chosen:copy(v),versions:copy(h.versions),at:Date.now()};
   if(v.deleted)delete c.data[key];else c.data[key]=copy(v.value);c.times[key]=v.edited||null;delete c.conflicts[key];c.rev++;return c;
  },owner);if(owner===this.owner){this.state=s;this.base=copy(s.data);this.notify();}return copy(s.data);});}
 draft(slot,value,base=this.base,expectedOwner=this.owner){this.draftPending=(this.draftPending||0)+1;this.onchange();const owner=expectedOwner,key=this.tab+':'+slot,v=copy(value),b=copy(base);return this.run(async()=>{const s=await this.tx(c=>{const prev=c.drafts[key];if(!prev||!equal(prev.value,v)){c.drafts[key]={id:key,slot,value:v,base:b,edited:Date.now(),tab:this.tab};c.rev++;}return c;},owner);if(owner===this.owner){this.state=s;this.error='';this.notify();}return key;}).finally(()=>{this.draftPending--;this.onchange();});}
 removeDraft(id){const owner=this.owner;return this.run(async()=>{const s=await this.tx(c=>{if(c.drafts[id]){c.history.push({kind:'finished-draft',draft:copy(c.drafts[id]),at:Date.now()});delete c.drafts[id];c.rev++;}return c;},owner);if(owner===this.owner){this.state=s;this.notify();}});}
 reviewed(key,mine,remote){const d=this.state.decisions&&this.state.decisions[key];return !!(d&&sameEntry(key,mine,d.chosen.deleted?undefined:d.chosen.value)&&d.versions.some(v=>sameEntry(key,remote,v.deleted?undefined:v.value)));}
 cloudReview(mine,remote,remoteTimes={}){const initial=this.state.migration&&this.state.migration.source||{},base=this.state.cloud||{'@order':initial['@order']};const r=reconcile(base,mine,remote,this.state.conflicts||{},{...this.state.times,...this.times},remoteTimes);for(const [key,d] of Object.entries(this.state.decisions||{})){if(r.conflicts[key]&&sameEntry(key,mine[key],d.chosen.deleted?undefined:d.chosen.value)&&d.versions.some(v=>sameEntry(key,remote[key],v.deleted?undefined:v.value))){delete r.conflicts[key];if(mine[key]===undefined)delete r.data[key];else r.data[key]=copy(mine[key]);}}return r;}
 exportCopies(){const s=this.state;return {format:'mamba-protected-copies',version:1,app:this.app,exported:new Date().toISOString(),copies:copy({data:s.data,conflicts:s.conflicts,drafts:s.drafts,times:s.times,history:s.history})};}
 importCopies(file){if(!file||file.format!=='mamba-protected-copies'||file.version!==1||file.app!==this.app||!file.copies||typeof file.copies.data!=='object'||!file.copies.data)throw new Error('That is not a protected copies backup for this section.');const payload=copy(file.copies),owner=this.owner;const valid=k=>k==='@order'||(this.app==='listo'?/^[cps]:/.test(k):this.app==='jarvis'?/^(i:|d:|p:|b$|o:)/.test(k):/^(t:|cfg:)/.test(k));return this.run(async()=>{const s=await this.tx(c=>{
  const hold=(key,value,edited,source)=>{if(!valid(key))return;let h=c.conflicts[key];if(!h){h=c.conflicts[key]={id:rid(),key,created:Date.now(),versions:[]};addVersion(h,c.data[key],c.times[key]||null,'Current saved copy');}addVersion(h,value,typeof edited==='number'?edited:null,source);};
  for(const [k,v] of Object.entries(payload.data))if(valid(k)&&!sameEntry(k,c.data[k],v))hold(k,v,payload.times&&payload.times[k],'Imported saved copy');
  for(const h of Object.values(payload.conflicts||{}))if(h&&valid(h.key)&&Array.isArray(h.versions))for(const v of h.versions)if(v&&typeof v==='object')hold(h.key,v.deleted?undefined:v.value,v.edited,'Imported held version');
  for(const d of Object.values(payload.drafts||{}))if(d&&d.value&&typeof d.value==='object'){const id='import:'+rid();c.drafts[id]={id,slot:id,value:copy(d.value),base:copy(d.base||{}),edited:typeof d.edited==='number'?d.edited:null,tab:'import'};}
  for(const e of payload.history||[]){if(e&&e.kind==='review-choice'&&e.conflict&&valid(e.conflict.key)&&Array.isArray(e.conflict.versions)){const h={key:e.conflict.key,versions:e.conflict.versions.filter(v=>v&&typeof v==='object').map(v=>({id:rid(),value:copy(v.value),deleted:!!v.deleted,edited:typeof v.edited==='number'?v.edited:null,source:'Imported history'}))};c.history.push({kind:'review-choice',conflict:h,at:typeof e.at==='number'?e.at:Date.now()});}else if(e&&e.kind==='finished-draft'&&e.draft&&e.draft.value){const id='import:'+rid();c.history.push({kind:'finished-draft',draft:{...copy(e.draft),id,slot:id,tab:'import'},at:typeof e.at==='number'?e.at:Date.now()});}else if(e&&e.kind==='saved-version'&&valid(e.key)){c.history.push({kind:'review-choice',conflict:{key:e.key,versions:[{id:rid(),value:copy(e.value),deleted:!!e.deleted,edited:typeof e.edited==='number'?e.edited:null,source:'Imported prior saved version'}]},at:typeof e.at==='number'?e.at:Date.now()});}}
  c.rev++;return c;},owner);if(owner===this.owner){this.state=s;this.notify();}return s;});}
 snapshotReview(name,mine,remote){const snapshot=this.state.snapshots&&this.state.snapshots[name],base=snapshot&&snapshot.data||{};const r=reconcile(base,mine,remote,{},this.state.times||{});for(const key of Object.keys(r.conflicts)){if(this.reviewed(key,mine[key],remote[key])){delete r.conflicts[key];if(mine[key]===undefined)delete r.data[key];else r.data[key]=copy(mine[key]);}}return r;}
 rememberSnapshot(name,data,order){const owner=this.owner,d=copy(data),o=copy(order);return this.run(async()=>{const s=await this.tx(c=>{c.snapshots=c.snapshots||{};c.snapshots[name]={data:d,order:o};c.rev++;return c;},owner);if(owner===this.owner){this.state=s;this.notify();}return s;});}
 rememberCloud(data){const owner=this.owner,d=copy(data);return this.run(async()=>{const s=await this.tx(c=>{c.cloud=d;c.rev++;return c;},owner);if(owner===this.owner){this.state=s;this.notify();}return s;});}
 legacyChanged(slot,value){const owner=this.owner,v=copy(value);return this.run(async()=>{let changed=false;const s=await this.tx(c=>{c.legacySeen=c.legacySeen||{};changed=Object.prototype.hasOwnProperty.call(c.legacySeen,slot)&&!equal(c.legacySeen[slot],v);c.legacySeen[slot]=v;c.rev++;return c;},owner);if(owner===this.owner)this.state=s;return changed;});}
 async close(){await this.queue;if(this.channel)this.channel.close();if(this.db)this.db.close();}
}
SavingProtection.reconcile=reconcile;SavingProtection.equal=equal;SavingProtection.copy=copy;root.SavingProtection=SavingProtection;
if(typeof module!=='undefined')module.exports=SavingProtection;
})(typeof window!=='undefined'?window:globalThis);

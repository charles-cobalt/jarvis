/* Shared inline draft/review controls. Inherits each MAMBA section's theme. */
(function(){
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=t=>t?new Date(t).toLocaleString():'Edit time not recorded';
const friendly=k=>({'@order':'Order','@cfg':'Journal settings','b':'Body settings'}[k]||k.replace(/^.*?:/,''));
const fieldName=k=>({n:'Item',q:'Quantity',u:'Unit',sym:'Symbol',instr:'Instructions',desc:'Description',mult:'Multiplier',serv:'Servings',dserv:'Default servings',qty:'Quantities',done:'Completed',ts:'Scheduled',initial:'Initial notes',entry:'Entry',exit:'Exit'}[k]||k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' '));
function readable(value){
 if(value===undefined)return 'Not recorded';if(value===null)return 'None';
 if(typeof value==='boolean')return value?'Yes':'No';
 if(typeof value==='string'&&value.startsWith('data:image/'))return '<img class="sp-image" src="'+esc(value)+'" alt="Saved screenshot">';
 if(Array.isArray(value))return value.length?'<ul class="sp-values">'+value.map(v=>'<li>'+readable(v)+'</li>').join('')+'</ul>':'<span class="mu">None</span>';
 if(typeof value==='object'){const fields=Object.entries(value).filter(([k])=>k!=='id');return fields.length?'<div class="sp-nested">'+fields.map(([k,v])=>'<div class="sp-subfield"><span class="mu">'+esc(fieldName(k))+': </span>'+readable(v)+'</div>').join('')+'</div>':'<span class="mu">None</span>';}
 return esc(value);
}
function viewValue(value){
 if(value===undefined)return '<p class="mu">Deleted</p>';
 const fields=typeof value==='object'&&value!==null&&!Array.isArray(value)?Object.entries(value):[['Value',value]];
 return fields.filter(([k])=>k!=='id').map(([k,v])=>'<div class="sp-field"><span class="mu">'+esc(fieldName(k))+'</span><div>'+readable(v)+'</div></div>').join('');
}
window.installSavingPanel=(g,hooks)=>{
 let expanded=false,showHistory=false,detail=null,note='',busy=false,settingsOpen=false;
 if(!document.getElementById('sp-style')){const style=document.createElement('style');style.id='sp-style';style.textContent='.sp-panel{box-sizing:border-box;margin:12px 0 16px;overflow-wrap:anywhere}.sp-panel.card{display:block;padding:14px}.sp-panel p{font-size:13px;line-height:1.5;margin:4px 0 10px}.sp-panel .row{gap:8px;flex-wrap:wrap}.sp-panel .btn{box-sizing:border-box;flex:1;min-width:100px;margin-top:8px;min-height:40px;height:auto;white-space:normal}.sp-panel summary{cursor:pointer;font-size:13px;line-height:1.5}.sp-field{font-size:12px;line-height:1.5;border-bottom:1px solid var(--line,#555);padding:7px 0;white-space:pre-wrap;max-height:240px;overflow:auto}.sp-values{margin:4px 0;padding-left:18px}.sp-values li{padding:3px 0}.sp-nested{padding-left:8px}.sp-subfield{padding:3px 0}.sp-field>.mu{display:block;font-size:10px;text-transform:uppercase}.sp-image{max-width:100%;max-height:300px;object-fit:contain}.sp-version{border:1px solid var(--line,#555);padding:10px;margin:10px 0}.sp-panel h2,.sp-panel h3{margin:0 0 8px}.sp-panel .sp-status{font-size:12px}.sp-panel .sp-error{color:var(--y,#ceac70)}';document.head.appendChild(style);}
 const render=()=>{
  const old=document.getElementById('sp-panel');if(old)old.remove();if(!g.state)return;
  const held=Object.values(g.state.conflicts||{}),drafts=Object.values(g.state.drafts||{}),history=(g.state.history||[]).filter(h=>h.kind==='review-choice'||h.kind==='finished-draft');const attention=held.length>0||!!g.error,settings=!!(hooks.settings&&hooks.settings());if(!attention&&!settings)return;
  const host=hooks.host(),panel=document.createElement(attention?'section':'details');panel.id='sp-panel';panel.className='sp-panel card';panel.setAttribute('aria-label','Drafts and saving review');
  let h=attention?'<h2>Saving needs attention</h2>':'<summary>Saved drafts &amp; history</summary>'; 
  if(g.error)h+='<p class="sp-error" role="alert">The latest change is not saved. Keep this tab open. '+esc(g.error)+'</p>';
  else if(held.length)h+='<p>'+held.length+' saved '+(held.length===1?'entry has':'entries have')+' different versions. Replacing one could lose content. Compare them before choosing. Some changes may come from an older app copy.</p>';
  else if(drafts.length)h+='<p>'+drafts.length+' unfinished '+(drafts.length===1?'draft is':'drafts are')+' kept on this device.</p>';
  if(note)h+='<p role="status">'+esc(note)+'</p>';
  h+='<button type="button" class="btn sec" data-sp="toggle">'+(expanded?'Hide copies':held.length?'Compare held versions':'Show saved drafts')+'</button>';
  if(expanded){
   held.forEach(c=>{h+='<div class="sp-version"><h3>'+esc(hooks.label(c.key,c.versions))+'</h3><p>Both versions stay kept until you choose. Choosing keeps the other version in local review history.</p>';
    const known=c.versions.every(v=>v.edited),latest=known?Math.max(...c.versions.map(v=>v.edited)):0;
    c.versions.forEach((v,i)=>{h+='<details'+(detail===v.id?' open':'')+'><summary>'+esc(v.source||'Version')+' '+(i+1)+' · '+esc(time(v.edited))+(known&&v.edited===latest?' <span style="display:inline-block;white-space:nowrap">Latest recorded edit</span>':'')+'</summary>'+viewValue(v.deleted?undefined:v.value)+'<button type="button" class="btn sec" data-sp="choose" data-key="'+esc(c.key)+'" data-conflict="'+esc(c.id)+'" data-version="'+esc(v.id)+'">'+(v.deleted?'Use this deletion':'Use this version')+'</button></details>';});
    if(!known)h+='<p class="mu">Some edit times are unknown. Opening a tab does not make its version newer.</p>';else h+='<p class="mu">Edit times come from device clocks, not when a tab was opened. Compare the content before choosing.</p>';
    h+='</div>';
   });
   drafts.forEach(d=>{h+='<div class="sp-version"><h3>'+esc(hooks.draftLabel(d))+'</h3><p>Draft · '+esc(time(d.edited))+'</p><details><summary>Show draft</summary>'+viewValue(d.value)+'</details><div class="row"><button type="button" class="btn sec" data-sp="restore" data-draft="'+esc(d.id)+'">Continue draft</button><button type="button" class="btn sec" data-sp="discard" data-draft="'+esc(d.id)+'">Discard draft</button></div></div>';});
  }
  if(history.length){h+='<button type="button" class="btn sec" data-sp="history">'+(showHistory?'Hide local history':'Local review history')+'</button>';if(showHistory)history.forEach((entry,index)=>{h+='<div class="sp-version"><p>'+esc(time(entry.at))+'</p>';if(entry.kind==='review-choice'){h+='<h3>'+esc(hooks.label(entry.conflict.key,entry.conflict.versions))+'</h3>';entry.conflict.versions.forEach(v=>{h+='<details><summary>'+esc(v.source||'Kept version')+' · '+esc(time(v.edited))+'</summary>'+viewValue(v.deleted?undefined:v.value)+'<button type="button" class="btn sec" data-sp="review-history" data-history="'+index+'" data-version="'+esc(v.id)+'">Review this saved version</button></details>';});}else{h+='<h3>'+esc(hooks.draftLabel(entry.draft))+'</h3><details><summary>Show kept draft</summary>'+viewValue(entry.draft.value)+'<button type="button" class="btn sec" data-sp="restore-history" data-history="'+index+'">Continue this draft</button></details>';}h+='</div>';});}
  h+='<details style="margin-top:12px"><summary>Back up drafts &amp; review copies</summary><p>A separate local file includes saved entries, unfinished drafts, held versions and local review history. Keep it somewhere private. Ordinary section backups contain saved entries and settings only.</p><div class="row"><button type="button" class="btn sec" data-sp="export-copies">Download protected copies</button><button type="button" class="btn sec" data-sp="import-copies">Import protected copies</button></div><input type="file" accept="application/json,.json" data-sp-file hidden></details>';
  panel.innerHTML=h;if(!attention){panel.open=settingsOpen;panel.ontoggle=()=>{settingsOpen=panel.open;};}const top=host.querySelector(':scope > .twrap,:scope > .top,:scope > .hdsp');if(top)top.after(panel);else host.prepend(panel);
  panel.querySelector('[data-sp-file]').onchange=async e=>{const f=e.target.files[0];if(!f)return;busy=true;try{const file=JSON.parse(await f.text());if(file.format!=='mamba-protected-copies'||file.app!==g.app)throw new Error('Choose a protected copies file for this section.');if(!confirm('Import these copies into the account open here? Different saved values will be held for review, not chosen automatically. Unfinished drafts and history will be kept separately.'))return;await hooks.capture();await g.importCopies(file);expanded=true;showHistory=true;note='Imported copies kept. Review differences before choosing a version.';}catch(e){note=e.message||'That file could not be imported.';}finally{busy=false;render();}};
  panel.onclick=async e=>{const b=e.target.closest('[data-sp]');if(!b||busy)return;e.preventDefault();e.stopPropagation();const a=b.dataset.sp;
   if(a==='toggle'){expanded=!expanded;render();return;}
   if(a==='history'){showHistory=!showHistory;render();return;}
   if(a==='import-copies'){panel.querySelector('[data-sp-file]').click();return;}
   busy=true;b.disabled=true;try{
    if(a==='export-copies'){await hooks.capture();await g.queue;await g.refresh();const blob=new Blob([JSON.stringify(g.exportCopies(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='MAMBA '+g.app.toUpperCase()+' protected copies '+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),4000);note='Protected copies downloaded. Keep the file somewhere private.';
    }else if(a==='choose'){
     if(!confirm('Use this version for this entry? The other versions remain in local review history.'))return;
     if(hooks.editing()){await hooks.capture();note='Your open editor was kept as a separate draft.';}
     await g.resolve(b.dataset.key,b.dataset.conflict,b.dataset.version);await hooks.chosen(b.dataset.key);note='Choice saved. Other versions kept in local review history.';
    }else if(a==='restore'){
     const d=g.state.drafts[b.dataset.draft];if(!d)throw new Error('That draft changed. Review again.');if(hooks.editing())await hooks.capture();await hooks.restore(d);note='Draft opened. Review it, then Save.';
    }else if(a==='review-history'){
     const entry=history[+b.dataset.history],v=entry&&entry.conflict.versions.find(v=>v.id===b.dataset.version);if(!v)throw new Error('That kept version is unavailable.');await g.hold(entry.conflict.key,[{value:g.state.data[entry.conflict.key],source:'Current saved version'},{value:v.value,edited:v.edited,source:'Kept history version'}]);expanded=true;note='Compare the kept version with the current version before choosing.';
    }else if(a==='restore-history'){
     const d=history[+b.dataset.history].draft;if(hooks.editing())await hooks.capture();await hooks.restore(d);note='Kept draft opened. Review it, then Save.';
    }else if(a==='discard'){
     if(!confirm('Discard this unfinished draft? A local history copy is kept. Your saved entries are not changed.'))return;await g.removeDraft(b.dataset.draft);note='Draft moved to local history.';
    }
   }catch(e){note=e.message||'That action did not complete.';}finally{busy=false;render();}
  };
 };
 g.render=render;g.onchange=render;return render;
};
})();

const C='jarvis-saving-v2-shell',F=['saving-protection.js','saving-panel.js','./','index.html','manifest.webmanifest','icon.svg','fonts.css'],MAX=200;
const trim=c=>c.keys().then(k=>{const keep=new Set(F.map(f=>new URL(f,location.href).href));const dyn=k.filter(r=>!keep.has(r.url)),over=k.length-MAX;return over>0?Promise.all(dyn.slice(0,over).map(r=>c.delete(r))):null});
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('jarvis-')&&x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c).then(()=>trim(x)).catch(()=>{}));return r}).catch(()=>caches.match(e.request)))});

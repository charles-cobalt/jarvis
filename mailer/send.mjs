// Jarvis auto-email sender. Runs hourly in GitHub Actions. Reads opted-in accounts from Firestore,
// builds each statement with the app's own code (headless Chrome), sends summary + PDF.
import fs from 'fs';import crypto from 'crypto';import path from 'path';import {fileURLToPath} from 'url';
import puppeteer from 'puppeteer-core';
const HERE=path.dirname(fileURLToPath(import.meta.url)),APP=path.join(HERE,'..','index.html'),FONTSCSS=fs.readFileSync(path.join(HERE,'..','fonts.css'),'utf8');
const DRY=process.argv.includes('--dry'),SAMPLE=(process.argv.find(a=>a.startsWith('--sample='))||'').slice(9);
const SALT=process.env.MAIL_CODE_SALT||'dev-salt',SEND_HOUR=7;
const pad=n=>String(n).padStart(2,'0'),ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
function localNow(tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return new Date(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)}
// most recent COMPLETED period per cadence, as [from,to] local dates
export function periods(now){const t=new Date(now.getFullYear(),now.getMonth(),now.getDate()),o={};
 const lastSat=addD(t,-(t.getDay()+1));o.w=[addD(lastSat,-6),lastSat];           // Sun-Sat week
 const anchor=new Date(2026,0,3);const wk=Math.floor((lastSat-anchor)/864e5/7);   // Saturdays counted from Jan 3 2026
 const evenSat=wk%2===0?lastSat:addD(lastSat,-7);o.b=[addD(evenSat,-13),evenSat]; // two-week blocks ending on every other Saturday
 o.m=[new Date(t.getFullYear(),t.getMonth()-1,1),new Date(t.getFullYear(),t.getMonth(),0)];
 o.y=[new Date(t.getFullYear()-1,0,1),new Date(t.getFullYear()-1,11,31)];return o}
const NAME={w:'Weekly',b:'Bi-weekly',m:'Monthly',y:'Yearly'};
const hash=c=>crypto.createHash('sha256').update(String(c)+SALT).digest('hex');
async function render(page,data,opt){return page.evaluate((d,o)=>window.__jarvisReport(d,o),data,opt)}
function mailHtml(r,label,acct){return `<style>@font-face{font-family:DINish;font-weight:400;src:url(https://charles-cobalt.github.io/jarvis/dinish-400.ttf) format('truetype')}@font-face{font-family:DINish;font-weight:600;src:url(https://charles-cobalt.github.io/jarvis/dinish-600.ttf) format('truetype')}@font-face{font-family:DINish;font-weight:700;src:url(https://charles-cobalt.github.io/jarvis/dinish-700.ttf) format('truetype')}</style><div style="font-family:DINish,-apple-system,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;color:#111"><h1 style="font-size:20px;margin:0 0 4px">Jarvis ${label} statement</h1><div style="color:#666;font-size:13px;margin-bottom:12px">${r.from} to ${r.to}. The PDF is attached.</div>${r.html.replace(/var\(--mu\)/g,'#666').replace(/var\(--line\)/g,'#ddd').replace(/<svg[\s\S]*?<\/svg>/g,'0%').replace(/class="mu"/g,'style="color:#666;font-size:12px"').replace(/class="card p"/g,'style="border:1px solid #ddd;border-radius:8px;padding:10px"')}<div style="color:#888;font-size:11px;margin-top:18px">Sent because ${acct} turned on Auto emails in Jarvis Settings. To stop, open Settings > Auto emails and turn it Off.</div></div>`}
async function send(cfg,to,subject,html,text,att){
 if(DRY){fs.writeFileSync('/tmp/work/dump-'+Date.now()+'.html',html);if(att&&att[0])fs.writeFileSync('/tmp/work/dump.pdf',Buffer.from(att[0].b64,'base64'));console.log('DRY send',to,subject,html.length,'bytes html',att?att.length:0,'att');return}
 const prov=process.env.MAIL_PROVIDER||'brevo';
 if(prov==='brevo'){const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'content-type':'application/json'},body:JSON.stringify({sender:{name:'Jarvis',email:((process.env.MAIL_FROM||'').match(/[^<\s]+@[^>\s]+/)||[''])[0]},to:[{email:to}],subject,htmlContent:html,textContent:text,...((att&&att.length)?{attachment:att.map(a=>({name:a.name,content:a.b64}))}:{})})});if(!r.ok)throw new Error('brevo '+r.status+' '+(await r.text()).slice(0,200))}
 else{const nm=(await import('nodemailer')).default;const tr=nm.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});await tr.sendMail({from:'Jarvis <'+process.env.GMAIL_USER+'>',to,subject,html,text,attachments:(att||[]).map(a=>({filename:a.name,content:Buffer.from(a.b64,'base64')}))})}}
async function main(){
 let docs=[];let db=null;
 if(SAMPLE){docs=[JSON.parse(fs.readFileSync(SAMPLE,'utf8'))]}
 else{const admin=(await import('firebase-admin')).default;admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});db=admin.firestore();
  const snap=await db.collection('users').get();snap.forEach(d=>docs.push({uid:d.id,ref:d.ref,...d.data()}))}
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox']});
 for(const d of docs){try{
  const vit=JSON.parse(d.v||'{}'),m=vit.mail;if(!m||!m.on||!m.to)continue;const to=m.to.trim().toLowerCase();
  const st=d.mailState?(typeof d.mailState==='string'?JSON.parse(d.mailState):d.mailState):{},ns=Object.assign({},st);
  const acct=d.email||'a Jarvis account';
  // 1) confirmation
  if(st.verified!==to){
   if(st.pend&&st.pend.to===to){
    if(m.code&&hash(m.code)===st.pend.h){ns.verified=to;delete ns.pend;delete ns.err}
    else if(m.code&&m.code!==st.pend.tried){ns.err='That code did not match.';ns.pend=Object.assign({},st.pend,{tried:m.code})}
   }else{const code=String(crypto.randomInt(0,1e6)).padStart(6,'0');
    await send(null,to,'Your Jarvis confirmation code',`<p>Your Jarvis confirmation code is <b style="font-size:20px">${code}</b>.</p><p>Enter it in Jarvis under Settings > Auto emails. If you did not ask for this, ignore this email and nothing will be sent.</p>`,'Your Jarvis confirmation code: '+code);
    ns.pend={to,h:hash(code),at:Date.now()};delete ns.err}
  }
  // 2) reports
  if(ns.verified===to){
   const now=localNow(m.tz),P=periods(now),sent=Object.assign({},ns.sent||{});
   const jobs=[];
   if(m.test&&m.test>(ns.testDone||0)){jobs.push(['w',P.w,'Sample '])}
   if(now.getHours()>=SEND_HOUR)for(const c of Object.keys(NAME)){if(!(m.cad||{})[c])continue;const [a,b]=P[c];if(m.since&&ymd(b)<m.since)continue;if(sent[c]===ymd(b))continue;jobs.push([c,P[c],''])}
   for(const [c,[a,b],pre] of jobs){
    const page=await browser.newPage();if(m.tz)await page.emulateTimezone(m.tz).catch(()=>{});
    await page.goto('file://'+APP,{waitUntil:'domcontentloaded'});await page.waitForFunction('window.__jarvisReport',{timeout:20000});
    const r=await render(page,{items:JSON.parse(JSON.stringify(d.items||[])),vitals:vit},{per:'custom',from:ymd(a),to:ymd(b),cats:m.cats,met:m.met});
    if(r.err){ns.err=NAME[c]+': '+r.err;await page.close();continue}
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>'+FONTSCSS+'</style><style>h2{font:600 13px DINish,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#444;margin:18px 0 6px}</style></head><body style="font-family:DINish,Helvetica,Arial,sans-serif;margin:0;color:#111">'+r.html.replace(/var\(--mu\)/g,'#666').replace(/var\(--line\)/g,'#ddd')+'</body></html>',{waitUntil:'load'});
    await page.evaluateHandle('document.fonts.ready');
    const pdfB64=Buffer.from(await page.pdf({format:'Letter',printBackground:true,margin:{top:'40px',bottom:'40px',left:'40px',right:'40px'}})).toString('base64');
    await page.close();
    const label=pre+NAME[c].toLowerCase();
    await send(null,to,`Jarvis ${label} statement, ${r.from} to ${r.to}`,mailHtml(r,label,acct),r.txt,[{name:`jarvis-statement_${r.from}_to_${r.to}.pdf`,b64:pdfB64}]);
    if(pre)ns.testDone=Date.now();else sent[c]=ymd(b);ns.last=new Date().toISOString().slice(0,10)+' ('+label+')';delete ns.err}
   ns.sent=sent}
  if(JSON.stringify(ns)!==JSON.stringify(st)&&!DRY&&d.ref)await d.ref.set({mailState:JSON.stringify(ns)},{merge:true});
  if(DRY)console.log('state',JSON.stringify(ns));
 }catch(e){console.error('user',d.uid,e.message)}}
 await browser.close()}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e);process.exit(1)});

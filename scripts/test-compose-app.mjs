// Requiere pnpm build. Usa la aplicación compilada, sin credenciales ni conexiones reales.
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const folder = await mkdtemp(join(tmpdir(), 'namio-compose-app-'))
try {
  await writeFile(join(folder, 'preload.cjs'), `
const {contextBridge}=require('electron');const noop=()=>()=>{};
contextBridge.exposeInMainWorld('api',{
 getSettings:async()=>({onboarded:true,language:'es'}),setSettings:async()=>{},
 getCoreStatus:async()=>({appVersion:'test',stage:'M8',cacheUsage:null}),
 accountStatus:async()=>({configured:false,connected:false,account:null}),
 accounts:async()=>[],checkAccounts:async()=>[],listOutbox:async()=>[],
 getDraft:async()=>null,listDrafts:async()=>[],syncProgress:async()=>null,
 onCacheChanged:noop,onSyncProgress:noop,onAccountsActivity:noop,onOutboxChanged:noop,onRulesChanged:noop
});`)
  await writeFile(join(folder, 'drafts-preload.cjs'), `
const {contextBridge}=require('electron');const listeners=[];const meta={offline:false,syncedAt:1};
const remote={id:'remote-draft',to:'recipient@example.test',cc:'copy@example.test',bcc:'hidden@example.test',subject:'Borrador servidor',body:'Remote body',html:'<p><strong>Remote body</strong></p>',updatedAt:2,syncedAt:2,server:{path:'Drafts',uid:7,uidValidity:'1'}};
let drafts=[{id:'pending-draft',to:'local@example.test',cc:'',subject:'Pendiente local',body:'Local body',updatedAt:1}];
const envelope={uid:7,messageId:'<draft@example.test>',subject:remote.subject,from:{name:'Author',address:'author@example.test'},date:new Date().toISOString(),unread:false,flagged:false,size:100};
const boxes=[{path:'INBOX',name:'INBOX',specialUse:String.fromCharCode(92)+'Inbox',messages:0,unseen:0},{path:'Drafts',name:'Drafts',specialUse:String.fromCharCode(92)+'Drafts',messages:1,unseen:0}];
const noop=()=>()=>{};const notify=()=>listeners.forEach(fn=>fn('*'));
contextBridge.exposeInMainWorld('api',{
 getSettings:async()=>({onboarded:true,language:'es'}),setSettings:async()=>{},getCoreStatus:async()=>({appVersion:'test',stage:'M8',cacheUsage:null}),
 accountStatus:async()=>({configured:true,connected:true,passwordStored:true,account:{host:'mail.example.test',port:993,secure:true,user:'author@example.test',smtp:{host:'mail.example.test',port:465,secure:true}}}),
 accounts:async()=>[{id:'one',label:'Test',active:true,user:'author@example.test',host:'mail.example.test',port:993,auth:'password'}],checkAccounts:async()=>[],listOutbox:async()=>[],syncProgress:async()=>null,senderLogo:async()=>null,
 listMailboxes:async()=>({ok:true,data:boxes,meta}),listEnvelopes:async path=>({ok:true,data:path==='Drafts'?[envelope]:[],meta}),
 getMessage:async()=>({ok:true,data:{...envelope,to:[{name:'Recipient',address:remote.to}],cc:[],text:remote.body,html:remote.html,attachments:[]},meta}),
 listDrafts:async()=>drafts,getDraft:async id=>id?drafts.find(item=>item.id===id)??null:drafts[0]??null,
 openDraft:async()=>{if(!drafts.some(item=>item.id===remote.id))drafts.push(remote);return remote},
 saveDraft:async input=>{const previous=drafts.find(item=>item.id===input.id);drafts=drafts.filter(item=>item.id!==input.id);drafts.push({...previous,...input,id:input.id??'new-draft'});notify();return{id:input.id??'new-draft',queued:true}},
 clearDraft:async id=>{drafts=drafts.filter(item=>item.id!==id);notify()},inspectTestDrafts:async()=>drafts,
 onCacheChanged:fn=>{listeners.push(fn);return()=>{}},onSyncProgress:noop,onAccountsActivity:noop,onOutboxChanged:noop,onRulesChanged:noop
});`)
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const errors=[];
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:${JSON.stringify(join(folder,'preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 win.webContents.on('console-message',event=>{if(event.level==='error')errors.push('demo: '+event.message+' ['+event.sourceId+':'+event.lineNumber+']')});
 await win.loadFile(${JSON.stringify(join(process.cwd(),'out/renderer/index.html'))});
 win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 const until=async(predicate,message)=>{for(let i=0;i<100;i++){if(predicate())return;await wait()}throw new Error(message)};
 const settle=async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.querySelector('.composer').getAnimations().map(animation=>animation.finished.catch(()=>{})))};
 const compose=()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Redactar'));
 await until(compose,'Application did not load');
 for(let cycle=0;cycle<4;cycle++){
  compose().click();
  await until(()=>document.querySelector('.tiptap')?.editor,'Editor did not mount / blank screen');
  const editor=document.querySelector('.tiptap').editor;
  const bounds=()=>document.querySelector('.composer').getBoundingClientRect();
  await settle();
  const normal=bounds();
  document.querySelector('.composer__head [aria-label="Expandir"]').click();
  await until(()=>document.querySelector('.composer--expanded'),'Expand did not activate');
  if(!document.querySelector('.composer').getAnimations().some(animation=>animation.transitionProperty==='height'))throw new Error('Expand must animate the height change');
  await settle();
  const expanded=bounds();
  if(expanded.width<=normal.width||expanded.height<=normal.height)throw new Error('Expand must increase both width and height on desktop: '+JSON.stringify({normal:normal.toJSON(),expanded:expanded.toJSON()}));
  if(expanded.left<0||expanded.top<0||expanded.right>innerWidth||expanded.bottom>innerHeight)throw new Error('Expanded composer exceeds the viewport');
  document.querySelector('.composer__head [aria-label="Volver al tamaño anterior"]').click();
  await until(()=>!document.querySelector('.composer--expanded'),'Normal size did not restore');
  await settle();
  if(Math.abs(bounds().width-normal.width)>1||Math.abs(bounds().height-normal.height)>1)throw new Error('Restore did not recover original dimensions');

  if(editor.getText()!=='')throw new Error('New message retained previous content');
  if(document.querySelector('.subject-input').value!=='')throw new Error('New message retained the subject');
  editor.commands.insertContent('Mensaje de prueba '+cycle);
  editor.commands.selectAll();document.querySelector('[data-tooltip="Negrita"]').click();await wait();
  if(!editor.getHTML().includes('<strong>'))throw new Error('Cannot format after opening');
  if(!document.querySelector('.thread-list'))throw new Error('Mailbox unmounted while composing');
  document.querySelector('.composer__head [aria-label="Minimizar"]').click();
  await until(()=>document.querySelector('.composer-dock'),'Minimize did not dock');
  if(document.querySelector('.composer').getAttribute('aria-modal')!=='false')throw new Error('Minimized composer remains modal');
  if(getComputedStyle(document.querySelector('.composer__fields')).display!=='none')throw new Error('Fields still visible while minimized');
  compose().click();await until(()=>!document.querySelector('.composer-dock'),'Compose did not restore existing message');
  if(document.querySelector('.tiptap').editor!==editor||!editor.getHTML().includes('<strong>'))throw new Error('Minimize lost editor content or instance');
  document.querySelector('.send-caret').click();await until(()=>document.querySelector('.composer-send-options'),'Send options missing');
  document.querySelector('.composer-send-options button:last-child').click();

  await until(()=>!document.querySelector('.composer'),'Editor did not close');
  if(!compose()||!document.querySelector('.thread-list'))throw new Error('Mailbox disappeared after closing');
 }
})()`)});
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 document.querySelector('[aria-label="Redactar"]').click();
 await new Promise(resolve=>setTimeout(resolve,100));
 const composer=document.querySelector('.composer');
 if(getComputedStyle(composer).transitionDuration.split(',').some(value=>parseFloat(value)>0.01))throw new Error('Reduced motion must suppress resizing transitions');
 document.querySelector('.composer__head [aria-label="Cerrar"]').click();
})()`)});
 const live=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:${JSON.stringify(join(folder,'drafts-preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 live.webContents.on('console-message',event=>{if(event.level==='error')errors.push('live: '+event.message+' ['+event.sourceId+':'+event.lineNumber+']')});
 await live.loadFile(${JSON.stringify(join(process.cwd(),'out/renderer/index.html'))});
 live.webContents.debugger.attach('1.3');
 await live.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
 await live.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 const until=async(predicate,message)=>{for(let i=0;i<100;i++){if(predicate())return;await wait()}throw new Error(message)};
 const settle=async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.querySelector('.composer').getAnimations().map(animation=>animation.finished.catch(()=>{})))};
 const card=title=>[...document.querySelectorAll('.thread__content')].find(item=>item.textContent.includes(title));
 await until(()=>document.querySelector('[aria-label="Drafts"]'),'Drafts folder missing');document.querySelector('[aria-label="Drafts"]').click();
 await until(()=>card('Pendiente local')&&card('Borrador servidor'),'Drafts list did not combine remote and pending drafts');
 card('Borrador servidor').click();await until(()=>document.querySelector('.tiptap')?.editor,'Server draft did not open');
 let editor=document.querySelector('.tiptap').editor;
 if(!editor.getText().includes('Remote body')||!editor.getHTML().includes('<strong>'))throw new Error('Remote rich draft content missing');
 editor.commands.insertContent(' edited');document.querySelector('.composer__head [aria-label="Cerrar"]').click();
 await until(()=>!document.querySelector('.composer'),'Saving server draft did not close editor');
 let saved=await window.api.inspectTestDrafts();if(!saved.find(item=>item.id==='remote-draft')?.body.includes('edited'))throw new Error('Editing replaced the wrong draft');
 card('Pendiente local').click();await until(()=>document.querySelector('.tiptap')?.editor,'Local draft did not open');
 if(!document.querySelector('.tiptap').editor.getText().includes('Local body'))throw new Error('Wrong local draft');
 document.querySelector('.composer__foot .btn--danger').click();await until(()=>!document.querySelector('.composer'),'Discard did not close editor');
 saved=await window.api.inspectTestDrafts();if(saved.some(item=>item.id==='pending-draft')||!saved.some(item=>item.id==='remote-draft'))throw new Error('Discard affected another draft');
 document.querySelector('[aria-label="Redactar"]').click();await until(()=>document.querySelector('.tiptap')?.editor,'New composer missing');
 await settle();
 const normal=document.querySelector('.composer').getBoundingClientRect();
 document.querySelector('.composer__head [aria-label="Expandir"]').click();
 await until(()=>document.querySelector('.composer--expanded'),'Compact desktop did not expand');
 await settle();
 const expanded=document.querySelector('.composer').getBoundingClientRect();
 if(expanded.height<=normal.height||expanded.width<normal.width||expanded.bottom>innerHeight)throw new Error('Compact desktop expansion failed');
 document.querySelector('.composer__head [aria-label="Volver al tamaño anterior"]').click();
 await until(()=>!document.querySelector('.composer--expanded'),'Compact desktop did not restore');
 editor=document.querySelector('.tiptap').editor;if(editor.getText()!=='')throw new Error('New draft not empty');editor.commands.insertContent('New draft body');
 document.querySelector('.composer__head [aria-label="Minimizar"]').click();await until(()=>document.querySelector('.composer-dock'),'Live draft did not minimize');
 document.querySelector('.composer__head [aria-label="Restaurar mensaje"]').click();await until(()=>!document.querySelector('.composer-dock'),'Live draft did not restore');
 if(document.querySelector('.tiptap').editor!==editor||!editor.getText().includes('New draft body'))throw new Error('Saved minimize lost draft state');
 document.querySelector('.composer__head [aria-label="Cerrar"]').click();await until(()=>!document.querySelector('.composer'),'New draft did not save');
 saved=await window.api.inspectTestDrafts();if(saved.length!==2||!saved.some(item=>item.id==='new-draft'))throw new Error('Multiple drafts not preserved');
})()`)});
 if(errors.length)throw new Error(errors.join('\\n'));
 console.log('Drafts folder: remote editing, local pending drafts, independent discard and multiple saved drafts passed');
 console.log('Full app compose regression: lazy load, typing, formatting and four close/reopen cycles preserve the mailbox without renderer errors');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child = spawn(require('electron'), ['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')], {stdio:'inherit'})
  const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  if(code!==0)process.exitCode=1
} finally {await rm(folder,{recursive:true,force:true})}

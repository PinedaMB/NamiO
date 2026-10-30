// Requiere pnpm build. Usa la aplicación compilada, sin credenciales ni conexiones reales.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const folder = await mkdtemp(join(tmpdir(), 'namio-compose-app-'))
try {
  await writeFile(join(folder, 'preload.cjs'), `
const {contextBridge}=require('electron');const noop=()=>()=>{};const updateListeners=new Set();let updateState={phase:'downloading',version:'0.4.4',percent:42};let installs=0;
contextBridge.exposeInMainWorld('api',{
 updateStatus:async()=>updateState,onUpdateChanged:fn=>{updateListeners.add(fn);return()=>updateListeners.delete(fn)},checkForUpdates:async()=>{},installUpdate:async()=>{installs++},testUpdate:async next=>{updateState=next;updateListeners.forEach(fn=>fn(next))},testInstalls:async()=>installs,
 getSettings:async()=>({onboarded:true,language:'es'}),setSettings:async()=>{},
 getCoreStatus:async()=>({appVersion:'test',stage:'M8',cacheUsage:null}),
 accountStatus:async()=>({configured:false,connected:false,account:null}),
 accounts:async()=>[],checkAccounts:async()=>[],listOutbox:async()=>[],
 getDraft:async()=>null,listDrafts:async()=>[],syncProgress:async()=>null,
 onCacheChanged:noop,onSyncProgress:noop,onAccountsActivity:noop,onOutboxChanged:noop,onRulesChanged:noop
});`)
  await writeFile(join(folder, 'drafts-preload.cjs'), `
const {contextBridge}=require('electron');const listeners=[];const syncs=[];let inboxPresent=true,finishDelete,deleteCalls=0;const backgroundDeletes=[];const outboxListeners=[];let deletionJob=null;const meta={offline:false,syncedAt:1};
const remote={id:'remote-draft',to:'recipient@example.test',cc:'copy@example.test',bcc:'hidden@example.test',subject:'Borrador servidor',body:'Remote body',html:'<p><strong>Remote body</strong></p>',updatedAt:2,syncedAt:2,server:{path:'Drafts',uid:7,uidValidity:'1'}};
let draftSequence=0;let drafts=[{id:'pending-draft',to:'local@example.test',cc:'',subject:'Pendiente local',body:'Local body',updatedAt:1}];
const envelope={uid:7,messageId:'<draft@example.test>',subject:remote.subject,from:{name:'Author',address:'author@example.test'},date:new Date().toISOString(),unread:false,flagged:false,size:100};
const boxes=[{path:'INBOX',name:'INBOX',specialUse:String.fromCharCode(92)+'Inbox',messages:0,unseen:0},{path:'Drafts',name:'Drafts',specialUse:String.fromCharCode(92)+'Drafts',messages:1,unseen:0},{path:'Spam',name:'Spam',specialUse:String.fromCharCode(92)+'Junk',messages:2,unseen:0},{path:'Trash',name:'Trash',specialUse:String.fromCharCode(92)+'Trash',messages:2,unseen:0}];
const noop=()=>()=>{};const notify=()=>listeners.forEach(fn=>fn('*'));
contextBridge.exposeInMainWorld('api',{
 getSettings:async()=>({onboarded:true,language:'es'}),setSettings:async()=>{},getCoreStatus:async()=>({appVersion:'test',stage:'M8',cacheUsage:null}),
 accountStatus:async()=>({configured:true,connected:true,passwordStored:true,account:{host:'mail.example.test',port:993,secure:true,user:'author@example.test',smtp:{host:'mail.example.test',port:465,secure:true}}}),
 accounts:async()=>[{id:'one',label:'Test',active:true,user:'author@example.test',host:'mail.example.test',port:993,auth:'password'}],checkAccounts:async()=>[],listOutbox:async()=>deletionJob?[deletionJob]:[],syncProgress:async()=>null,senderLogo:async()=>null,
 listMailboxes:async()=>({ok:true,data:boxes,meta}),listEnvelopes:async path=>({ok:true,data:path==='Drafts'?[envelope]:inboxPresent?[{...envelope,uid:11,subject:'Inbox sample',messageId:'<inbox@example.test>'}]:[],meta}),
 getMessage:async(path,uid)=>({ok:true,data:{...envelope,uid,to:[{name:'Recipient',address:remote.to}],cc:[{name:"Visible copy",address:"copy@example.test"}],text:remote.body,html:remote.html,attachments:[]},meta}),
 deleteMessage:async(path,uid)=>{if(path!=='INBOX'||uid!==11)throw new Error('Wrong delete target');deleteCalls++;return new Promise(resolve=>{finishDelete=()=>{inboxPresent=false;notify();resolve({ok:true,queued:false})}})},finishTestDelete:async()=>finishDelete(),inspectTestDeleteCalls:async()=>deleteCalls,
 deleteMessages:async(path,uids)=>{backgroundDeletes.push({path,uids});deletionJob={id:'delete-job',kind:'delete-many',status:'queued',attempts:0,lastError:null,createdAt:1,label:path,deletionProgress:{completed:0,total:250,running:true}};outboxListeners.forEach(fn=>fn());return{ok:true,queued:true}},inspectTestBackgroundDeletes:async()=>backgroundDeletes,
 advanceTestDeletion:async(completed,running=true)=>{deletionJob.deletionProgress={completed,total:250,running};outboxListeners.forEach(fn=>fn())},finishTestDeletion:async()=>{deletionJob=null;outboxListeners.forEach(fn=>fn())},
 syncMailbox:async path=>{syncs.push(path);return{ok:true,data:true}},inspectTestSyncs:async()=>syncs,
 listDrafts:async()=>drafts,getDraft:async id=>id?drafts.find(item=>item.id===id)??null:drafts[0]??null,
 openDraft:async()=>{if(!drafts.some(item=>item.id===remote.id))drafts.push(remote);return remote},
 saveDraft:async input=>{const id=input.id??'new-draft-'+ ++draftSequence;const previous=drafts.find(item=>item.id===id);drafts=drafts.filter(item=>item.id!==id);drafts.push({...previous,...input,id});notify();return{id,queued:true}},
 clearDraft:async id=>{drafts=drafts.filter(item=>item.id!==id);notify()},inspectTestDrafts:async()=>drafts,
 onCacheChanged:fn=>{listeners.push(fn);return()=>{}},onSyncProgress:noop,onAccountsActivity:noop,onOutboxChanged:fn=>{outboxListeners.push(fn);return()=>{}},onRulesChanged:noop
});`)
  await writeFile(join(folder, 'onboarding-preload.cjs'), (await readFile(join(folder, 'preload.cjs'), 'utf8')).replace('onboarded:true', 'onboarded:false'))
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const errors=[];
 const captureMenu=async(window,path)=>{
   window.webContents.invalidate();
   await new Promise(resolve=>setTimeout(resolve,250));
   await require('node:fs/promises').writeFile(path,(await window.webContents.capturePage()).toPNG());
 };
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:${JSON.stringify(join(folder,'preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 win.webContents.on('console-message',event=>{if(event.level==='error')errors.push('demo: '+event.message+' ['+event.sourceId+':'+event.lineNumber+']')});
 await win.loadFile(${JSON.stringify(join(process.cwd(),'out/renderer/index.html'))});
 win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30))}throw new Error('Update notice missing')};
 await until(()=>document.querySelector('.update-notice [role="progressbar"]'));
 const bar=document.querySelector('.update-notice [role="progressbar"]');if(bar.getAttribute('aria-valuenow')!=='42')throw new Error('Incorrect update progress');
 await window.api.testUpdate({phase:'ready',version:'0.4.4'});
 await until(()=>document.querySelector('.update-notice button')?.textContent.includes('Reiniciar e instalar 0.4.4'));
})()`)});
 await captureMenu(win,'/tmp/namio-update-ready.png');
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 document.querySelector('.rail [aria-label="Configuración"]').click();
 for(let i=0;i<100&&!document.querySelector('.settings-nav');i++)await new Promise(r=>setTimeout(r,30));
 const about=[...document.querySelectorAll('.settings-nav__item')].find(button=>button.textContent.includes('Acerca de'));
 if(!about)throw new Error('About settings navigation missing');
 about.click();
 for(let i=0;i<100&&!document.querySelector('#settings-updates-title');i++)await new Promise(r=>setTimeout(r,30));
 if(!document.querySelector('#settings-updates-title'))throw new Error('Settings update section missing');
 for(let i=0;i<100&&!document.querySelector('.settings .update-notice button');i++)await new Promise(r=>setTimeout(r,30));
 if(!document.querySelector('.settings .update-notice button')?.textContent.includes('Reiniciar e instalar 0.4.4'))throw new Error('Settings update state missing');
})()`)});
 await captureMenu(win,'/tmp/namio-settings-updates.png');
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30))}throw new Error('Detailed update state missing')};
 await window.api.testUpdate({phase:'idle',version:'0.4.4',checkedAt:Date.now(),releaseDate:'2026-10-29T16:00:00Z'});
 await until(()=>document.querySelector('.settings .update-notice__status')?.textContent.includes('Estás usando la última versión'));
 if(!document.querySelector('.settings .update-notice__details')?.textContent.includes('Última comprobación'))throw new Error('Update check time missing');
 document.querySelector('#settings-updates-title').scrollIntoView({block:'start'});
})()`)});
 await captureMenu(win,'/tmp/namio-updates-latest.png');
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 await window.api.testUpdate({phase:'downloading',version:'0.4.5',percent:42,transferred:42*1024**2,total:100*1024**2,bytesPerSecond:2*1024**2,checkedAt:Date.now(),releaseDate:'2026-10-29T16:00:00Z'});
 for(let i=0;i<100&&!document.querySelector('.settings .update-notice__metrics');i++)await new Promise(r=>setTimeout(r,30));
 if(!document.querySelector('.settings .update-notice__metrics')?.textContent.includes('42 de 100 MB'))throw new Error('Download size missing');
 if(!document.querySelector('.settings .update-notice__metrics')?.textContent.includes('2 MB/s'))throw new Error('Download speed missing');
 if(document.querySelector('.settings [role="progressbar"]')?.getAttribute('aria-valuenow')!=='42')throw new Error('Detailed update progress incorrect');
})()`)});
 await captureMenu(win,'/tmp/namio-updates-download.png');
 await win.webContents.executeJavaScript("window.api.testUpdate({phase:'ready',version:'0.4.4'})");
 await win.webContents.executeJavaScript("document.querySelector('.settings__hero > .tool-btn').click()");
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 document.querySelector('.update-notice button').click();await new Promise(r=>setTimeout(r,30));if(await window.api.testInstalls()!==1)throw new Error('Install action not connected');
 await window.api.testUpdate({phase:'error'});await new Promise(r=>setTimeout(r,30));if(!document.querySelector('.update-notice button').textContent.includes('Reintentar'))throw new Error('Update retry missing');
})()`)});
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 const until=async(predicate,message)=>{for(let i=0;i<100;i++){if(predicate())return;await wait()}throw new Error(message)};
 const settle=async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.querySelector('.composer').getAnimations().map(animation=>animation.finished.catch(()=>{})))};
 const compose=()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Redactar'));
 await until(compose,'Application did not load');
 document.querySelector('.filter-chip:last-child').click();await wait();
 const menu=()=>document.querySelector('.context-menu');
 const menuAction=label=>[...menu().querySelectorAll('button')].find(button=>button.textContent.endsWith(label));
 let target=document.querySelector('.thread__content');
 const targetSubject=target.querySelector('.thread__subject span').textContent;
 const findTarget=()=>[...document.querySelectorAll('.thread__content')].find(item=>item.querySelector('.thread__subject span').textContent===targetSubject);
 const openMenu=async()=>{target=findTarget();target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}));await until(menu,'Message context menu missing')};
 const unreadBefore=target.closest('.thread').classList.contains('thread--unread');
 await openMenu();
 if(target.closest('.thread').classList.contains('thread--unread')!==unreadBefore)throw new Error('Right click must not mark mail read');
 const rect=menu().getBoundingClientRect();if(rect.right>innerWidth||rect.bottom>innerHeight)throw new Error('Context menu escaped viewport');
 menuAction(unreadBefore?'Marcar como leído':'Marcar como no leído').click();await until(()=>!menu(),'Message action did not dismiss menu');
 await wait();target=findTarget();if(target.closest('.thread').classList.contains('thread--unread')===unreadBefore)throw new Error('Read action did not affect target: '+JSON.stringify({before:unreadBefore,connected:target.isConnected,subject:target.textContent,menu:menu()?.textContent}));
 await openMenu();const star=menuAction('Destacar')??menuAction('Quitar destacado');const starLabel=star.textContent.endsWith('Quitar destacado')?'Quitar destacado':'Destacar';star.click();await wait();await openMenu();
 if(menuAction(starLabel))throw new Error('Star action did not toggle target');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await until(()=>!menu(),'Escape did not dismiss context menu');
 if(document.activeElement!==target)throw new Error('Escape must return focus');
 target.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));await until(menu,'Keyboard context menu missing');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
 if(document.activeElement!==menu().querySelector('button:last-child'))throw new Error('End must focus last action');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait();
 const folderButton=document.querySelector('.nav-item');folderButton.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));await until(menu,'Folder context menu missing');
 if(!menuAction('Sincronizar').disabled)throw new Error('Demo folder sync must be disabled');
 menuAction('Abrir carpeta').click();await until(()=>!menu(),'Folder open did not dismiss menu');
 console.log('Context menus: target read/star actions, folder opening, viewport placement, keyboard navigation and focus restoration passed');

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
  await until(()=>document.getAnimations().some(animation=>animation.effect?.pseudoElement==='::view-transition-group(composer)'),'Minimize must animate between the open window and dock');
  const motion=document.getAnimations().find(animation=>animation.effect?.pseudoElement==='::view-transition-group(composer)');
  if(motion.effect.getTiming().duration<250)throw new Error('Minimize transition is too short');
  await motion.finished.catch(()=>{});
  if(document.querySelector('.composer').getAttribute('aria-modal')!=='false')throw new Error('Minimized composer remains modal');
  if(getComputedStyle(document.querySelector('.composer__fields')).display!=='none')throw new Error('Fields still visible while minimized');
  compose().click();await until(()=>!document.querySelector('.composer-dock'),'Compose did not restore existing message');
  await Promise.all(document.getAnimations().filter(animation=>animation.effect?.pseudoElement).map(animation=>animation.finished.catch(()=>{})));
  if(document.querySelector('.tiptap').editor!==editor||!editor.getHTML().includes('<strong>'))throw new Error('Minimize lost editor content or instance');
  document.querySelector('.send-caret').click();await until(()=>document.querySelector('.composer-send-options'),'Send options missing');
  document.querySelector('.composer-send-options button:last-child').click();

  await until(()=>!document.querySelector('.composer'),'Editor did not close');
  if(!compose()||!document.querySelector('.thread-list'))throw new Error('Mailbox disappeared after closing');
 }
})()`)});
 console.log('Context menus: read/star target actions, keyboard navigation, focus restoration and viewport placement passed');
 await win.webContents.executeJavaScript(${JSON.stringify(`document.querySelector('.thread__content').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:500,clientY:240}))`)});
 await captureMenu(win,'/tmp/namio-context-menu-message.png');
 await win.webContents.executeJavaScript(${JSON.stringify(`(()=>{if(document.querySelectorAll('.context-menu [role="separator"]').length!==1)throw new Error('Destructive actions must be separated');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))})()`)});
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 document.querySelector('[aria-label="Redactar"]').click();
 await new Promise(resolve=>setTimeout(resolve,100));
 const composer=document.querySelector('.composer');
 if(getComputedStyle(composer).transitionDuration.split(',').some(value=>parseFloat(value)>0.01))throw new Error('Reduced motion must suppress resizing transitions');
 document.querySelector('.composer__head [aria-label="Cerrar"]').click();
})()`)});
 console.log('Compose motion: minimize/restore snapshots, 300ms spatial transition, content preservation and reduced motion passed');
 const onboarding=new BrowserWindow({show:false,width:1080,height:760,webPreferences:{partition:'google-onboarding-test',preload:${JSON.stringify(join(folder,'onboarding-preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 onboarding.webContents.on('console-message',event=>{if(event.level==='error')errors.push('onboarding: '+event.message)});
 await onboarding.loadFile(${JSON.stringify(join(process.cwd(),'out/renderer/index.html'))});
 await onboarding.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const until=async(predicate,message)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error(message)};
 await until(()=>document.querySelector('.onboarding__card'),'Onboarding missing');
 [...document.querySelectorAll('.onboarding__card')].find(button=>button.textContent.includes('Gmail')).click();
 await until(()=>document.querySelector('.onboarding__form'),'Gmail form missing');
 const form=document.querySelector('.onboarding__form');
 if([...form.querySelectorAll('label')].some(label=>/ID de cliente|Secreto de cliente/.test(label.textContent)))throw new Error('Gmail must not ask for OAuth client credentials');
 const submit=form.querySelector('button[type="submit"]');
 if(!submit.textContent.includes('Iniciar sesión con Google')||!submit.disabled)throw new Error('Gmail sign-in must require an email');
 const email=form.querySelector('input[placeholder="tu@ejemplo.com"]');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(email,'tester@example.com');email.dispatchEvent(new Event('input',{bubbles:true}));
 await until(()=>!submit.disabled,'Gmail sign-in requires extra credentials');
 [...form.querySelectorAll('button')].find(button=>button.textContent.trim()==='Contraseña de aplicación').click();
 await until(()=>form.querySelector('input[type="password"]'),'Gmail app-password alternative missing');
 if(!submit.disabled)throw new Error('App-password mode must require a password');
})()`)});
 console.log('Gmail onboarding: built-in OAuth, email validation and app-password alternative passed');
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 document.querySelector('.account').click();
 for(let i=0;i<100&&!document.querySelector('.account-menu .account-menu__action');i++)await new Promise(resolve=>setTimeout(resolve,50));
 document.querySelector('.account-menu .account-menu__action').click();
 for(let i=0;i<100&&!document.querySelector('.account-preset');i++)await new Promise(resolve=>setTimeout(resolve,50));
 if(!document.querySelector('.account-preset'))throw new Error('Account dialog did not open');
})()`)});
 const fieldsScript = ${JSON.stringify(`(selector)=>[...document.querySelector(selector).querySelectorAll('label')].filter(label=>{const input=label.querySelector('input');return input&&!input.closest('details:not([open])')&&input.getBoundingClientRect().width>0}).map(label=>label.querySelector('span').textContent.trim()).sort()`)};
 for(const [provider,card] of [['Gmail','Gmail'],['Outlook','Outlook'],['Yahoo','Yahoo'],['Otro','Otro correo'],['Local','Servidor local']]){
   const initialFields=await onboarding.webContents.executeJavaScript('('+${JSON.stringify(`async (card,fields)=>{
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 document.querySelector('.onboarding__back').click();await wait();
 const cards=[...document.querySelectorAll('.onboarding__card')];const selected=cards.find(button=>button.textContent.includes(card));
 if(!selected)throw new Error('Missing onboarding provider '+card+': '+cards.map(button=>button.textContent).join('|'));
 selected.click();await wait();
 return fields('.onboarding__form');
}`)}+')('+JSON.stringify(card)+','+fieldsScript+')');
   const dialogFields=await win.webContents.executeJavaScript('('+${JSON.stringify(`async (provider,fields)=>{
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 for(let i=0;i<100&&!document.querySelector('.account-preset');i++)await wait();
 const presets=[...document.querySelectorAll('.account-preset')];const selected=presets.find(button=>button.textContent.includes(provider));
 if(!selected)throw new Error('Missing dialog provider '+provider+': '+presets.map(button=>button.textContent).join('|'));
 selected.click();await wait();
 return fields('.account-form');
}`)}+')('+JSON.stringify(provider)+','+fieldsScript+')');
   if(JSON.stringify(initialFields)!==JSON.stringify(dialogFields))throw new Error(provider+' fields differ: '+JSON.stringify({initialFields,dialogFields}));
   if(provider==='Gmail'){
     for(const [surface,selector] of [[onboarding,'.onboarding__form'],[win,'.account-form']]){
       await surface.webContents.executeJavaScript('('+${JSON.stringify(`async selector=>{
 const form=document.querySelector(selector);
 const button=[...form.querySelectorAll('button')].find(button=>button.textContent.trim()==='Contraseña de aplicación'&&button.getBoundingClientRect().width>0);
 if(!button)throw new Error('Gmail authentication choice must be visible without opening advanced settings');
 button.click();await new Promise(resolve=>setTimeout(resolve,50));
 if(!form.querySelector('input[type="password"]')||!form.querySelector('button[type="submit"]').disabled)throw new Error('Gmail app-password validation differs');
}`)}+')('+JSON.stringify(selector)+')');
     }
     const startPasswordFields=await onboarding.webContents.executeJavaScript('('+fieldsScript+')('+JSON.stringify('.onboarding__form')+')');
     const dialogPasswordFields=await win.webContents.executeJavaScript('('+fieldsScript+')('+JSON.stringify('.account-form')+')');
     if(JSON.stringify(startPasswordFields)!==JSON.stringify(dialogPasswordFields))throw new Error('Gmail app-password fields differ');
   }
 }
 await win.webContents.executeJavaScript("document.querySelector('.account-modal__actions .tool-btn').click()");
 console.log('Authentication forms: matching visible fields for Gmail, Outlook, Yahoo, custom and local accounts; visible Gmail method selection and password validation passed');
 onboarding.destroy();
 const live=new BrowserWindow({show:false,width:1024,height:768,useContentSize:true,webPreferences:{preload:${JSON.stringify(join(folder,'drafts-preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 live.webContents.on('console-message',event=>{if(event.level==='error')errors.push('live: '+event.message+' ['+event.sourceId+':'+event.lineNumber+']')});
 await live.loadFile(${JSON.stringify(join(process.cwd(),'out/renderer/index.html'))});
 live.webContents.debugger.attach('1.3');
 await live.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
 await live.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 const until=async(predicate,message)=>{for(let i=0;i<100;i++){if(predicate())return;await wait()}throw new Error(message)};
 const settle=async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.querySelector('.composer').getAnimations().map(animation=>animation.finished.catch(()=>{})))};
 const card=title=>[...document.querySelectorAll('.thread__content')].find(item=>item.textContent.includes(title));
 await until(()=>document.querySelector('[aria-label="Drafts"]'),'Drafts folder missing');
 await until(()=>!document.querySelector('.list-loading'),'Initial folder still loading');await wait();
 for(const path of ['Spam','Trash','INBOX']){
 const target=[...document.querySelectorAll('.rail__nav .nav-item')].find(item=>item.querySelector('.nav-item__text')?.textContent===path);
 if(!target)throw new Error('Missing folder '+path);
 target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));
 await until(()=>document.querySelector('.context-menu'),'Folder context menu missing');
 const empty=[...document.querySelectorAll('.context-menu button')].find(button=>button.textContent.includes('Vaciar carpeta'));
 if(path==='INBOX'){
 if(empty)throw new Error('Regular folders cannot expose empty-folder');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 }else{
 if(!empty)throw new Error('Spam/Trash must expose empty-folder');
 empty.click();await wait();
 const jobs=await window.api.inspectTestBackgroundDeletes();
 if(jobs.at(-1)?.path!==path||jobs.at(-1)?.uids!==undefined)throw new Error('Wrong background deletion request');
 }
 await until(()=>!document.querySelector('.context-menu'),'Folder context menu did not close');
 }
 console.log('Empty-folder UI: Spam and Trash queue background deletion; Inbox does not expose it');
 for(const path of ['Spam','Trash','INBOX']){
 [...document.querySelectorAll('.rail__nav .nav-item')].find(item=>item.querySelector('.nav-item__text')?.textContent===path).click();
 await until(()=>document.querySelector('.rail__nav [aria-current="page"] .nav-item__text')?.textContent===path&&!document.querySelector('.list-loading')&&card('Inbox sample'),'Folder messages did not load');
 card('Inbox sample').click();
 await until(()=>document.querySelector('.reading__toolbar'),'Folder toolbar did not load');
 await until(()=>document.querySelector('.email-body iframe')?.style.visibility==='visible','Folder message did not finish loading');
 await new Promise(requestAnimationFrame);await wait();
 const empty=document.querySelector('.reading__toolbar [aria-label="Vaciar carpeta…"]');
 if(path==='INBOX'){
 if(empty)throw new Error('Inbox toolbar cannot expose empty-folder');
 }else{
 if(!empty||empty.disabled)throw new Error('Spam/Trash toolbar needs an enabled empty-folder action');
 empty.click();await wait();
 const jobs=await window.api.inspectTestBackgroundDeletes();
 if(jobs.at(-1)?.path!==path||jobs.at(-1)?.uids!==undefined)throw new Error('Toolbar queued the wrong folder');
 }
 }
 console.log('Reader toolbar: empty-folder is available only in Spam/Trash and reuses background deletion');
 await until(()=>document.querySelector('.deletion-progress [role="progressbar"]'),'Persistent deletion indicator missing');
 if(!document.querySelector('.deletion-progress').textContent.includes('Trash'))throw new Error('Deletion progress must remain visible after navigating to Inbox');
 await window.api.advanceTestDeletion(100);
 await until(()=>document.querySelector('.deletion-progress [role="progressbar"]')?.getAttribute('aria-valuenow')==='100','Confirmed deletion progress did not update');
 if(!document.querySelector('.deletion-progress').textContent.includes('100/250'))throw new Error('Deletion count missing');
 await new Promise(resolve=>setTimeout(resolve,2500));
 if(!document.querySelector('.deletion-progress'))throw new Error('Deletion indicator disappeared with the toast');
 await window.api.advanceTestDeletion(0,false);
 await until(()=>document.querySelector('.deletion-progress')?.textContent.includes('Borrado pendiente'),'Disconnected deletion must show pending');
 if(document.querySelector('.deletion-progress [role="progressbar"]'))throw new Error('Pending deletion cannot claim active progress');
 await window.api.finishTestDeletion();
 await until(()=>!document.querySelector('.deletion-progress'),'Completed deletion did not clear the indicator');

 await until(()=>document.querySelector('.email-body iframe')?.style.visibility==='visible','Inbox body not ready');
 if(![...document.querySelectorAll('.participants__recipients')].some(node=>node.textContent==='copy@example.test'))throw new Error('Received CC is not visible in the reader');
 const bodyFrame=document.querySelector('.email-body iframe'), bodyDocument=bodyFrame.contentDocument;
 const detail=document.querySelector('.thread-message');detail.open=false;
 document.querySelector('[aria-label="Sincronizar"]').click();await wait();
 if((await window.api.inspectTestSyncs()).join(',')!=='INBOX')throw new Error('Inbox synchronization did not run');
 await until(()=>document.querySelector('[aria-label="Sincronizar"]').getAttribute('aria-busy')==='false','Inbox synchronization not finished');
 if(document.querySelector('.email-body iframe')!==bodyFrame||bodyFrame.contentDocument!==bodyDocument)throw new Error('Synchronization reloaded the open email');
 if(detail.open)throw new Error('Synchronization reset message expansion');
 document.querySelector('.reading__toolbar [aria-label="Eliminar"]').click();
 await until(()=>document.querySelector('.thread__processing'),'Delete feedback missing from mail card');
 const deleteButton=document.querySelector('.reading__toolbar [aria-label="Eliminando…"]');
 if(!deleteButton?.disabled||deleteButton.getAttribute('aria-busy')!=='true')throw new Error('Delete button must show progress and block repeated clicks');
 if((await window.api.inspectTestDeleteCalls())!==1)throw new Error('Delete started more than once');
 await window.api.finishTestDelete();await until(()=>!document.querySelector('.thread__processing'),'Delete feedback did not clear');
 await until(()=>![...document.querySelectorAll('.thread__content')].some(item=>item.textContent.includes('Inbox sample')),'Deleted mail remained visible');
 console.log('Sync/delete UI: stable iframe/document and expansion, pending card/button feedback, duplicate prevention and completed deletion passed');

 document.querySelector('[aria-label="Drafts"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));
 await until(()=>document.querySelector('.context-menu'),'Live folder menu missing');
 [...document.querySelectorAll('.context-menu button')].find(button=>button.textContent.endsWith('Sincronizar')).click();
 await until(()=>!document.querySelector('.context-menu'),'Sync did not dismiss menu');await wait();
 if((await window.api.inspectTestSyncs()).join(',')!=='INBOX,Drafts')throw new Error('Folder context sync targeted the selected folder instead of the clicked one');
 document.querySelector('[aria-label="Drafts"]').click();
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
 saved=await window.api.inspectTestDrafts();if(saved.length!==2||!saved.some(item=>item.id==='new-draft-1'))throw new Error('Multiple drafts not preserved');
 document.querySelector('[aria-label="Redactar"]').click();await until(()=>document.querySelector('.tiptap')?.editor,'Image composer missing');
 await settle();
 editor=document.querySelector('.tiptap').editor;
 const imageClipboard=new DataTransfer();imageClipboard.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGNsaP7PQApgIkn1qIZRDUNKAwBWBwIi7kQ8QgAAAABJRU5ErkJggg=='),character=>character.charCodeAt(0))],'Image.png',{type:'image/png'}));
 editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:imageClipboard}));
 await until(()=>editor.view.dom.querySelector('img[src]'),'Image-only draft did not render');
 if(editor.getText().trim()!=='')throw new Error('Image-only draft unexpectedly has text');
 document.querySelector('.composer__head [aria-label="Minimizar"]').click();await until(()=>document.querySelector('.composer-dock'),'Image draft did not minimize');
 saved=await window.api.inspectTestDrafts();if(!saved.find(item=>item.id==='new-draft-2')?.html?.includes('<img'))throw new Error('Minimizing lost image-only draft');
 document.querySelector('.composer__head [aria-label="Restaurar mensaje"]').click();await until(()=>!document.querySelector('.composer-dock'),'Image draft did not restore');
 document.querySelector('.composer__head [aria-label="Cerrar"]').click();await until(()=>!document.querySelector('.composer'),'Image draft did not close');
 saved=await window.api.inspectTestDrafts();if(!saved.find(item=>item.id==='new-draft-2')?.html?.includes('<img'))throw new Error('Closing lost image-only draft');

})()`)});
 console.log('Folder context sync: clicked folder is synchronized without changing the open folder');
 await live.webContents.executeJavaScript('window.api.deleteMessages("Spam").then(()=>window.api.advanceTestDeletion(100))');
 await captureMenu(live,'/tmp/namio-deletion-progress.png');
 await live.webContents.executeJavaScript('window.api.finishTestDeletion()');
 await live.webContents.executeJavaScript(${JSON.stringify(`(()=>{const target=[...document.querySelectorAll('.rail__nav .nav-item')].find(item=>item.querySelector('.nav-item__text')?.textContent==='Spam');target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:240,clientY:180}));})()`)});
 await captureMenu(live,'/tmp/namio-context-menu-folder.png');
 await live.webContents.executeJavaScript(${JSON.stringify(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)});
 if(errors.length)throw new Error(errors.join('\\n'));
 console.log('Drafts folder: remote editing, local pending drafts, independent discard and multiple saved drafts passed');
 console.log('Full app compose regression: lazy load, typing, formatting and four close/reopen cycles preserve the mailbox without renderer errors');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child = spawn(require('electron'), ['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')], {stdio:'inherit'})
  const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  if(code!==0)process.exitCode=1
} finally {await rm(folder,{recursive:true,force:true})}

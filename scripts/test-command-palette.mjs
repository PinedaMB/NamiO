// Runs the actual palette in Electron with synthetic folders; no account credentials.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url)
const project = process.cwd()
const folder = await mkdtemp(join(tmpdir(), 'namio-palette-'))
try {
  await writeFile(join(folder, 'index.html'), '<html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
  await writeFile(join(folder, 'main.tsx'), `
import React,{useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
import {CommandPalette} from '${project}/src/renderer/src/components/CommandPalette';
import {I18nProvider} from '${project}/src/renderer/src/i18n';
import {ShortcutsProvider} from '${project}/src/renderer/src/settings/ShortcutsProvider';
import '${project}/node_modules/@fontsource-variable/inter/index.css';
import '${project}/node_modules/@fontsource-variable/jetbrains-mono/index.css';
import '${project}/node_modules/material-symbols/outlined.css';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
window.api={getSettings:async()=>({language:'es',shortcuts:{compose:'mod+n',archive:'a',settings:'mod+.'}})};
window.actions=[];
const threads=Array.from({length:60},(_,i)=>({id:String(i),subject:i===0?'Reunión de programación':'Mensaje '+i,participants:[{name:'José'}],unread:false}));
const folders=[{id:'INBOX',label:'Recibidos',icon:'inbox'},{id:'[Gmail]/Borradores',label:'Borradores',icon:'draft'}];
window.searchCalls=[];window.failSearch=true;
const cacheRows=Array.from({length:126},(_,i)=>({mailbox:'Otros/Archivo',mailboxName:'Archivo',uid:9000+i,subject:'Documento '+i,from:{name:'Remitente',address:'cache@example.test'},date:new Date().toISOString(),unread:false,flagged:false,snippet:'Coincidencia en el cuerpo'}));
async function cacheSearch(query,limit,offset){window.searchCalls.push([query,limit,offset]);if(query==='lento')await new Promise(r=>setTimeout(r,450));if(query==='error'&&window.failSearch)throw Error('Cache busy');return query==='global'?cacheRows.slice(offset,offset+limit):[{...cacheRows[0],subject:query==='lento'?'Respuesta obsoleta':'Respuesta actual'}]}
function Harness(){const [open,setOpen]=useState(false),[archive,setArchive]=useState(false),[cache,setCache]=useState(false);window.setCacheMode=setCache;window.setArchive=setArchive;return <><button id="launcher" onClick={()=>setOpen(true)}>Comandos</button><button id="outside">Exterior</button><CommandPalette open={open} threads={threads} folders={folders} canArchive={archive} searchCache={cache?cacheSearch:undefined} onOpenSearchHit={hit=>window.actions.push(['hit',hit.mailbox,hit.uid])} onClose={()=>setOpen(false)} onOpenThread={id=>window.actions.push(['thread',id])} onCompose={()=>window.actions.push(['compose'])} onArchive={()=>window.actions.push(['archive'])} onSelectFolder={id=>window.actions.push(['folder',id])} onOpenSettings={()=>window.actions.push(['settings'])}/></>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><ShortcutsProvider><Harness/></ShortcutsProvider></I18nProvider></React.StrictMode>);
`)
  await build({ configFile:false,root:folder,base:'./',plugins:[react()],resolve:{alias:{'@shared':join(project,'src/shared'),'react':join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}},build:{outDir:join(folder,'dist'),emptyOutDir:true},logLevel:'error' })
  await writeFile(join(folder,'runner.cjs'), `
const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,useContentSize:true,webPreferences:{offscreen:true}});
 const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
 win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 const run=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const key=async(key,options={})=>{await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",'+JSON.stringify({key,bubbles:true,cancelable:true,...options})+'))');await delay(30)};
 const filter=async text=>{await run('(()=>{const e=document.querySelector(".palette__input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(40)};
 const open=async()=>{await run('document.querySelector("#launcher").focus();document.querySelector("#launcher").click()');await delay(220);assert.equal(await run('document.activeElement===document.querySelector(".palette__input")'),true,'search receives focus when mounted')};
 const closed=async()=>{await delay(220);assert.equal(await run('!!document.querySelector(".palette")'),false)};
 await open();
 assert.equal(await run('document.querySelector(".palette").matches(":modal")'),true);
 assert.equal(await run('document.querySelector(".palette__meta").textContent.includes("60")'),true);
 assert.equal(await run('/48,291|v2.12|Bloquear remitente|Búsquedas recientes|Autocompletar|Acción secundaria/.test(document.querySelector(".palette").textContent)'),false);
 assert.equal(await run('document.querySelector(".palette").textContent.includes("Ctrl+N")'),true,'configured shortcuts are displayed');
 assert.equal(await run('document.querySelector(".palette").textContent.includes("Archivar")'),false,'archive requires a selected message');
 await run('document.querySelector("#outside").focus()');assert.equal(await run('document.querySelector(".palette").contains(document.activeElement)'),true,'native modality prevents focus behind the palette');
 for(let i=0;i<4;i++){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await delay(30);assert.equal(await run('document.querySelector(".palette").contains(document.activeElement)||document.activeElement===document.body'),true,'Tab cannot focus background controls')}
 await run('document.querySelector(".palette__input").focus()');
 await key('ArrowUp');await delay(220);

 assert.equal(await run('(()=>{const row=document.querySelector("[aria-selected=true]").getBoundingClientRect(),list=document.querySelector(".palette__list").getBoundingClientRect();return row.top>=list.top&&row.bottom<=list.bottom+1})()'),true,'keyboard selection scrolls into view');
 assert.equal(await run('document.getElementById(document.querySelector(".palette__input").getAttribute("aria-activedescendant")).getAttribute("aria-selected")'), 'true');
 await filter('programacion');assert.equal(await run('document.querySelectorAll("[role=option]").length'),1,'accent-insensitive search finds the shown mail');
 await key('Enter',{ctrlKey:true});assert.deepEqual(await run('window.actions'),[],'unsupported Ctrl+Enter does not execute a command');
 await key('Enter');await closed();assert.deepEqual(await run('window.actions'),[['thread','0']]);
 assert.equal(await run('document.activeElement.id'),'launcher','closing restores prior focus');
 for(const [query,expected] of [['Recibidos',['folder','INBOX']],['Borradores',['folder','[Gmail]/Borradores']],['Nuevo correo',['compose']],['Configuracion',['settings']]]){
  await open();assert.equal(await run('document.querySelector(".palette__input").value'),'');await filter(query);await key('Enter');await closed();assert.deepEqual(await run('window.actions.at(-1)'),expected);
 }
 await open();await filter('Nuevo correo');await key('Enter');await open();assert.equal(await run('document.querySelector(".palette").matches(":modal")'),true,'reopening during exit remains modal');await key('Escape');await closed();
 await run('window.setArchive(true)');await open();await filter('Archivar');await key('Enter');await closed();assert.deepEqual(await run('window.actions.at(-1)'),['archive']);
 await open();await filter('zzznomatch');assert.equal(await run('document.querySelectorAll("[role=option]").length'),0);assert.equal(await run('document.querySelector(".palette__input").hasAttribute("aria-activedescendant")'),false);await key('Enter');assert.equal(await run('document.querySelector(".palette").open'),true);await key('Escape');await closed();
 await open();await key('Tab');await run('document.querySelector(".palette .tool-btn").focus()');await key('Enter');assert.equal(await run('document.querySelector(".palette").open'),true,'Enter on Close must not run the highlighted command');await run('document.querySelector(".palette .tool-btn").click()');await closed();
 await open();await run('document.querySelector(".palette").dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:0,clientY:0}))');await closed();
 for(const [width,height] of [[1440,900],[800,600]]){
  win.setContentSize(width,height);await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await open();await filter('correo');await delay(250);
  assert.equal(await run('(()=>{const r=document.querySelector(".palette").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight})()'),true,'palette fits supported window widths');
  win.webContents.invalidate();await delay(250);await require('node:fs/promises').writeFile('/tmp/namio-palette-'+width+'.png',(await win.webContents.capturePage()).toPNG());await key('Escape');await closed();
 }
 const until=async predicate=>{for(let i=0;i<150;i++){if(await run(predicate))return;await delay(20)}throw Error('Cache search did not settle: '+predicate)};
 await run('window.setCacheMode(true)');await open();await filter('global');
 await until('document.querySelectorAll(".cmd").length===61');
 assert.deepEqual(await run('window.searchCalls.at(-1)'),['global',61,0],'search queries the cache independently of loaded thread IDs');
 assert.equal(await run('document.querySelector(".palette").textContent.includes("Documento 0")'),true,'body-only matches survive client filtering');
 await run('[...document.querySelectorAll(".cmd")].find(e=>e.textContent.includes("Cargar más mensajes")).click()');
 await until('document.querySelectorAll(".cmd").length===121');
 assert.deepEqual(await run('window.searchCalls.at(-1)'),['global',61,60]);
 await run('[...document.querySelectorAll(".cmd")].find(e=>e.textContent.includes("Cargar más mensajes")).click()');
 await until('document.querySelectorAll(".cmd").length===126');
 assert.deepEqual(await run('window.searchCalls.at(-1)'),['global',61,120]);
 await run('[...document.querySelectorAll(".cmd")].find(e=>e.querySelector(".cmd__label").textContent==="Documento 125").click()');await closed();
 assert.deepEqual(await run('window.actions.at(-1)'),['hit','Otros/Archivo',9125],'a result beyond the visible page opens its actual folder and UID');
 await open();await filter('lento');await delay(240);await filter('rapido');
 await until('document.querySelector(".palette").textContent.includes("Respuesta actual")');await delay(500);
 assert.equal(await run('document.querySelector(".palette").textContent.includes("Respuesta obsoleta")'),false,'outdated responses cannot overwrite a newer query');
 await filter('error');await until('!!document.querySelector(".palette [role=alert]")');
 await run('window.failSearch=false;[...document.querySelectorAll(".cmd")].find(e=>e.textContent.includes("Reintentar")).click()');
 await until('!document.querySelector(".palette [role=alert]")&&document.querySelector(".palette").textContent.includes("Respuesta actual")');
 await key('Enter');await closed();assert.deepEqual(await run('window.actions.at(-1)'),['hit','Otros/Archivo',9000]);
 await open();await filter('lento');await delay(240);await key('Escape');await closed();await open();await delay(500);
 assert.equal(await run('document.querySelector(".palette__input").value'),'','closing cancels pending result updates');await key('Escape');await closed();
 assert.deepEqual(errors,[],'palette must not produce renderer errors');
 console.log('Command palette: native focus/modal behavior, keyboard scrolling, real folders, supported actions, configured shortcuts, search, dismissal and window sizes passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  assert.equal(code,0)
} finally {await rm(folder,{recursive:true,force:true})}

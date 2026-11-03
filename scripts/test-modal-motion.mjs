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
const folder = await mkdtemp(join(tmpdir(), 'namio-modal-motion-'))
try {
  await writeFile(join(folder, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
  await writeFile(join(folder, 'main.tsx'), `
import React,{useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
${['MoveDialog','RecipientsDialog','ImageViewer','DocumentViewer','AccountDialog','ComposeOverlay','CommandPalette','Settings','ColorPicker'].map(name => `import {${name}} from '${project}/src/renderer/src/components/${name}';`).join('\n')}
import {I18nProvider} from '${project}/src/renderer/src/i18n';
import {PreferencesProvider} from '${project}/src/renderer/src/settings/PreferencesProvider';
import {ShortcutsProvider} from '${project}/src/renderer/src/settings/ShortcutsProvider';
import '${project}/node_modules/material-symbols/outlined.css';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
localStorage.setItem('namio.language','es');
window.api={getSettings:async()=>({}),setSettings:async()=>{},getCoreStatus:async()=>null};
function Harness(){
 const [kind,setKind]=useState('');window.openModal=setKind;
 const close=()=>setKind('');const noop=()=>{};
 const person={name:'Ana',email:'ana@example.com',initials:'A'};
 return <><button id="outside">Bandeja</button>
 {kind==='move'&&<MoveDialog subject="Prueba" folders={[{path:'Archive',name:'Archive',specialUse:'\\\\Archive',messages:0,unseen:0}]} onClose={close} onMove={path=>{window.moved=path;close()}}/>}
 {kind==='recipients'&&<RecipientsDialog message={{from:person,to:[person]}} onClose={close}/>}
 {kind==='image'&&<ImageViewer title="Imagen" error onClose={close}/>}
 {kind==='document'&&<DocumentViewer title="Documento" error onClose={close} onSave={noop}/>}
 <AccountDialog open={kind==='account'} account={null} onClose={close} onConnected={close} onDisconnected={close}/>
 <ComposeOverlay open={kind==='compose'} to="" subject="" body="" copilot={false} onClose={close} onDiscard={close} onSend={noop} onPickAttachments={async()=>[]}/>
 <CommandPalette open={kind==='palette'} threads={[]} folders={[]} canArchive={false} onClose={close} onCompose={()=>{window.paletteAction=true;close()}} onArchive={noop} onOpenThread={noop} onSelectFolder={noop} onOpenSettings={noop}/>
 {kind==='settings'&&<Settings onCacheCleared={noop} accountKey="test" onBack={close} accounts={[]} onAddAccount={noop} onManageAccount={noop} onSelectAccount={noop}/>}
 {kind==='color'&&<ColorPicker highlight={false} disabled={false} onChange={noop}/>}
 </>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><ShortcutsProvider><PreferencesProvider><Harness/></PreferencesProvider></ShortcutsProvider></I18nProvider></React.StrictMode>);
`)
  await build({ configFile:false, root:folder, base:'./', plugins:[react()], resolve:{alias:{'@shared':join(project,'src/shared'),react:join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}}, build:{outDir:join(folder,'dist'),emptyOutDir:true}, logLevel:'error' })
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1080,height:800,webPreferences:{offscreen:true}});
 const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('Renderer:',event.message)}});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});
 win.webContents.debugger.attach('1.3');
 const run=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await delay(20)}throw Error('Did not settle: '+code)};
 await until('!!window.openModal');
 const check=async(kind,selector,close)=>{
  console.log('Checking',kind);await run('window.openModal('+JSON.stringify(kind)+')');await until('!!document.querySelector('+JSON.stringify(selector)+')');await delay(30);
  assert.equal(await run('getComputedStyle(document.querySelector('+JSON.stringify(selector)+')).animationName'),'dialog-in',kind+' entrance');
  await delay(200);await run(close);await delay(25);
  assert.equal(await run('getComputedStyle(document.querySelector('+JSON.stringify(selector)+')).animationName'),'dialog-out',kind+' exit before unmount');
  if(await run('document.querySelector('+JSON.stringify(selector)+').tagName==="DIALOG"')) assert.equal(await run('getComputedStyle(document.querySelector('+JSON.stringify(selector)+'),"::backdrop").animationName'),'fade-out',kind+' backdrop exit');
  await until('!document.querySelector('+JSON.stringify(selector)+')');
 };
 for(const [kind,selector] of [['move','.move-dialog'],['recipients','.recipients-dialog'],['image','.image-viewer'],['document','.document-viewer']]){
  await check(kind,selector,'document.querySelector('+JSON.stringify(selector)+').dispatchEvent(new Event("cancel",{cancelable:true}))');
 }
 await check('move','.move-dialog','document.querySelector(".move-dialog .btn--primary").click();if(window.moved)throw Error("Move ran before exit")');
 assert.equal(await run('window.moved'),'Archive');
 await check('account','.account-modal','document.querySelector(".account-modal__head button").click()');
 await check('compose','.composer','document.querySelector(".composer__head [data-tooltip=Cerrar]").click()');
 await check('palette','.palette','document.querySelector(".palette").dispatchEvent(new Event("cancel",{cancelable:true}))');
 await check('palette','.palette','document.querySelector(".palette [role=option]").click();if(window.paletteAction)throw Error("Palette action ran before exit")');
 assert.equal(await run('window.paletteAction'),true);
 await run('window.openModal("settings")');await until('!!document.querySelector(".settings-nav__item")');
 await run('Array.from(document.querySelectorAll(".settings-nav__item")).find(item=>item.querySelector(".settings-nav__label")?.textContent==="Atajos de teclado").click()');await until('!!document.querySelector(".shortcut-row")');
 await run('document.querySelector(".shortcut-row").click()');await until('!!document.querySelector(".remap")');
 assert.equal(await run('getComputedStyle(document.querySelector(".remap")).animationName'),'dialog-in');await delay(200);
 await run('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await delay(25);
 assert.equal(await run('getComputedStyle(document.querySelector(".remap")).animationName'),'dialog-out');await until('!document.querySelector(".remap")');
 await run('document.querySelector(".dedication").showModal()');await delay(30);
 assert.equal(await run('document.querySelector(".dedication").getAnimations().length>0'),true,'Dedication entrance');await delay(300);
 await run('document.querySelector(".dedication").close()');await delay(25);
 assert.equal(await run('document.querySelector(".dedication").getAnimations().length>0'),true,'Dedication exit');await delay(300);
 await run('window.openModal("color")');await until('!!document.querySelector(".color-picker")');
 await run('document.querySelector(".color-picker").showPopover()');await delay(25);
 assert.equal(await run('document.querySelector(".color-picker").getAnimations().length>0'),true,'Color picker entrance');await delay(200);
 await run('document.querySelector(".color-picker").hidePopover()');await delay(25);
 assert.equal(await run('document.querySelector(".color-picker").getAnimations().length>0'),true,'Color picker exit');await delay(200);
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await run('window.openModal("move")');await until('!!document.querySelector(".move-dialog")');
 assert.ok(Number.parseFloat(await run('getComputedStyle(document.querySelector(".move-dialog")).animationDuration'))<=0.001);
 await run('document.querySelector(".move-dialog").dispatchEvent(new Event("cancel",{cancelable:true}))');await until('!document.querySelector(".move-dialog")');
 assert.deepEqual(errors,[]);console.log('Modal motion: native dialogs, account, composer, palette actions, remap, dedication, color picker and reduced motion passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  assert.equal(code,0,'Modal motion Chromium checks')
} finally { await rm(folder,{recursive:true,force:true}) }

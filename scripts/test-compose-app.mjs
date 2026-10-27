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
 getDraft:async()=>null,syncProgress:async()=>null,
 onCacheChanged:noop,onSyncProgress:noop,onAccountsActivity:noop,onOutboxChanged:noop,onRulesChanged:noop
});`)
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const errors=[];
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:${JSON.stringify(join(folder,'preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
 await win.loadFile(${JSON.stringify(join(process.cwd(),'out/renderer/index.html'))});
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 const until=async(predicate,message)=>{for(let i=0;i<100;i++){if(predicate())return;await wait()}throw new Error(message)};
 const compose=()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Redactar'));
 await until(compose,'Application did not load');
 for(let cycle=0;cycle<4;cycle++){
  compose().click();
  await until(()=>document.querySelector('.tiptap')?.editor,'Editor did not mount / blank screen');
  const editor=document.querySelector('.tiptap').editor;
  if(editor.getText()!=='')throw new Error('New message retained previous content');
  if(document.querySelector('.subject-input').value!=='')throw new Error('New message retained the subject');
  editor.commands.insertContent('Mensaje de prueba '+cycle);
  editor.commands.selectAll();document.querySelector('[data-tooltip="Negrita"]').click();await wait();
  if(!editor.getHTML().includes('<strong>'))throw new Error('Cannot format after opening');
  if(!document.querySelector('.thread-list'))throw new Error('Mailbox unmounted while composing');
  document.querySelector('.composer__head [aria-label="Cerrar"]').click();
  await until(()=>!document.querySelector('.composer'),'Editor did not close');
  if(!compose()||!document.querySelector('.thread-list'))throw new Error('Mailbox disappeared after closing');
 }
})()`)});
 if(errors.length)throw new Error(errors.join('\\n'));
 console.log('Full app compose regression: lazy load, typing, formatting and four close/reopen cycles preserve the mailbox without renderer errors');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child = spawn(require('electron'), ['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')], {stdio:'inherit'})
  const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  if(code!==0)process.exitCode=1
} finally {await rm(folder,{recursive:true,force:true})}

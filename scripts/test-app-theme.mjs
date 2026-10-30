// Uses the actual settings IPC handler and a fresh profile; no account credentials.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript-test')
const project = process.cwd()
const compile = code => ts.transpile(code,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const source = ts.createSourceFile('ipc.ts',await readFile('src/main/ipc.ts','utf8'),ts.ScriptTarget.Latest,true)
let setHandler
function visit(node) {
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='ipcMain.handle'&&node.arguments[0]?.getText(source)==='IPC.settingsSet')setHandler=node.arguments[1].getText(source)
  ts.forEachChild(node,visit)
}
visit(source)
assert.ok(setHandler)
const folder=await mkdtemp(join(tmpdir(),'namio-app-theme-'))
try {
  await writeFile(join(folder,'settings.json'),JSON.stringify({onboarded:true,language:'es'}))
  await writeFile(join(folder,'preload.cjs'), `
const {contextBridge,ipcRenderer}=require('electron');const noop=()=>()=>{};
contextBridge.exposeInMainWorld('api',{
 getSettings:()=>ipcRenderer.invoke('settings:get'),setSettings:patch=>ipcRenderer.invoke('settings:set',patch),
 getCoreStatus:async()=>({appVersion:'test',stage:'M8',cacheUsage:null}),accountStatus:async()=>({configured:false,connected:false,account:null}),
 accounts:async()=>[],checkAccounts:async()=>[],listOutbox:async()=>[],getDraft:async()=>null,listDrafts:async()=>[],syncProgress:async()=>null,
 onCacheChanged:noop,onSyncProgress:noop,onAccountsActivity:noop,onOutboxChanged:noop,onRulesChanged:noop
});`)
  await writeFile(join(folder,'runner.cjs'), `
const {app,BrowserWindow,ipcMain,nativeTheme}=require('electron'),assert=require('node:assert/strict'),vm=require('node:vm');
app.setPath('userData',${JSON.stringify(folder)});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const settings={};vm.runInNewContext(${JSON.stringify(compile(await readFile('src/main/settings.ts','utf8')))},{exports:settings,require});
 const setSettings=vm.runInNewContext(${JSON.stringify(compile(`(${setHandler})`))},{writeSettings:settings.writeSettings,nativeTheme,resumeOfflineDownload(){},setBackgroundMode(){}});
 ipcMain.handle('settings:get',()=>settings.readSettings());ipcMain.handle('settings:set',setSettings);
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:${JSON.stringify(join(folder,'preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});
 await win.loadFile(${JSON.stringify(join(project,'out/renderer/index.html'))});
 win.webContents.debugger.attach('1.3');
 const run=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{for(let i=0;i<120;i++){if(await run(code))return;await delay(25)}throw Error('Theme did not settle: '+code)};
 const media=async scheme=>{await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});await delay(80)};
 const viewport=async(width,height=900)=>{await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(80)};
 const capture=async name=>{await run('document.fonts.ready.then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))))');win.webContents.invalidate();await delay(250);await require('node:fs/promises').writeFile('/tmp/namio-theme-'+name+'.png',(await win.webContents.capturePage()).toPNG())};
 await viewport(1440);await until('document.documentElement.dataset.appTheme==="system"');
 await media('light');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(245, 246, 251)');
 await media('dark');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(15, 19, 28)','System follows live system changes');
 await run('document.querySelector(\\'.rail [aria-label="Configuración"]\\').click()');await until('!!document.querySelector("#settings-theme-title")');
 const choose=async(index,theme)=>{await run('document.querySelectorAll(\\'section[aria-labelledby="settings-theme-title"] .seg__btn\\')['+index+'].click()');await until('document.documentElement.dataset.appTheme==='+JSON.stringify(theme));await delay(200);assert.equal((await settings.readSettings()).appTheme,theme);assert.equal(nativeTheme.themeSource,theme)};
 await choose(0,'light');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(245, 246, 251)','explicit Light wins over dark system');
 const contrastCheck=${JSON.stringify(`(()=>{
 const luminance=rgb=>rgb.slice(0,3).map(n=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4}).reduce((v,n,i)=>v+n*[0.2126,0.7152,0.0722][i],0);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
 return ['.settings-card__title','.settings-card__subtitle','.seg__btn--active','.compose-btn','.send-btn','.avatar--tertiary','.cmd__label','.cmd__hint','.palette__meta','.palette__input'].flatMap(selector=>{
 const e=document.querySelector(selector);if(!e)return [];const parents=[];for(let p=e;p;p=p.parentElement)parents.unshift(p);
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1,1);for(const parent of parents){ctx.fillStyle=getComputedStyle(parent).backgroundColor;ctx.fillRect(0,0,1,1)}
 const bg=Array.from(ctx.getImageData(0,0,1,1).data);const b=luminance(bg);ctx.fillStyle=getComputedStyle(e).color;ctx.fillRect(0,0,1,1);const a=luminance(Array.from(ctx.getImageData(0,0,1,1).data));
 return [[selector,(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),getComputedStyle(e).color,getComputedStyle(e).backgroundColor,bg]]})
 })()`)};
 const contrast=await run(contrastCheck);
 for(const [selector,ratio] of contrast)assert.ok(ratio>=4.5,selector+' contrast '+ratio);
 await capture('light-settings-1440');await viewport(800);await capture('light-settings-800');
 await choose(1,'dark');await media('light');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(15, 19, 28)','explicit Dark wins over light system');await capture('dark-settings-800');
 await choose(2,'system');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(245, 246, 251)');await media('dark');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(15, 19, 28)');
 await choose(0,'light');await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until('document.documentElement.dataset.appTheme==="light"');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(245, 246, 251)','theme survives renderer reload');
 await capture('light-mailbox-800');await viewport(1440);await capture('light-mailbox-1440');
 await run('document.querySelector(".compose-btn").click()');await until('!!document.querySelector(".composer .tiptap")');await capture('light-compose-1440');
 await run('document.querySelector(\\'.composer__head [aria-label="Cerrar"]\\').click()');await until('!document.querySelector(".composer")');
 await run('window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}))');await until('!!document.querySelector(".palette:modal")');await capture('light-palette-1440');for(const [selector,ratio] of await run(contrastCheck))assert.ok(ratio>=4.5,selector+' contrast '+ratio);
 for(const invalid of ['blue',null,1,{},false])await assert.rejects(setSettings(null,{appTheme:invalid}),/Invalid app theme/);
 assert.equal(nativeTheme.themeSource,'light');assert.equal((await settings.readSettings()).appTheme,'light','invalid values do not change saved/native theme');
 assert.deepEqual(errors,[]);console.log('App themes: default System, live OS changes, explicit overrides, saved/native preference, contrast, settings, reload and invalid IPC values passed');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
`)
  const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  assert.equal(code,0)
} finally {await rm(folder,{recursive:true,force:true})}

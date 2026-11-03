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
const mainSource = ts.createSourceFile('main.ts',await readFile('src/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let inputHandler
function findInput(node) {
 if(ts.isCallExpression(node)&&node.arguments[0]?.text==='before-input-event')inputHandler=node.arguments[1].getText(mainSource)
 ts.forEachChild(node,findInput)
}
findInput(mainSource)
assert.ok(inputHandler)
const folder=await mkdtemp(join(tmpdir(),'namio-app-theme-'))
try {
  await writeFile(join(folder,'settings.json'),JSON.stringify({onboarded:true,language:'es'}))
  await writeFile(join(folder,'preload.cjs'), `
const {contextBridge,ipcRenderer}=require('electron');const noop=()=>()=>{};
contextBridge.exposeInMainWorld('api',{
 onZoomChanged:listener=>{const handler=(_event,percent)=>listener(percent);ipcRenderer.on('window:zoom-changed',handler);return()=>ipcRenderer.removeListener('window:zoom-changed',handler)},
 getSettings:()=>ipcRenderer.invoke('settings:get'),setSettings:patch=>ipcRenderer.invoke('settings:set',patch),
 getCoreStatus:async()=>({appVersion:'test',stage:'M8',cacheUsage:null}),accountStatus:async()=>({configured:false,connected:false,account:null}),
 accounts:async()=>[],checkAccounts:async()=>[],listOutbox:async()=>[],getDraft:async()=>null,listDrafts:async()=>[],syncProgress:async()=>null,
 onCacheChanged:noop,onSyncProgress:noop,onAccountsActivity:noop,onOutboxChanged:noop,onRulesChanged:noop
});`)
  await writeFile(join(folder,'runner.cjs'), `
const {app,BrowserWindow,ipcMain,nativeTheme}=require('electron'),assert=require('node:assert/strict'),vm=require('node:vm');
app.setPath('userData',${JSON.stringify(folder)});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const settings={};vm.runInNewContext(${JSON.stringify(compile(await readFile('src/main/settings.ts','utf8')))},{exports:settings,require:id=>id==='@shared/ipc'?require(${JSON.stringify(join(project,'scripts/load-shared-ipc.cjs'))}):require(id)});
 const setSettings=vm.runInNewContext(${JSON.stringify(compile(`(${setHandler})`))},{writeSettings:settings.writeSettings,nativeTheme,resumeOfflineDownload(){},setBackgroundMode(){},sanitizeSettingsPatch:settings.sanitizeSettingsPatch});
 ipcMain.handle('settings:get',()=>settings.readSettings());ipcMain.handle('settings:set',setSettings);
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:${JSON.stringify(join(folder,'preload.cjs'))},offscreen:true,sandbox:true,contextIsolation:true}});
 win.webContents.on('before-input-event',vm.runInNewContext(${JSON.stringify(compile(`(${inputHandler})`))},{mainWindow:win,IPC:{zoomChanged:'window:zoom-changed'}}));
 const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});
 await win.loadFile(${JSON.stringify(join(project,'out/renderer/index.html'))});
 win.webContents.debugger.attach('1.3');
 const run=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{for(let i=0;i<120;i++){if(await run(code))return;await delay(25)}throw Error('Theme did not settle: '+code)};
 const media=async scheme=>{await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});await delay(80)};
 const viewport=async(width,height=900)=>{await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(80)};
 const capture=async name=>{await run('document.fonts.ready.then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))))');win.webContents.invalidate();await delay(250);await require('node:fs/promises').writeFile('/tmp/namio-theme-'+name+'.png',(await win.webContents.capturePage()).toPNG())};
 await viewport(1440);await until('document.documentElement.dataset.appTheme==="system"');
 await media('light');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)');
 await media('dark');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(32, 33, 36)','System follows live system changes');
 const zoomKey=async keyCode=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers:['control']});await delay(100)};
 await zoomKey('+');await until('document.querySelector(".toast")?.textContent.includes("110 %")');
 assert.equal(Math.round(win.webContents.getZoomFactor()*100),110);
 await zoomKey('-');await until('document.querySelector(".toast")?.textContent.includes("100 %")');
 await zoomKey('=');await until('document.querySelector(".toast")?.textContent.includes("110 %")');
 await zoomKey('0');await until('document.querySelector(".toast")?.textContent.includes("100 %")');
 assert.equal(win.webContents.getZoomFactor(),1);

 await run('document.querySelector(\\'.rail [aria-label="Configuración"]\\').click()');await until('!!document.querySelector("#settings-theme-title")');
 const choose=async(index,theme)=>{await run('document.querySelectorAll(\\'section[aria-labelledby="settings-theme-title"] .seg__btn\\')['+index+'].click()');await until('document.documentElement.dataset.appTheme==='+JSON.stringify(theme));await delay(200);assert.equal((await settings.readSettings()).appTheme,theme);assert.equal(nativeTheme.themeSource,theme)};
 await choose(0,'light');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)','explicit Light wins over dark system');
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
 await capture('light-settings-1440');
 const checkSettingsPages=async mode=>{
  const open=async label=>{await run('Array.from(document.querySelectorAll(".settings-nav__item")).find(item=>item.querySelector(".settings-nav__label")?.textContent==='+JSON.stringify(label)+').click()');await delay(100)};
  await open('Lectura');await until('!!document.querySelector("#settings-offline-title")');
  assert.equal(await run('!!document.querySelector("#settings-theme-title")'),false,'Reading settings are separate from app appearance');
  await viewport(1440);await capture(mode+'-reading-settings-1440');await viewport(800);await capture(mode+'-reading-settings-800');
  await open('Notificaciones');await until('!!document.querySelector("#notification-notifications")');
  assert.equal(await run('!!document.querySelector("#notification-keepInBackground")'),false,'Background mode belongs to General');
  await run('document.getElementById("notification-notifications").closest(".notification-option").querySelector("button").click()');
  await until('document.getElementById("notification-notificationSound").closest(".notification-option").querySelector("button").disabled');
  assert.equal(await run('getComputedStyle(document.getElementById("notification-notificationSound").closest(".notification-option").querySelector("button")).opacity'),'0.45','Disabled dependent settings are visibly distinct');
  await capture(mode+'-notifications-800');
  await run('document.getElementById("notification-notifications").closest(".notification-option").querySelector("button").click()');
  await until('!document.getElementById("notification-notificationSound").closest(".notification-option").querySelector("button").disabled');
  await viewport(1440);await capture(mode+'-notifications-1440');
  assert.ok(await run('document.querySelector(".settings__main").scrollWidth<=document.querySelector(".settings__main").clientWidth'),'Settings copy fits content width');
  await open('General');await until('!!document.querySelector("#settings-theme-title")');
 };
 await checkSettingsPages('light');

 await run('Array.from(document.querySelectorAll(".settings-nav__item")).find(item=>item.querySelector(".settings-nav__label")?.textContent==="Acerca de").click()');await until('!!document.querySelector(".settings-about__details")');await capture('light-about-1440');
 assert.equal(await run('document.querySelector(".settings-about__details").open'),false,'Technical information starts collapsed');
 await run('document.querySelector(".settings-about__details > summary").click()');await until('document.querySelector(".settings-about__details").open');await capture('light-about-details-1440');
 assert.ok(await run('document.querySelector(".settings-about__details").textContent.includes("settings.json")'),'Support information remains available');
 await run('document.querySelector(".settings-about__details > summary").click()');await viewport(800);await capture('light-about-800');
 await viewport(1440);await run('document.querySelectorAll(".settings-nav__item")[0].click()');await until('!!document.querySelector("#settings-theme-title")');

 await run('Array.from(document.querySelectorAll(".settings-nav__item")).find(item=>item.querySelector(".settings-nav__label")?.textContent==="Reglas y filtros").click()');await until('!!document.querySelector(".rules__empty")');await capture('light-rules-1440');
 await viewport(800);await capture('light-rules-800');
 assert.equal(await run('document.querySelector(".rules__head-actions")'),null,'Empty rules have one available action');
 await run('document.querySelector(".rules__empty .btn").click()');await until('!!document.querySelector(".rules__form")');
 assert.equal(await run('!!document.querySelector(".rules__empty")'),false,'Empty message is hidden while creating');
 await capture('light-rule-form-800');
 await run('document.querySelector(".rules__head-actions button").click()');await until('!!document.querySelector(".rules__empty")');
 await viewport(1440);
 await run('Array.from(document.querySelectorAll(".settings-nav__item")).find(item=>item.querySelector(".settings-nav__label")?.textContent==="Atajos de teclado").click()');await until('!!document.querySelector(".shortcut-row")');await capture('light-shortcuts-1440');
 await run('document.querySelector(".shortcut-row").click()');await until('!!document.querySelector(".remap")');await capture('light-remap-1440');
 await viewport(800);await capture('light-remap-800');
 assert.ok(await run('(()=>{const r=document.querySelector(".remap").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),'Remap fits compact window');
 await run('document.querySelector(".remap__head button").click()');await until('!document.querySelector(".remap")');
 await run('document.querySelectorAll(".settings-nav__item")[0].click()');await until('!!document.querySelector("#settings-theme-title")');await capture('light-settings-800');
 await run('document.querySelector(".account").click()');await until('!!document.querySelector(".account-menu__action")');
 await run('document.querySelector(".account-menu__action").click()');await until('!!document.querySelector(".account-modal")');await capture('light-account-800');
 assert.ok(await run('(()=>{const r=document.querySelector(".account-modal").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),'Account dialog fits compact window');
 await run('document.querySelector(".account-modal__head button").click()');await until('!document.querySelector(".account-modal")');

 await choose(1,'dark');await media('light');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(32, 33, 36)','explicit Dark wins over light system');await capture('dark-settings-800');await run('Array.from(document.querySelectorAll(".settings-nav__item")).find(item=>item.querySelector(".settings-nav__label")?.textContent==="Reglas y filtros").click()');await until('!!document.querySelector(".rules__empty")');await capture('dark-rules-800');await run('Array.from(document.querySelectorAll(".settings-nav__item")).find(item=>item.querySelector(".settings-nav__label")?.textContent==="Acerca de").click()');await until('!!document.querySelector(".settings-about__details")');await capture('dark-about-800');await run('document.querySelectorAll(".settings-nav__item")[0].click()');await until('!!document.querySelector("#settings-theme-title")');
 await checkSettingsPages('dark');
 await choose(2,'system');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)');await media('dark');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(32, 33, 36)');
 await choose(0,'light');await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until('document.documentElement.dataset.appTheme==="light"');assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)','theme survives renderer reload');
 await capture('light-mailbox-800');await viewport(1440);await capture('light-mailbox-1440');
 await run('document.querySelector(".thread__content").click()');await until('!!document.querySelector(".letter__subject")');await capture('light-reading-1440');
 await run('document.querySelector(".letter__badges button").click()');
 await until('!!document.querySelector(".body--dark")');
 assert.equal(await run('getComputedStyle(document.querySelector(".body--dark")).backgroundColor'),'rgb(32, 33, 36)','Plain text dark reading works on a light app');
 assert.equal(await run('getComputedStyle(document.querySelector(".body--dark")).color'),'rgb(238, 238, 241)');
 await run('document.querySelector(".letter__badges button").click()');
 await until('!document.querySelector(".body--dark")');
 assert.ok(await run('!!document.querySelector(".thread__avatar-wrap > .avatar")'),'Sender avatar occupies the selection position');
 assert.ok(await run('!!document.querySelector(".participants__who > .avatar")'),'Reader shows the sender avatar');
 assert.equal(await run('getComputedStyle(document.querySelector(".thread__check")).opacity'),'0','Checkbox is hidden at rest');
 const avatarBounds=await run('(()=>{const r=document.querySelector(".thread__avatar-wrap").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
 win.webContents.sendInputEvent({type:'mouseMove',...avatarBounds});await delay(180);
 assert.equal(await run('getComputedStyle(document.querySelector(".thread__check")).opacity'),'1','Hover reveals checkbox');
 assert.equal(await run('getComputedStyle(document.querySelector(".thread__avatar-wrap > .avatar")).visibility'),'hidden');
 await run('document.querySelector(".thread__check").click()');
 win.webContents.sendInputEvent({type:'mouseMove',x:0,y:0});await delay(180);
 assert.equal(await run('getComputedStyle(document.querySelector(".thread__check")).opacity'),'1','Selection remains visible after leaving avatar');
 await run('document.querySelector(".thread__check").click()');await delay(180);
 assert.equal(await run('getComputedStyle(document.querySelector(".thread__check")).opacity'),'0');
 assert.equal(await run('getComputedStyle(document.querySelector(".thread__avatar-wrap > .avatar")).visibility'),'visible');

 await run('document.querySelector(".thread-message__files > summary").click()');await until('document.querySelector(".thread-message__files").open');await capture('light-attachments-1440');
 assert.equal(await run('document.querySelectorAll(".attachments .attachment").length'),2);
 assert.ok(await run('document.querySelector(".attachment").getAttribute("aria-label").includes("Term_Sheet")'),'Attachment has a filename in its accessible action');
 await viewport(800);await capture('light-attachments-800');await viewport(1440);

 await run('document.querySelector(\\'.reading__toolbar [aria-label="Lectura enfocada"]\\').click()');
 assert.equal(await run('getComputedStyle(document.querySelector(".rail")).display'),'none');
 assert.equal(await run('getComputedStyle(document.querySelector(".list")).display'),'none');
 await capture('light-focused-1440');
 await run('document.querySelector(\\'.reading__toolbar [aria-label="Mostrar navegación"]\\').click()');
 assert.notEqual(await run('getComputedStyle(document.querySelector(".rail")).display'),'none');
 await run('document.querySelector(".participants__details").click()');await until('!!document.querySelector(".recipients-dialog[open]")');
 assert.ok(await run('document.querySelector(".recipients-dialog").textContent.includes("elena@sequoia.vc")'));await capture('light-details-1440');
 await run('document.querySelector(\\'.recipients-dialog [aria-label="Cerrar"]\\').click()');await until('!document.querySelector(".recipients-dialog")');
 await viewport(1080);await capture('light-reading-1080');await viewport(800);await capture('light-reading-800');
 await run('document.querySelector(".reading__back").click()');await until('getComputedStyle(document.querySelector(".list")).display!=="none"');
 await viewport(1440);
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

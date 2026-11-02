import assert from 'node:assert/strict'
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {build} from 'vite'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url), project = process.cwd(), ts = require('typescript-test')
const folder = await mkdtemp(join(tmpdir(), 'namio-signatures-'))
const compile = source => ts.transpile(source, {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022})
try {
  await writeFile(join(folder, 'settings.json'), JSON.stringify({language:'es'}))
  await writeFile(join(folder, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
  await writeFile(join(folder, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('api',{getSettings:()=>ipcRenderer.invoke('settings:get'),setSettings:patch=>ipcRenderer.invoke('settings:set',patch)});`)
  await writeFile(join(folder, 'main.tsx'), `
import React,{useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
import {SignatureSection} from '${project}/src/renderer/src/components/SignatureSection';
import {ComposeOverlay} from '${project}/src/renderer/src/components/ComposeOverlay';
import {I18nProvider} from '${project}/src/renderer/src/i18n';
import {PreferencesProvider} from '${project}/src/renderer/src/settings/PreferencesProvider';
import {ShortcutsProvider} from '${project}/src/renderer/src/settings/ShortcutsProvider';
import '${project}/node_modules/@fontsource-variable/inter/index.css';
import '${project}/node_modules/material-symbols/outlined.css';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
localStorage.setItem('namio.language','es');
window.keys={one:JSON.stringify(['mail.example.test',993,'ana@example.test']),two:JSON.stringify(['mail.example.test',993,'beto@example.test'])};
function Harness(){
 const [account,setAccount]=useState('one'),[mode,setMode]=useState('settings'),[draft,setDraft]=useState({to:'recipient@example.test',cc:'',subject:'Signature test',body:'Hola equipo',html:undefined});
 window.showCompose=()=>setMode('compose');window.chooseAccount=id=>{setAccount(id);setDraft({to:'recipient@example.test',cc:'',subject:'Signature test',body:'Hola equipo',html:undefined});setMode('settings')};
 return <><main className="settings-stack" style={{maxWidth:900,padding:32,margin:'auto'}}>{mode==='settings'&&<SignatureSection key={account} accountKey={window.keys[account]}/>}</main>
 <ComposeOverlay key={account} signatureKey={window.keys[account]} open={mode==='compose'} {...draft} copilot={false} onClose={async value=>{window.savedDraft=value;setDraft(value);setMode('settings')}} onDiscard={async()=>setMode('settings')} onSend={async value=>{window.sent=value;setMode('settings')}}/>
 </>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><ShortcutsProvider><PreferencesProvider><Harness/></PreferencesProvider></ShortcutsProvider></I18nProvider></React.StrictMode>);
`)
  await build({configFile:false,root:folder,base:'./',plugins:[react()],resolve:{alias:{'@shared':join(project,'src/shared'),react:join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}},build:{outDir:join(folder,'dist')},logLevel:'error'})
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow,ipcMain}=require('electron'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs/promises');
app.setPath('userData',${JSON.stringify(folder)});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const settings={};vm.runInNewContext(${JSON.stringify(compile(await readFile('src/main/settings.ts','utf8')))},{exports:settings,require:id=>id==='@shared/ipc'?require(${JSON.stringify(join(project,'scripts/load-shared-ipc.cjs'))}):require(id)});
 ipcMain.handle('settings:get',()=>settings.readAppSettings());ipcMain.handle('settings:set',(_event,patch)=>settings.writeSettings(settings.sanitizeSettingsPatch(patch)));
 const win=new BrowserWindow({show:false,width:1080,height:800,webPreferences:{preload:${JSON.stringify(join(folder,'preload.cjs'))},offscreen:true,contextIsolation:true,sandbox:true}});
 const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('Renderer:',event.message)}});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false});
 const run=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async code=>{for(let i=0;i<150;i++){if(await run(code))return;await delay(20)}throw Error('Did not settle: '+code)};
 await until('!!document.querySelector(".signature-editor .tiptap")?.editor');
 const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGNsaP7PQApgIkn1qIZRDUNKAwBWBwIi7kQ8QgAAAABJRU5ErkJggg==';
 const html='<p><strong>Ana Firma</strong></p><p><a href="https://example.test">Mi empresa</a></p><p><img src="'+logo+'" width="90" alt="Logotipo"></p>';
 await run('document.querySelector(".signature-editor .tiptap").editor.commands.setContent('+JSON.stringify(html)+')');await delay(50);
 await run('document.querySelector(".signature-actions button").click()');await until('document.querySelector(".signature-actions [role=status]")?.textContent.includes("Firma guardada")');
 const oneKey=await run('window.keys.one'),twoKey=await run('window.keys.two');
 let stored=await settings.readAppSettings();assert.ok(stored.signatures[oneKey].includes('<strong>Ana Firma</strong>'));assert.ok(stored.signatures[oneKey].includes(logo));
 for(const theme of ['dark','light']){
  await run('document.documentElement.dataset.appTheme='+JSON.stringify(theme));await delay(200);win.webContents.invalidate();await delay(150);await fs.writeFile('/tmp/namio-signature-settings-'+theme+'.png',(await win.webContents.capturePage()).toPNG());
 }
 await run('window.showCompose()');await until('!!document.querySelector(".composer .tiptap")?.editor&&!!document.querySelector("[data-tooltip^=Insertar]")&&!document.querySelector("[data-tooltip^=Insertar]").disabled');
 assert.equal(await run('document.querySelector(".composer .tiptap").editor.getText().includes("Ana Firma")'),false,'a saved signature is not injected automatically');
 await run('document.querySelector(".composer .tiptap").editor.commands.focus("end");document.querySelector("[data-tooltip^=Insertar]").click()');
 await until('document.querySelector(".composer .tiptap").textContent.includes("Ana Firma")');
 assert.ok(await run('Array.from(document.querySelectorAll(".composer .tiptap img[src]")).some(image=>image.src.startsWith("data:image/png"))'));
 win.webContents.invalidate();await delay(200);await fs.writeFile('/tmp/namio-signature-compose.png',(await win.webContents.capturePage()).toPNG());
 await run('document.querySelector(".composer__head [data-tooltip=Cerrar]").click()');await until('!!window.savedDraft&&!!document.querySelector(".signature-editor .tiptap")?.editor');
 assert.ok(await run('window.savedDraft.body.includes("Hola equipo")&&window.savedDraft.body.includes("Ana Firma")'));
 assert.ok(await run('window.savedDraft.body.split(String.fromCharCode(10)).includes("Hola equipo")'),'the signature occupies its own paragraph instead of joining the message text');
 assert.ok(await run('window.savedDraft.html.includes("<strong>")&&window.savedDraft.html.includes("data:image/png")'));
 await run('window.showCompose()');await until('!!document.querySelector(".composer .tiptap")?.editor');
 assert.equal(await run('(document.querySelector(".composer .tiptap").editor.getText().match(/Ana Firma/g)||[]).length'),1,'draft reopening preserves the inserted signature without duplication');
 await run('document.querySelector(".send-btn").click()');await until('!!window.sent');
 assert.ok(await run('window.sent.html.includes("Ana Firma")&&window.sent.html.includes("data:image/png")&&window.sent.body.includes("Ana Firma")'),'sending retains HTML/logo and plain-text signature');
 await run('window.chooseAccount("two")');await until('!!document.querySelector(".signature-editor .tiptap")?.editor');
 assert.equal(await run('document.querySelector(".signature-editor .tiptap").editor.getText()'),'','another account starts without a signature');
 await run('document.querySelector(".signature-editor .tiptap").editor.commands.setContent("<p>Beto Firma</p>")');await delay(50);
 await run('document.querySelector(".signature-actions button").click()');await until('document.querySelector(".signature-actions [role=status]")?.textContent.includes("Firma guardada")');
 stored=await settings.readAppSettings();assert.ok(stored.signatures[oneKey].includes('Ana Firma'));assert.ok(stored.signatures[twoKey].includes('Beto Firma'));
 await run('window.showCompose()');await until('!!document.querySelector("[data-tooltip^=Insertar]")&&!document.querySelector("[data-tooltip^=Insertar]").disabled');
 await run('document.querySelector("[data-tooltip^=Insertar]").click()');await until('document.querySelector(".composer .tiptap").textContent.includes("Beto Firma")');
 assert.equal(await run('document.querySelector(".composer .tiptap").textContent.includes("Ana Firma")'),false,'signature insertion follows the current account');
 await run('window.chooseAccount("one")');await until('!!document.querySelector(".signature-editor .tiptap")?.editor');
 await run('document.querySelector(".signature-editor .tiptap").editor.commands.setContent('+JSON.stringify('<p><img src="'+logo+'" alt="Logotipo"></p>')+')');await delay(50);
 await run('document.querySelector(".signature-actions button").click()');await until('document.querySelector(".signature-actions [role=status]")?.textContent.includes("Firma guardada")');
 assert.ok((await settings.readAppSettings()).signatures[oneKey].includes(logo),'image-only signatures are saved instead of being mistaken for empty content');
 assert.deepEqual(errors,[]);console.log('Signatures: persisted rich text/logo, manual insertion, draft reopening, sent HTML/plain text, per-account isolation and both themes passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  assert.equal(code,0,'Signature UI checks')
} finally {await rm(folder,{recursive:true,force:true})}

import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {build} from 'vite'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url), project = process.cwd()
const folder = await mkdtemp(join(tmpdir(), 'namio-attachment-ui-'))
try {
  await writeFile(join(folder, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
  await writeFile(join(folder, 'main.tsx'), `
import React,{useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
import {DocumentViewer} from '${project}/src/renderer/src/components/DocumentViewer';
import {ImageViewer} from '${project}/src/renderer/src/components/ImageViewer';
import {I18nProvider,useI18n} from '${project}/src/renderer/src/i18n';
import '${project}/node_modules/@fontsource-variable/inter/index.css';
import '${project}/node_modules/material-symbols/outlined.css';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
localStorage.setItem('namio.language','es');window.retries=0;
function Harness(){
 const {t}=useI18n();const [state,setState]=useState({kind:'pdf',error:false,phase:'waiting',revision:0});
 window.show=(kind,error,phase)=>setState(current=>({...current,kind,error,phase,revision:current.revision+1}));
 const props={title:state.kind==='pdf'?'Informe.pdf':'Imagen.png',error:state.error,revision:state.revision,loadingLabel:t('attachment.'+state.phase),onClose:()=>window.closed=true,onSave:()=>{},onRetry:()=>{window.retries++;setState(current=>({...current,error:false,phase:'downloading',revision:current.revision+1}))}};
 return state.kind==='pdf'?<DocumentViewer {...props}/>:<ImageViewer {...props}/>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Harness/></I18nProvider></React.StrictMode>);
`)
  await build({configFile:false, root:folder, base:'./', plugins:[react()], resolve:{alias:{'@shared':join(project,'src/shared'),react:join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}}, build:{outDir:join(folder,'dist')}, logLevel:'error'})
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1080,height:800,webPreferences:{offscreen:true}});
 const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});
 win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false});
 const run=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await delay(20)}throw Error('Did not settle: '+code)};
 await until('!!window.show');await run('document.fonts.ready');
 for(const theme of ['dark','light']){
  await run('document.documentElement.dataset.appTheme='+JSON.stringify(theme));
  for(const kind of ['pdf','image']){
   for(const [phase,text] of [['waiting','Esperando para descargar'],['downloading','Descargando adjunto'],['preparing','Preparando']]){
    await run('window.show('+JSON.stringify(kind)+',false,'+JSON.stringify(phase)+')');
    await until('document.querySelector("dialog[open] [role=status]")?.textContent.includes('+JSON.stringify(text)+')');
   }
   await run('window.show('+JSON.stringify(kind)+',true,"waiting")');await until('!!document.querySelector("[role=alert] button")');await delay(220);
   const bounds=await run('(()=>{const button=document.querySelector("[role=alert] button").getBoundingClientRect(),dialog=document.querySelector("dialog").getBoundingClientRect();return {fits:button.width>0&&button.height>=28&&button.left>=dialog.left&&button.right<=dialog.right}})()');
   assert.ok(bounds.fits,'Retry is visible and fits the dialog');
   win.webContents.invalidate();await delay(150);await fs.writeFile('/tmp/namio-attachment-'+kind+'-'+theme+'.png',(await win.webContents.capturePage()).toPNG());
   const before=await run('window.retries');await run('document.querySelector("[role=alert] button").click()');
   await until('document.querySelector("dialog[open] [role=status]")?.textContent.includes("Descargando adjunto")');
   assert.equal(await run('window.retries'),before+1);
  }
 }
 assert.deepEqual(errors,[]);console.log('Attachment preview UI: all loading phases and visible retry in document/image dialogs, light/dark themes passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child = spawn(require('electron'), ['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')], {stdio:'inherit'})
  const code = await new Promise((resolve,reject) => {child.once('error',reject);child.once('exit',resolve)})
  assert.equal(code,0,'Chromium attachment preview checks')
} finally {await rm(folder,{recursive:true,force:true})}

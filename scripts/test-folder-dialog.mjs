import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {build} from 'vite'
import react from '@vitejs/plugin-react'
const require=createRequire(import.meta.url), project=process.cwd()
const folder=await mkdtemp(join(tmpdir(),'namio-folder-ui-'))
try {
 await writeFile(join(folder,'index.html'),'<div id="root"></div><script type="module" src="/main.tsx"></script>')
 await writeFile(join(folder,'main.tsx'),`
import React,{useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
import {FolderDialog} from '${project}/src/renderer/src/components/FolderDialog';
import {I18nProvider} from '${project}/src/renderer/src/i18n';
import '${project}/src/renderer/src/styles/tokens.css';import '${project}/src/renderer/src/styles/app.css';
localStorage.setItem('namio.language','es');
function Harness(){const [open,setOpen]=useState(true);return open?<FolderDialog onClose={()=>setOpen(false)} onCreate={async name=>{window.created=name;await new Promise((resolve,reject)=>{window.finish=resolve;window.fail=()=>reject(Error('Server refused'))})}}/>:<p>Closed</p>}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness/></I18nProvider>);
`)
 await build({configFile:false,root:folder,base:'./',plugins:[react()],resolve:{alias:{'@shared':join(project,'src/shared'),react:join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}},build:{outDir:join(folder,'dist')},logLevel:'error'})
 await writeFile(join(folder,'runner.cjs'),`
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const capture=require(${JSON.stringify(join(project,'scripts/capture-page.cjs'))});
app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(folder,'profile'))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:480,height:650,webPreferences:{offscreen:true}});await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});
 const run=code=>win.webContents.executeJavaScript(code);const until=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out: '+code)};
 await until('!!document.querySelector("dialog[open] input")');
 assert.equal(await run('document.activeElement===document.querySelector("input")'),true);
 const name=async value=>{await run('(()=>{const i=document.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}))})()');await new Promise(r=>setTimeout(r,30))};
 assert.equal(await run('document.querySelector(".btn--primary").disabled'),true);await name('A/B');assert.equal(await run('document.querySelector(".btn--primary").disabled'),true);
 await name('Trabajo');
 win.setSize(481,650);await new Promise(r=>setTimeout(r,100));win.setSize(480,650);win.webContents.invalidate();await new Promise(r=>setTimeout(r,200));
 for(const theme of ['light','dark']){await run('document.documentElement.dataset.appTheme='+JSON.stringify(theme));await new Promise(r=>setTimeout(r,150));await fs.writeFile('/tmp/namio-folder-'+theme+'.png',(await capture(win.webContents)).toPNG())}
 await run('document.querySelector(".btn--primary").click()');await until('!!window.fail');assert.equal(await run('window.created'),'Trabajo');assert.equal(await run('document.querySelector("input").disabled'),true);
 await run('window.fail()');await until('!!document.querySelector("[role=alert]")');assert.equal(await run('document.querySelector("input").value'),'Trabajo');
 await run('document.querySelector(".btn--primary").click()');await until('document.querySelector("input").disabled');await run('window.finish()');await until('!document.querySelector("dialog")');
 console.log('Folder dialog: native focus, validation, busy state, server error preservation and successful close passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
 const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
 assert.equal(await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)}),0)
} finally {await rm(folder,{recursive:true,force:true})}

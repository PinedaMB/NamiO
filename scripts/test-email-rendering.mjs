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
const folder = await mkdtemp(join(tmpdir(), 'namio-email-rendering-'))
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640"><rect width="1200" height="640" fill="#ffae16"/></svg>')
const html = `<html class="receipt-html"><head><style>
html.receipt-html { font-size:20px; height:100%; }
body.receipt-body { padding:0; height:100%; }
.receipt { width:600px; max-width:100%; margin:auto; }
.banner { height:160px; text-align:right; background:#f2f5f8; }
.total { background:#fff; padding:24px; border-top:2px solid #ddd; }
.measure { width:3rem; height:20px; }
@media (max-width:420px) { html.receipt-html { font-size:10px; } .receipt { width:100%; } }
</style><meta http-equiv="refresh" content="0;url=https://example.invalid/"><base href="https://example.invalid/"></head>
<body class="receipt-body" style="margin:0"><div class="receipt"><div class="banner"><img id="illustration" height="160" width="auto" src="${image}"></div><div class="total">Total <strong>MXN$49.00</strong><div class="measure"></div></div></div>
<img id="remote" src="https://example.invalid/pixel.png" onerror="window.unsafe=true" srcset="https://example.invalid/pixel2.png 2x"><div id="footer" style="height:800px">End of receipt</div><form><input></form><script>window.unsafe=true</script></body></html>`
try {
  await writeFile(join(folder, 'index.html'), '<html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
  await writeFile(join(folder, 'main.tsx'), `
import React, {useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
import {EmailBody} from '${project}/src/renderer/src/components/EmailBody';
import {I18nProvider} from '${project}/src/renderer/src/i18n';
import {PreferencesProvider} from '${project}/src/renderer/src/settings/PreferencesProvider';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
function Harness(){const [theme,setTheme]=useState('light');window.setTheme=setTheme;return <EmailBody html={${JSON.stringify(html)}} theme={theme}/>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><PreferencesProvider><Harness/></PreferencesProvider></I18nProvider></React.StrictMode>);
`)
  await build({ configFile:false, root:folder, base:'./', plugins:[react()], resolve:{alias:{'@shared':join(project,'src/shared'),'react':join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}}, build:{outDir:join(folder,'dist'),emptyOutDir:true}, logLevel:'error' })
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(folder, 'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:900,height:700,useContentSize:true,webPreferences:{offscreen:true}});
 const errors=[];
 win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});
 for(const width of [900,400]){
  win.setContentSize(width,700);
  for(const theme of ['light','dark','light']){
   await win.webContents.executeJavaScript('window.setTheme('+JSON.stringify(theme)+')');
   const result=await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
    const tick=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    let frame;
    for(let i=0;i<200;i++){frame=document.querySelector('iframe');if(frame?.style.visibility==='visible'&&frame.contentDocument?.querySelector('#illustration')?.complete)break;await tick()}
    await tick();await tick();
    const doc=frame.contentDocument,view=doc.defaultView;
    const image=doc.querySelector('#illustration'),total=doc.querySelector('.total');
    return {width:innerWidth,frameWidth:frame.clientWidth,frameHeight:frame.clientHeight,contentBottom:doc.querySelector('#footer').getBoundingClientRect().bottom,imageHeight:image.getBoundingClientRect().height,imageBottom:image.getBoundingClientRect().bottom,totalTop:total.getBoundingClientRect().top,measure:doc.querySelector('.measure').getBoundingClientRect().width,theme:doc.documentElement.dataset.emailTheme,rootClass:doc.documentElement.className,bodyClass:doc.body.className,sheets:doc.querySelectorAll('style').length,unsafe:!!doc.querySelector('script,form,input,base,meta[http-equiv="refresh"],[onerror],[srcset]'),remote:doc.querySelector('#remote').src,csp:doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content,sandbox:frame.getAttribute('sandbox')};
   })()`)});
   assert.equal(result.theme,theme);assert.equal(result.rootClass,'receipt-html');assert.equal(result.bodyClass,'receipt-body');
   assert.equal(result.imageHeight,160);assert.ok(result.totalTop>=result.imageBottom,'Illustration must not overlap the total');
   assert.ok(result.frameHeight>=result.contentBottom,'Percentage-height emails must show their footer instead of clipping at 140px: '+JSON.stringify(result));
   assert.equal(result.measure,width===900?60:30,'Embedded CSS, rem sizing and responsive rules survive');
   assert.equal(result.sheets,2,'StrictMode must not duplicate base styles');
   assert.equal(result.unsafe,false);assert.ok(result.remote.startsWith('data:image/gif;'));
   assert.ok(result.csp.includes("default-src 'none'"));assert.ok(result.csp.includes('img-src data:'));assert.equal(result.sandbox,'allow-same-origin');
   const grew=await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
    const frame=document.querySelector('iframe'),footer=frame.contentDocument.querySelector('#footer');
    footer.style.height='1200px';
    for(let i=0;i<100;i++){await new Promise(resolve=>requestAnimationFrame(resolve));if(frame.clientHeight>=footer.getBoundingClientRect().bottom)return true}
    return false;
   })()`)});
   assert.ok(grew,'Late content growth must resize percentage-height emails');
  }
 }
 assert.deepEqual(errors,[],'Email resizing and theme toggles must not produce renderer errors');
 console.log('Email rendering: head CSS, root/body classes, authored image height, no overlap, responsive rules, theme toggles and security passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child = spawn(require('electron'), ['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')], {stdio:'inherit'})
  const code = await new Promise((resolve,reject) => { child.once('error',reject);child.once('exit',resolve) })
  assert.equal(code,0)
} finally { await rm(folder,{recursive:true,force:true}) }

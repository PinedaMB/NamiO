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
const folder = await mkdtemp(join(tmpdir(), 'namio-copilot-ui-'))
try {
 await writeFile(join(folder,'index.html'),'<html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
 await writeFile(join(folder,'main.tsx'), `
import React,{useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
import {ComposeOverlay} from '${project}/src/renderer/src/components/ComposeOverlay';
import {CopilotSettings} from '${project}/src/renderer/src/components/CopilotSettings';
import {I18nProvider} from '${project}/src/renderer/src/i18n';
import {PreferencesProvider} from '${project}/src/renderer/src/settings/PreferencesProvider';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
import '${project}/node_modules/@fontsource-variable/inter/index.css';
import '${project}/node_modules/material-symbols/outlined.css';
localStorage.setItem('namio.language','es');
let configured=false,finish;let config={provider:'gemini',ollamaUrl:'http://127.0.0.1:11434',ollamaModel:''};
window.inputs=[];window.cancels=0;
window.api={getSettings:async()=>({language:'es'}),setSettings:async()=>{},copilotStatus:async()=>({...config,hasGeminiKey:configured,geminiKeyStorage:configured?(window.sessionOnly?'session':'encrypted'):'none'}),configureCopilot:async next=>{config={...next};window.savedConfig=config},
 setCopilotKey:async key=>{if(key.includes(' '))throw Error('Invalid API key');configured=!!key;window.lastKey=key;return configured?(window.sessionOnly?'session':'encrypted'):'none'},generateCopilot:async input=>{window.inputs.push(input);return new Promise(resolve=>{finish=resolve})},cancelCopilot:async()=>{window.cancels++;finish?.({error:'canceled'})}};
window.resolveProposal=result=>finish(result);
function Harness(){const [settings,setSettings]=useState(true);const [minimized,setMinimized]=useState(false);window.showSettings=setSettings;
return settings?<div className="settings"><main className="settings__main"><CopilotSettings/></main></div>:<ComposeOverlay open copilot={false} ai minimized={minimized} onMinimize={async()=>setMinimized(true)} onRestore={()=>setMinimized(false)} to="a@example.test" subject="Test" body="Original draft" html='<p><strong>Original draft</strong></p><blockquote data-namio-reply-quote="true"><p>Original context</p></blockquote>' onClose={async()=>{}} onDiscard={async()=>{}} onSend={async()=>{}}/>}
createRoot(document.getElementById('root')).render(<I18nProvider><PreferencesProvider><Harness/></PreferencesProvider></I18nProvider>);
`)
 await build({configFile:false,root:folder,base:'./',plugins:[react()],resolve:{alias:{'@shared':join(project,'src/shared'),react:join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}},build:{outDir:join(folder,'dist'),emptyOutDir:true},logLevel:'error'})
 await writeFile(join(folder,'runner.cjs'), `
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1080,height:850,webPreferences:{offscreen:true}});
 const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
 for(const provider of ['gemini','ollama']){
  await win.webContents.executeJavaScript('(async()=>{for(let i=0;i<100&&document.querySelector("fieldset")?.disabled;i++)await new Promise(r=>setTimeout(r,20));document.querySelector(\\'input[name="ai-provider"][value="'+provider+'"]\\').click()})()');
  for(const width of [1080,480]){
   await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
   for(const theme of ['light','dark']){
    await win.webContents.executeJavaScript('document.documentElement.dataset.appTheme="'+theme+'"');await new Promise(r=>setTimeout(r,250));
    assert.equal(await win.webContents.executeJavaScript('(()=>{const s=document.querySelector(".ai-settings");return s.scrollWidth<=s.clientWidth&&[...s.querySelectorAll(".provider-icon")].every(i=>getComputedStyle(i).maskImage!=="none")})()'),true,'Settings fit and provider icons load');
    if(provider==='gemini'){
     await win.webContents.executeJavaScript('document.querySelector(".password-field input").focus()');
     const focus=await win.webContents.executeJavaScript('(()=>{const input=document.querySelector(".password-field input"),s=getComputedStyle(input),r=input.getBoundingClientRect(),p=document.querySelector(".settings__main").getBoundingClientRect();return {left:r.left,right:r.right,viewportLeft:p.left,viewportRight:p.right,outline:s.outlineWidth,offset:s.outlineOffset,style:s.outlineStyle,focused:input.matches(":focus"),active:document.activeElement===input,disabled:input.matches(":disabled")}})()');
     const outside=Math.max(0,parseFloat(focus.outline)+parseFloat(focus.offset));
     assert.ok(focus.focused&&focus.left-outside>=focus.viewportLeft&&focus.right+outside<=focus.viewportRight,'Key focus ring fits: '+JSON.stringify(focus));
    }
    await fs.writeFile('/tmp/namio-provider-settings-'+provider+'-'+width+'-'+theme+'.png',(await win.webContents.capturePage()).toPNG());
   }
  }
 }
 await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1080,height:850,deviceScaleFactor:1,mobile:false});
 await win.webContents.executeJavaScript('document.querySelector(\\'input[name="ai-provider"][value="gemini"]\\').click()');
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Copilot UI condition timed out: '+document.body.innerText.slice(0,1600))};
 const button=text=>[...document.querySelectorAll('button')].find(b=>{const label=b.cloneNode(true);label.querySelectorAll('[aria-hidden=true]').forEach(icon=>icon.remove());return label.textContent.trim()===text});
 const change=(node,value)=>{Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
 const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const assert=(ok,message)=>{if(!ok)throw Error(message)};
 await until(()=>document.querySelector('[aria-label="Clave API de Gemini"]')&&!document.querySelector('fieldset').disabled);
 assert(document.querySelector('[aria-label="Clave API de Gemini"]').getBoundingClientRect().height>=38,'Key field has full control height');
 change(document.querySelector('[aria-label="Clave API de Gemini"]'),'AQ.'+'a'.repeat(500)+'.test-key');await tick();
 await until(()=>!button('Guardar configuración').disabled);button('Guardar configuración').click();
 await until(()=>document.querySelector('[role=status]')?.textContent.includes('Clave guardada'));
 assert(document.querySelector('[aria-label="Clave API de Gemini"]').value==='','Key cleared after saving');
 assert(window.lastKey==='AQ.'+'a'.repeat(500)+'.test-key','Pasted opaque auth key is preserved');
 const provider=value=>document.querySelector('input[name="ai-provider"][value="'+value+'"]').click();
 provider('ollama');await until(()=>document.querySelector('input[type=url]'));
 change(document.querySelector('input[type=url]'),'http://127.0.0.1:11434');
 change(document.querySelector('input[placeholder="modelo:etiqueta"]'),'test-local:latest');await tick();
 button('Guardar configuración').click();await until(()=>window.savedConfig?.provider==='ollama');await tick();
 assert(window.savedConfig.ollamaModel==='test-local:latest','Ollama model saved');
 provider('gemini');await until(()=>button('Eliminar clave'));
 assert(document.querySelector('[role=status]').textContent.includes('Clave guardada'),'Gemini key retained when switching');
 button('Guardar configuración').click();await until(()=>window.savedConfig.provider==='gemini');await tick();
 button('Eliminar clave').click();await until(()=>document.querySelector('[role=status]')?.textContent.includes('Sin clave'));
 assert(window.lastKey==='','Key removed');
 window.sessionOnly=true;
 change(document.querySelector('[aria-label="Clave API de Gemini"]'),'session-test-key');await tick();
 button('Guardar configuración').click();await until(()=>document.querySelector('[role=status]')?.textContent.includes('solo durante esta sesión'));await tick();
 assert(!document.querySelector('[role=alert]'),'No secure storage is a session notice, not a save failure');
 button('Eliminar clave').click();await until(()=>document.querySelector('[role=status]')?.textContent.includes('Sin clave'));await tick();
 change(document.querySelector('[aria-label="Clave API de Gemini"]'),'invalid key');await tick();button('Guardar configuración').click();
 await until(()=>document.querySelector('[role=alert]')?.textContent.includes('formato no válido'));

 provider('ollama');await until(()=>document.querySelector('input[type=url]'));
 assert(document.querySelector('input[placeholder="modelo:etiqueta"]').value==='test-local:latest','Ollama config retained');
 button('Guardar configuración').click();await until(()=>window.savedConfig.provider==='ollama');await tick();
 window.showSettings(false);await until(()=>document.querySelector('.tiptap')?.editor);
 document.querySelector('.composer__editor-heading button').click();await until(()=>document.querySelector('.ai-panel textarea'));
 const editor=document.querySelector('.tiptap').editor;
 await until(()=>document.querySelector('.ai-panel')?.textContent.includes('Ollama · test-local:latest'));
 assert(document.querySelector('.ai-panel').textContent.includes('servidor Ollama'),'Provider-specific privacy message');
 change(document.querySelector('.ai-panel textarea'),'Write a reply');await until(()=>!button('Redactar').disabled);button('Redactar').click();
 await until(()=>window.inputs.length===1);assert(window.inputs[0].provider==='ollama','Generation uses the displayed provider');assert(window.inputs[0].context==='','Context excluded by default');
 assert(editor.getText()==='Original draft','Generation does not overwrite draft');
 window.resolveProposal({text:'Proposal <script>alert(1)</script>\\n\\nSegundo párrafo.'});await until(()=>document.querySelector('.ai-proposal'));
 assert(!document.querySelector('.ai-proposal script'),'Proposal renders as text');
 const panel=document.querySelector('.ai-panel');
 const toggle=()=>document.querySelector('.composer__editor-heading button').click();
 change(document.querySelector('.ai-panel select'),'warm');await tick();
 toggle();await until(()=>document.querySelector('#composer-ai').hidden);
 toggle();await until(()=>!document.querySelector('#composer-ai').hidden);
 assert(document.querySelector('.ai-panel')===panel,'Hiding the copilot preserves its mounted state');
 assert(document.querySelector('.ai-panel textarea').value==='Write a reply'&&document.querySelector('.ai-panel select').value==='warm','Instructions and tone survive reopening');
 assert(document.querySelector('.ai-proposal').textContent.includes('Segundo párrafo.'),'Proposal survives reopening');
 document.querySelector('.composer__head [aria-label="Minimizar"]').click();await until(()=>document.querySelector('.composer--minimized'));
 document.querySelector('.composer__head [aria-label="Restaurar mensaje"]').click();await until(()=>!document.querySelector('.composer--minimized'));
 assert(document.querySelector('.ai-panel')===panel&&document.querySelector('.ai-proposal'),'Minimizing the composer preserves its copilot proposal');

 button('Aplicar al editor').click();await until(()=>editor.getText().includes('Proposal'));
 assert(!button('Deshacer aplicación').disabled,'Applied proposal is not incorrectly marked as changed');
 toggle();await tick();toggle();await tick();assert(!button('Deshacer aplicación').disabled,'Undo survives closing and reopening the copilot');
 assert(!editor.view.dom.querySelector('script'),'Applied AI text is escaped in the editor');
 assert(editor.view.dom.querySelectorAll('p').length===2&&!editor.view.dom.querySelector('p:empty'),'AI paragraph breaks do not add empty paragraphs');
 button('Deshacer aplicación').click();await until(()=>editor.getText()==='Original draft');assert(editor.getHTML().includes('<strong>'),'Undo restores rich formatting');
 document.querySelector('.ai-context input').click();
 button('Mejorar borrador').click();await until(()=>window.inputs.length===2);assert(window.inputs[1].context.includes('Original context'),'Original email requires opt-in');
 toggle();await tick();
 editor.chain().selectAll().toggleItalic().run();window.resolveProposal({text:'Stale response'});await until(()=>document.querySelector('.ai-proposal')?.textContent==='Stale response');
 toggle();await tick();
 assert(document.querySelector('.ai-context input').checked,'Context choice survives hiding');
 assert(button('Aplicar al editor').disabled,'Stale response cannot overwrite formatting edits');
 editor.commands.insertContent(' changed');
 button('Redactar').click();await until(()=>window.inputs.length===3);button('Cancelar').click();await until(()=>document.querySelector('.ai-panel [role=alert]'));
 assert(window.cancels===1&&editor.getText().includes('changed'),'Cancel preserves edits');
 button('Redactar').click();await until(()=>window.inputs.length===4);window.resolveProposal({error:'limit'});await until(()=>document.querySelector('.ai-panel [role=alert]')?.textContent.includes('límite'));
 button('Redactar').click();await until(()=>window.inputs.length===5);window.resolveProposal({text:['Estimado equipo:', 'Espero que se encuentren muy bien.', 'Les escribo para solicitar permiso para retirarme una hora antes de mi horario habitual este viernes.', 'Dejaré organizados mis pendientes para que puedan revisarlos antes de mi salida.', 'Agradezco su atención y quedo pendiente de su respuesta.', 'Saludos cordiales.'].join(String.fromCharCode(10,10))});await until(()=>document.querySelector('.ai-proposal'));
})()`)});
 for(const width of [1080,480]){
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
  for(const theme of ['light','dark']){
   await win.webContents.executeJavaScript('document.documentElement.dataset.appTheme="'+theme+'"');
   await new Promise(r=>setTimeout(r,250));
   assert.equal(await win.webContents.executeJavaScript('(()=>{const p=document.querySelector(".ai-panel");return p.scrollWidth<=p.clientWidth})()'),true,'Copilot does not overflow');
   assert.equal(await win.webContents.executeJavaScript('(()=>{const s=document.querySelector(".ai-panel__scroll"),head=document.querySelector(".ai-panel__head"),foot=document.querySelector(".ai-panel__foot"),h=head.getBoundingClientRect(),f=foot.getBoundingClientRect();s.scrollTop=s.scrollHeight;const after=head.getBoundingClientRect();return h.top===after.top&&f.bottom<=innerHeight&&f.top>=h.bottom})()'),true,'Copilot header and apply action remain visible while scrolling');
   await fs.writeFile('/tmp/namio-copilot-'+width+'-'+theme+'.png',(await win.webContents.capturePage()).toPNG());
  }
 }
 assert.deepEqual(errors,[]);console.log('Copilot UI: Gemini/Ollama selection and persistence, key settings, review, plain output, rich undo, stale response, cancellation, quota errors and light/dark responsive layouts passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
 const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
 assert.equal(await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)}),0)
} finally {await rm(folder,{recursive:true,force:true})}

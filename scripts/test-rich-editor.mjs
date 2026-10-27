import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url)
const project = process.cwd()
const folder = await mkdtemp(join(tmpdir(), 'namio-rich-editor-'))
try {
  await writeFile(join(folder, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
  await writeFile(join(folder, 'main.tsx'), `
import React, {useEffect,useState} from '${project}/node_modules/react';
import {createRoot} from '${project}/node_modules/react-dom/client';
import {ComposeOverlay} from '${project}/src/renderer/src/components/ComposeOverlay';
import {I18nProvider} from '${project}/src/renderer/src/i18n';
import {cleanComposeHtml, composeEmailHtml, textToEditorContent} from '${project}/src/renderer/src/lib/composeHtml';
import '${project}/node_modules/@fontsource-variable/inter/index.css';
import '${project}/node_modules/@fontsource-variable/jetbrains-mono/index.css';
import '${project}/node_modules/material-symbols/outlined.css';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
localStorage.setItem('namio.language','es');
window.helpers={cleanComposeHtml,composeEmailHtml,textToEditorContent};
function Harness(){
const [value,setValue]=useState({text:'Hola, equipo.\\nTexto <literal>',html:undefined});
window.restore=setValue;window.latest=value;
const [open,setOpen]=useState(false);useEffect(()=>setOpen(true),[]);
return <main><h1 id="mailbox">Bandeja</h1><ComposeOverlay open={open} to="to@example.com" subject="Prueba" body={value.text} html={value.html} copilot={false} onClose={async draft=>{window.saved=draft;setOpen(false)}} onDiscard={async()=>setOpen(false)} onSend={async()=>{}} /></main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Harness/></I18nProvider></React.StrictMode>);
`)
  await build({ configFile:false, root:folder, base:'./', plugins:[react()], resolve:{alias:{'@shared':join(project,'src/shared'),'react':join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}}, build:{outDir:join(folder,'dist'),emptyOutDir:true}, logLevel:'error' })
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1080,height:760,webPreferences:{offscreen:true}});
 win.webContents.on('console-message',event=>{if(event.message.includes('Error'))console.error(event.message)});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});
 const result=await win.webContents.executeJavaScript(
 ${JSON.stringify(`(async()=>{
 const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 for(let i=0;i<30&&!document.querySelector('.tiptap')?.editor;i++)await tick();
 const editor=document.querySelector('.tiptap')?.editor;
 const assert=(value,message)=>{if(!value)throw new Error(message)};
 assert(editor,'Editor mounted');assert(document.getElementById('mailbox'),'Mailbox stays mounted');
 assert(editor.getText({blockSeparator:'\\n'}).includes('Texto <literal>'),'Legacy plain text remains literal');
 const button=label=>document.querySelector('[data-tooltip="'+label+'"]');
 editor.commands.selectAll();button('Negrita').click();await tick();
 assert(editor.getHTML().includes('<strong>'),'Bold toolbar works');
 button('Subrayado').click();await tick();assert(editor.getHTML().includes('<u>'),'Underline toolbar works');
 button('Deshacer').click();await tick();assert(!editor.getHTML().includes('<u>'),'Undo works');
 button('Rehacer').click();await tick();assert(editor.getHTML().includes('<u>'),'Redo works');
 button('Lista con viñetas').click();await tick();assert(editor.getHTML().includes('<ul>'),'Bullet list works');
 button('Lista con viñetas').click();await tick();
 button('Lista numerada').click();await tick();assert(editor.getHTML().includes('<ol>'),'Ordered list works');
 button('Lista numerada').click();await tick();button('Cita').click();await tick();assert(editor.getHTML().includes('<blockquote>'),'Quote works');
 button('Cita').click();await tick();
 const dirty='<p onclick="evil()" style="color:red">Safe<script>evil()</script><img src="https://example.com/pixel.png"><a href="javascript:evil()">Bad link</a><a href="https://example.com">Good link</a></p>';
 const clean=helpers.cleanComposeHtml(dirty);
 assert(!/onclick|script|<img|javascript:|style=/.test(clean),'Pasted content sanitized');
 assert(clean.includes('https://example.com'),'Safe links preserved');
 editor.commands.clearContent();
 const clipboard=new DataTransfer();clipboard.setData('text/html',dirty);clipboard.setData('text/plain','Safe Bad link Good link');
 editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));await tick();
 assert(!/onclick|script|<img|javascript:|style=/.test(editor.getHTML()),'Real paste strips unsafe markup');
 editor.commands.selectAll();button('Enlace').click();await tick();
 const linkInput=document.querySelector('.rich-editor__link input');
 const setLink=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(linkInput,value);linkInput.dispatchEvent(new Event('input',{bubbles:true}));};
 setLink('javascript:alert(1)');await tick();document.querySelector('.rich-editor__link').requestSubmit();await tick();
 assert(document.querySelector('.rich-editor__link [role="alert"]'),'Unsafe link rejected');
 setLink('https://example.com');await tick();document.querySelector('.rich-editor__link').requestSubmit();await tick();
 assert(editor.getHTML().includes('href="https://example.com"'),'Link toolbar applies a safe link');
 editor.commands.setContent('<p><strong>Hola, equipo.</strong></p><ul><li><p>Confirmar la reunión</p></li><li><p>Revisar el documento</p></li></ul><p><a href="https://example.com">Detalles de la reunión</a></p>');await tick();
 const saved=helpers.cleanComposeHtml(editor.getHTML());assert(saved&&saved.includes('<ul>'),'Rich draft representation updated');
 restore({text:'Legacy & <text>',html:undefined});await tick();assert(editor.getHTML().includes('&lt;text&gt;'),'Legacy plain draft restores safely');
 restore({text:'ignored fallback',html:saved});await tick();assert(helpers.cleanComposeHtml(editor.getHTML())===saved,'Rich draft restores formatting');
 const email=helpers.composeEmailHtml(saved);assert(email.includes('style=')&&email.includes('<strong>'),'Email serialization keeps format and inline styles');
 assert(!editor.options.editorProps.transformPastedHTML(dirty).includes('<img'),'Editor paste uses sanitizer');
 editor.commands.setTextSelection(editor.state.doc.content.size);await tick();
 return {text:editor.getText(),html:email,toolbarButtons:document.querySelectorAll('.formatbar button').length};
})()`)});
 await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
 await new Promise(resolve=>setTimeout(resolve,200));
 await fs.writeFile('/tmp/namio-rich-editor-desktop.png',(await win.webContents.capturePage()).toPNG());
 win.setSize(560,760);await new Promise(resolve=>setTimeout(resolve,100));
 const dimensions=await win.webContents.executeJavaScript('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
 if(dimensions.scroll>dimensions.width)throw new Error('Narrow editor overflows');
 await fs.writeFile('/tmp/namio-rich-editor-compact.png',(await win.webContents.capturePage()).toPNG());
 console.log('Rich editor: real Chromium toolbar, undo/redo, lists, quotes, safe paste, legacy/rich drafts, email HTML and responsive layout passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  if(code!==0)process.exitCode=1
} finally {await rm(folder,{recursive:true,force:true})}

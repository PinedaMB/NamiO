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
import {cleanComposeHtml, composeEmailHtml, textToEditorContent, replyComposeHtml} from '${project}/src/renderer/src/lib/composeHtml';
import '${project}/node_modules/@fontsource-variable/inter/index.css';
import '${project}/node_modules/@fontsource-variable/jetbrains-mono/index.css';
import '${project}/node_modules/material-symbols/outlined.css';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
localStorage.setItem('namio.language','es');
window.helpers={cleanComposeHtml,composeEmailHtml,textToEditorContent,replyComposeHtml};
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
 editor.commands.selectAll();
 const size=document.querySelector('[aria-label="Tamaño de letra"]');
 size.value='24px';size.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 assert(editor.getAttributes('textStyle').fontSize==='24px','Font size toolbar applies selected size');
 button('Color de texto').click();await tick();
 assert(document.querySelector('.color-picker:popover-open'),'Color button opens the preset palette');
 document.querySelector('.color-picker:popover-open [data-color="#1565c0"]').click();await tick();
 assert(editor.getAttributes('textStyle').color==='#1565c0','Preset blue applies to the selection');
 assert(!document.querySelector('.color-picker:popover-open'),'Choosing a preset closes the palette');
 button('Color de texto').click();await tick();document.querySelector('.color-picker:popover-open .color-picker__default').click();await tick();
 assert(!editor.getAttributes('textStyle').color&&editor.getAttributes('textStyle').fontSize==='24px','Default color removes only color, preserving size');

 const changeColor=(label,value)=>{const input=document.querySelector('input[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
 changeColor('Color de texto','#cc1122');await tick();changeColor('Resaltado','#ffee00');await tick();
 assert(editor.getAttributes('textStyle').color==='#cc1122','Text color picker applies color');
 assert(editor.getAttributes('textStyle').backgroundColor==='#ffee00','Highlight picker applies color');
 const formatted=helpers.cleanComposeHtml(editor.getHTML());
 assert(formatted.includes('font-size:24px')&&formatted.includes('background-color:')&&formatted.includes('color:'),'Sanitizer preserves permitted text formatting');
 assert(helpers.composeEmailHtml(formatted).includes('background-color:'),'Email keeps highlight');
 restore({text:'fallback',html:formatted});await tick();
 assert(editor.getAttributes('textStyle').fontSize==='24px','Formatting survives restoring a draft');
 editor.commands.selectAll();button('Quitar color de texto').click();await tick();
 assert(!editor.getAttributes('textStyle').color&&editor.getAttributes('textStyle').fontSize==='24px','Reset color preserves size and highlight');
 button('Quitar resaltado').click();await tick();assert(!editor.getAttributes('textStyle').backgroundColor,'Highlight reset works');
 button('Resaltado').click();await tick();document.querySelector('.color-picker:popover-open [data-color="#fff59d"]').click();await tick();assert(editor.getAttributes('textStyle').backgroundColor==='#fff59d','Preset yellow highlight applies');
 button('Quitar resaltado').click();await tick();
 const unsafeStyle=helpers.cleanComposeHtml('<span style="color:red;background-color:yellow;font-size:500px;position:fixed;background-image:url(https://example.com/pixel);display:none" onclick="evil()">Styled</span>');
 assert(unsafeStyle.includes('color:')&&!/500|fixed|url|display|onclick/.test(unsafeStyle),'Only safe text styles survive');
 const pointSize=helpers.cleanComposeHtml('<span style="font-size:18pt">Points</span>');assert(pointSize.includes('font-size:24px'),'Pasted point sizes normalize to pixels');
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
 editor.commands.selectAll();editor.chain().focus().setMark('textStyle',{fontSize:'20px',color:'#cc1122',backgroundColor:'#fff59d'}).run();await tick();
 const saved=helpers.cleanComposeHtml(editor.getHTML());assert(saved&&saved.includes('<ul>'),'Rich draft representation updated');
 restore({text:'Legacy & <text>',html:undefined});await tick();assert(editor.getHTML().includes('&lt;text&gt;'),'Legacy plain draft restores safely');
 restore({text:'ignored fallback',html:saved});await tick();assert(helpers.cleanComposeHtml(editor.getHTML())===saved,'Rich draft restores formatting');
 const email=helpers.composeEmailHtml(saved);assert(email.includes('style=')&&email.includes('<strong>')&&email.includes('font-size:20px')&&email.includes('background-color:'),'Email serialization keeps font size, color, highlight and inline styles');
 assert(!editor.options.editorProps.transformPastedHTML(dirty).includes('<img'),'Editor paste uses sanitizer');
 const reply=helpers.replyComposeHtml('', '27 oct, LinkedIn <sender@example.com>:', 'Vacantes disponibles\\nCiudad de México\\n<img src=x onerror=alert(1)>', 'Mensaje original');
 const replyReady=()=>editor.state.doc.firstChild.textContent===''&&editor.state.doc.childCount>1&&editor.state.doc.child(1).type.name==='blockquote';
 restore({text:'Original fallback',html:reply});await tick();
 for(let i=0;i<100&&!replyReady();i++)await tick();
 assert(replyReady(),'Replies start with an empty writing area above the original');
 const content=document.querySelector('.rich-editor__content');
 assert(content.firstElementChild.getBoundingClientRect().height>=80,'Reply area has room to write');
 assert(getComputedStyle(content,'::before').content.includes('Escribe'),'Empty reply shows the writing placeholder');
 assert(content.querySelector('blockquote strong').textContent==='Mensaje original','Original message is clearly labeled');
 assert(!content.querySelector('img')&&content.querySelector('blockquote').textContent.includes('<img'),'Quoted text is escaped instead of executed');
 editor.commands.focus('start');editor.commands.insertContent('Gracias por el aviso.');await tick();
 assert(content.firstElementChild.textContent==='Gracias por el aviso.','New text is written outside the quote');
 const replyDraft=helpers.cleanComposeHtml(editor.getHTML());
 restore({text:'Temporary',html:undefined});await tick();restore({text:'Reply fallback',html:replyDraft});await tick();
 assert(content.querySelector('blockquote')?.textContent.includes('Vacantes disponibles'),'Saved replies preserve the original quote');
 assert(helpers.composeEmailHtml(replyDraft).includes('<blockquote'),'Sent HTML retains the quote structure');
 editor.commands.setTextSelection(editor.state.doc.content.size);await tick();
 return {text:editor.getText(),html:email,toolbarButtons:document.querySelectorAll('.formatbar button').length};
})()`)});
 await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
 await win.webContents.executeJavaScript('document.activeElement.blur();document.querySelector(".composer__body").scrollTop=0');
 win.setSize(1081,760);await new Promise(resolve=>setTimeout(resolve,100));win.setSize(1080,760);
 await new Promise(resolve=>setTimeout(resolve,200));
 await fs.writeFile('/tmp/namio-rich-editor-desktop.png',(await win.webContents.capturePage()).toPNG());
 win.setSize(560,760);await new Promise(resolve=>setTimeout(resolve,100));
 await win.webContents.executeJavaScript('document.querySelector(".composer__body").scrollTop=0');
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

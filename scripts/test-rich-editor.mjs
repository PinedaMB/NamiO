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
import {PreferencesProvider} from '${project}/src/renderer/src/settings/PreferencesProvider';
import {cleanComposeHtml, composeEmailHtml, textToEditorContent, replyComposeHtml,splitReplyHtml} from '${project}/src/renderer/src/lib/composeHtml';
import '${project}/node_modules/@fontsource-variable/inter/index.css';
import '${project}/node_modules/@fontsource-variable/jetbrains-mono/index.css';
import '${project}/node_modules/material-symbols/outlined.css';
import '${project}/src/renderer/src/styles/tokens.css';
import '${project}/src/renderer/src/styles/app.css';
localStorage.setItem('namio.language','es');
window.helpers={cleanComposeHtml,composeEmailHtml,textToEditorContent,replyComposeHtml,splitReplyHtml};
function Harness(){
const [value,setValue]=useState({text:'Hola, equipo.\\nTexto <literal>',html:undefined});
window.restore=setValue;window.latest=value;
const [open,setOpen]=useState(false);useEffect(()=>setOpen(true),[]);
return <main><h1 id="mailbox">Bandeja</h1><ComposeOverlay open={open} to="to@example.com" subject="Prueba" body={value.text} html={value.html} copilot={false} onClose={async draft=>{window.saved=draft;setOpen(false)}} onDiscard={async()=>setOpen(false)} onSend={async payload=>{window.sent=payload}} onPickAttachments={async()=>[{id:'report',name:'Resumen.pdf',size:2048}]} /></main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><PreferencesProvider><Harness/></PreferencesProvider></I18nProvider></React.StrictMode>);
`)
  await build({ configFile:false, root:folder, base:'./', plugins:[react()], resolve:{alias:{'@shared':join(project,'src/shared'),'react':join(project,'node_modules/react'),'react-dom':join(project,'node_modules/react-dom')}}, build:{outDir:join(folder,'dist'),emptyOutDir:true}, logLevel:'error' })
  await writeFile(join(folder, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');
app.setPath('userData',${JSON.stringify(join(folder,'profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1080,height:760,webPreferences:{offscreen:true}});
 win.webContents.on('console-message',event=>{if(event.message.includes('Error'))console.error(event.message)});
 await win.loadFile(${JSON.stringify(join(folder,'dist/index.html'))});
 win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1080,height:760,deviceScaleFactor:1,mobile:false});
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
 const replyReady=()=>editor.state.doc.firstChild.textContent===''&&editor.state.doc.childCount===1&&Boolean(document.querySelector('.composer__history-toggle'));
 restore({text:'Original fallback',html:reply});await tick();
 for(let i=0;i<100&&!replyReady();i++)await tick();
 assert(replyReady(),'Replies start with only an empty writing area');
 const content=document.querySelector('.rich-editor__content');
 assert(!content.querySelector('blockquote'),'History is outside the editable document');
 assert(getComputedStyle(content,'::before').content.includes('Escribe'),'Empty reply shows the writing placeholder');
 const history=document.querySelector('.composer__history-toggle');
 assert(history.getAttribute('aria-expanded')==='false'&&!document.querySelector('.composer__history iframe'),'History is hidden by default');
 history.click();await tick();
 for(let i=0;i<100&&!document.querySelector('.composer__history iframe')?.contentDocument?.body.textContent.includes('Vacantes');i++)await tick();
 const frame=document.querySelector('.composer__history iframe');
 assert(frame.contentDocument.body.textContent.includes('Vacantes disponibles'),'Expanded history contains the original');
 assert(frame.contentDocument.designMode!=='on'&&!frame.contentDocument.querySelector('[contenteditable="true"]'),'Original is read only in its isolated frame');
 editor.commands.focus('start');editor.commands.insertContent('Gracias por el aviso.');await tick();
 assert(content.firstElementChild.textContent==='Gracias por el aviso.','New text is written outside the quote');
 const replyDraft=helpers.cleanComposeHtml(editor.getHTML())+helpers.splitReplyHtml(reply).quote;
 restore({text:'Temporary',html:undefined});await tick();restore({text:'Reply fallback',html:replyDraft});await tick();
 for(let i=0;i<100&&document.querySelector('.composer__history-toggle')?.getAttribute('aria-expanded')!=='false';i++)await tick();
 assert(!content.querySelector('blockquote')&&document.querySelector('.composer__history-toggle').getAttribute('aria-expanded')==='false','Restored replies keep history locked and collapsed');
 assert(helpers.composeEmailHtml(replyDraft).includes('<blockquote'),'Sent HTML retains the quote structure');
 const styledReply=helpers.replyComposeHtml('Respuesta','Remitente','Original','Mensaje original','<html><head><style>.receipt{color:rgb(10,20,30)}</style></head><body><table class="receipt"><tr><td>Recibo completo</td></tr></table><script>alert(1)</script><img src="https://example.com/logo.png" onerror="alert(1)"></body></html>');
 window.replyFixture=styledReply;
 const styledEmail=helpers.composeEmailHtml(styledReply);
 assert(styledEmail.includes('<table')&&styledEmail.includes('.receipt')&&styledEmail.includes('https://example.com/logo.png')&&!styledEmail.includes('<script')&&!styledEmail.includes('onerror'),'Original styles and tables survive sending without active content');
 restore({text:'Temporary',html:saved});await tick();
 const imageData='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGNsaP7PQApgIkn1qIZRDUNKAwBWBwIi7kQ8QgAAAABJRU5ErkJggg==';
 const imageBytes=Uint8Array.from(atob(imageData),character=>character.charCodeAt(0));
 const imageClipboard=new DataTransfer();imageClipboard.items.add(new File([imageBytes],'Pegada.png',{type:'image/png'}));
 editor.commands.focus('end');await tick();
 editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:imageClipboard}));
 for(let i=0;i<100&&!editor.view.dom.querySelector('img[src]');i++)await tick();
 const pastedImage=editor.view.dom.querySelector('img[src]');
 assert(pastedImage?.getAttribute('src')==='data:image/png;base64,'+imageData,'Clipboard files appear as inline images');
 for(let i=0;i<100&&!pastedImage.complete;i++)await tick();assert(pastedImage.naturalWidth===16,'Pasted image decodes and displays');
 let imagePosition;
 editor.state.doc.descendants((node,position)=>{if(node.type.name==='image'&&imagePosition===undefined)imagePosition=position});
 editor.commands.setNodeSelection(imagePosition);await tick();
 const widthInput=document.querySelector('.rich-editor__image-tools input');
 assert(widthInput,'Selecting an image exposes keyboard-accessible sizing');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(widthInput,'120');widthInput.dispatchEvent(new Event('input',{bubbles:true}));widthInput.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 assert(editor.getAttributes('image').width===120,'Image width control updates the selected image');
 assert(Math.round(pastedImage.getBoundingClientRect().width)===120&&Math.round(pastedImage.getBoundingClientRect().height)===120,'Width changes preserve image proportions');
 const handle=editor.view.dom.querySelector('[data-resize-handle="bottom-right"]'),corner=handle.getBoundingClientRect();
 handle.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:corner.x,clientY:corner.y}));
 document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:corner.x+40,clientY:corner.y+40}));
 document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:corner.x+40,clientY:corner.y+40}));await tick();
 assert(editor.getAttributes('image').width===160,'Dragging the corner persists the resized width');
 const imageDraft=helpers.cleanComposeHtml(editor.getHTML());
 assert(imageDraft.includes('width="160"')&&helpers.composeEmailHtml(imageDraft).includes('width="160"')&&helpers.composeEmailHtml(imageDraft).includes('max-width:100%'),'Inline images survive safe draft/email serialization');
 restore({text:'Temporary',html:undefined});await tick();restore({text:'Image fallback',html:imageDraft});
 for(let i=0;i<100&&!editor.view.dom.querySelector('img[src]');i++)await tick();
 assert(editor.view.dom.querySelector('img[src]')?.src===pastedImage.src&&editor.getHTML().includes('width="160"'),'Reopening a draft preserves the pasted image and its width');
 const oversized=new DataTransfer();oversized.items.add(new File([new Uint8Array(10*1024*1024+1)],'Huge.png',{type:'image/png'}));
 editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:oversized}));await tick();
 assert(document.querySelector('[role="alert"]')?.textContent.includes('10 MB'),'Oversized clipboard images show an actionable error');
 assert(editor.view.dom.querySelectorAll('img[src]').length===1,'Rejected images leave the document unchanged');
 const htmlImageClipboard=new DataTransfer();htmlImageClipboard.setData('text/html','<img src="data:image/png;base64,'+imageData+'" alt="Copied image" onerror="evil()">');
 editor.commands.focus('end');await tick();
 editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:htmlImageClipboard}));
 await tick();
 for(let i=0;i<100&&editor.view.dom.querySelectorAll('img[src]').length!==2;i++)await tick();
 assert(editor.view.dom.querySelectorAll('img[src]').length===2&&!editor.view.dom.querySelector('[onerror]'),'Images copied as HTML also paste safely');
 assert(!document.querySelector('[role="alert"]'),'A valid paste clears the earlier error');
 assert(!helpers.cleanComposeHtml('<img src="data:image/png;base64,'+imageData+'" width="99999">').includes('width='),'Unsafe image dimensions are stripped');
 assert(!helpers.cleanComposeHtml('<img src="https://example.com/pixel"><img src="data:image/svg+xml;base64,PHN2Zz4=">').includes('<img'),'Remote and SVG clipboard images remain blocked');
 editor.commands.setTextSelection(editor.state.doc.content.size);await tick();
 return {text:editor.getText(),html:email,toolbarButtons:document.querySelectorAll('.formatbar button').length};
})()`)});
 const fullWidthCaret=await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
  const editor=document.querySelector('.tiptap').editor;
  const saved=editor.getJSON();const src=editor.view.dom.querySelector('img[src]').src;
  editor.commands.setContent('<p><img src="'+src+'" width="4096"></p>');
  editor.commands.setTextSelection(2);editor.view.focus();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const image=editor.view.dom.querySelector('img[src]').getBoundingClientRect();
  const viewport=document.querySelector('.composer__body').getBoundingClientRect();
  const caret=editor.view.coordsAtPos(editor.state.selection.from);
  const result={imageRight:image.right,caretRight:caret.right,viewportRight:viewport.right};
  editor.commands.setContent(saved);return result;
 })()`)});
 if(fullWidthCaret.caretRight-fullWidthCaret.imageRight<8||fullWidthCaret.caretRight>=fullWidthCaret.viewportRight)throw new Error('Right caret is obscured or clipped: '+JSON.stringify(fullWidthCaret));
 const originalContent=await win.webContents.executeJavaScript('document.querySelector(".tiptap").editor.getJSON()');
 for(const [key,text] of [['ArrowLeft','Antes de la imagen '],['ArrowRight',' Después de la imagen']]){
  const position=await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
   const editor=document.querySelector('.tiptap').editor;let position;
   editor.state.doc.descendants((node,pos)=>{if(node.type.name==='image'&&position===undefined)position=pos});
   editor.commands.setNodeSelection(position);editor.view.focus();await new Promise(requestAnimationFrame);return position;
  })()`)});
  const windowsVirtualKeyCode=key==='ArrowLeft'?37:39;
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode});
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode});
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const cursor=await win.webContents.executeJavaScript('(()=>{const selection=document.querySelector(".tiptap").editor.state.selection;return {position:selection.from,empty:selection.empty,parent:selection.$from.parent.type.name}})()');
  if(!cursor.empty||cursor.parent!=='paragraph'||cursor.position!==position+(key==='ArrowRight'?1:0))throw new Error('Cannot place text cursor beside image: '+key+' '+JSON.stringify(cursor));
  const clearance=await win.webContents.executeJavaScript('(()=>{const image=document.querySelector(".tiptap img[src]");const container=image.closest("[data-resize-container]");const style=getComputedStyle(container);return {left:parseFloat(style.marginLeft),right:parseFloat(style.marginRight)}})()');
  if(clearance.left<8||clearance.right<8)throw new Error('Image obscures adjacent caret: '+JSON.stringify(clearance));
  const visibleCaret=await win.webContents.executeJavaScript('(()=>{const caret=document.querySelector(".tiptap [data-image-caret]");const style=caret&&getComputedStyle(caret,"::after");return {side:caret?.dataset.imageCaret,height:parseFloat(style?.height),width:parseFloat(style?.width),content:style?.content,animation:style?.animationName,duration:style?.animationDuration,reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches}})()');
  if(visibleCaret.side!==(key==='ArrowLeft'?'before':'after')||visibleCaret.height<24||visibleCaret.width!==2||visibleCaret.content==='none')throw new Error('Missing visible image caret: '+JSON.stringify(visibleCaret));
  if(!visibleCaret.reducedMotion&&(visibleCaret.animation!=='image-caret-blink'||visibleCaret.duration!=='1s'))throw new Error('Image caret does not blink: '+JSON.stringify(visibleCaret));
  await win.webContents.debugger.sendCommand('Input.insertText',{text});
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 }
 const imageText=await win.webContents.executeJavaScript('(()=>{const editor=document.querySelector(".tiptap").editor;return {text:editor.view.dom.querySelector("img[src]").closest("p")?.textContent,html:editor.getHTML()}})()');
 if(!imageText.text?.includes('Antes de la imagen')||!imageText.text?.includes('Después de la imagen')||!imageText.html.includes('width="160"'))throw new Error('Typing beside an image lost text or sizing');
 await win.webContents.executeJavaScript('document.querySelector(".tiptap").editor.commands.setContent('+JSON.stringify(originalContent)+')');
 for(const [marker,type] of [['*','bulletList'],['-','bulletList'],['+','bulletList'],['1.','orderedList']]){
  await win.webContents.executeJavaScript('(async()=>{const editor=document.querySelector(".tiptap").editor;editor.commands.clearContent();await new Promise(requestAnimationFrame);editor.commands.focus();await new Promise(requestAnimationFrame)})()');
  for(const character of marker){
   await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:character,text:character});
   await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:character});
  }
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  const list=await win.webContents.executeJavaScript('(async()=>{const editor=document.querySelector(".tiptap").editor;for(let i=0;i<100&&!editor.isActive("listItem");i++)await new Promise(requestAnimationFrame);return {html:editor.getHTML(),focused:editor.isFocused,active:document.activeElement?.outerHTML.slice(0,100),type:editor.state.doc.firstChild.type.name,marker:getComputedStyle(editor.view.dom.querySelector("ul,ol")??editor.view.dom).listStyleType}})()');
  if(list.type!==type||list.marker!==(type==='bulletList'?'disc':'decimal'))throw new Error('Typed list marker did not create a visible list: '+marker+' '+JSON.stringify(list));
 }
 await win.webContents.executeJavaScript('document.querySelector(".tiptap").editor.commands.setContent('+JSON.stringify(originalContent)+')');
 await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 document.querySelector('[data-tooltip="Adjuntar archivos"]').click();
 for(let i=0;i<100&&!document.querySelector('.composer__attachment-notice');i++)await new Promise(requestAnimationFrame);
 const attachments=document.querySelector('.composer__attachments');
 if(!attachments?.textContent.includes('Se adjuntó correctamente: Resumen.pdf'))throw new Error('Attachment success notice missing');
 if(attachments.getBoundingClientRect().bottom>document.querySelector('.formatbar').getBoundingClientRect().top)throw new Error('Attachments must be above the editor toolbar');
 const before=attachments.getBoundingClientRect().top;
 document.querySelector('.composer__body').scrollTop=1000;
 if(attachments.getBoundingClientRect().top!==before)throw new Error('Attachments scrolled away with the message body');
})()`)});
 await win.webContents.executeJavaScript('(async()=>{const editor=document.querySelector(".tiptap").editor;let position;editor.state.doc.descendants((node,pos)=>{if(node.type.name==="image"&&position===undefined)position=pos});editor.commands.setNodeSelection(position);await new Promise(requestAnimationFrame)})()');
 await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
 await win.webContents.executeJavaScript('document.activeElement.blur();document.querySelector(".rich-editor__content img[src]").scrollIntoView({block:"center"})');
 win.setSize(1081,760);await new Promise(resolve=>setTimeout(resolve,100));win.setSize(1080,760);
 await new Promise(resolve=>setTimeout(resolve,200));
 await fs.writeFile('/tmp/namio-rich-editor-desktop.png',(await win.webContents.capturePage()).toPNG());
 win.setSize(560,760);await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:560,height:760,deviceScaleFactor:1,mobile:false});await new Promise(resolve=>setTimeout(resolve,100));
 await win.webContents.executeJavaScript('document.querySelector(".rich-editor__content img[src]").scrollIntoView({block:"center"})');
 const dimensions=await win.webContents.executeJavaScript('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
 if(dimensions.scroll>dimensions.width)throw new Error('Narrow editor overflows');
 await fs.writeFile('/tmp/namio-rich-editor-compact.png',(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript('(async()=>{restore({text:"Respuesta",html:window.replyFixture});for(let i=0;i<100&&!document.querySelector(".composer__history-toggle");i++)await new Promise(requestAnimationFrame);document.querySelector(".composer__body").scrollTop=0;await document.fonts.ready})()');
 await fs.writeFile('/tmp/namio-history-collapsed.png',(await win.webContents.capturePage()).toPNG());
 win.setSize(1080,760);await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1080,height:760,deviceScaleFactor:1,mobile:false});
 await win.webContents.executeJavaScript('(async()=>{document.querySelector(".composer__history-toggle").click();for(let i=0;i<100&&!document.querySelector(".composer__history iframe")?.contentDocument?.querySelector("table");i++)await new Promise(requestAnimationFrame);document.querySelector(".composer__history").scrollIntoView({block:"center"});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})()');
 await fs.writeFile('/tmp/namio-history-expanded.png',(await win.webContents.capturePage()).toPNG());
 const payloads=await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 document.querySelector('.send-btn').click();
 for(let i=0;i<100&&!window.sent;i++)await new Promise(requestAnimationFrame);
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 for(let i=0;i<100&&document.querySelector('.composer__head [data-tooltip="Cerrar"]').disabled;i++)await new Promise(requestAnimationFrame);
 document.querySelector('.composer__head [data-tooltip="Cerrar"]').click();
 for(let i=0;i<100&&!window.saved;i++)await new Promise(requestAnimationFrame);
 return {sent:window.sent,saved:window.saved};
 })()`)});
 if(!payloads.sent?.html.includes('Recibo completo')||!payloads.saved?.html.includes('data-namio-reply-quote')||!payloads.saved.body.includes('Respuesta')||!payloads.saved.body.includes('Recibo completo'))throw new Error('Sending or saving lost the reply history: '+JSON.stringify(payloads));
 console.log('Rich editor: real Chromium toolbar, undo/redo, lists, quotes, safe paste, legacy/rich drafts, email HTML and responsive layout passed');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless',join(folder,'runner.cjs')],{stdio:'inherit'})
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  if(code!==0)process.exitCode=1
} finally {await rm(folder,{recursive:true,force:true})}

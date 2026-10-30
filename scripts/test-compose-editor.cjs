const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript-test'), React=require('react')
const compile=text=>ts.transpile(text,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX})
const addresses={};vm.runInNewContext(compile(fs.readFileSync('src/shared/mailAddresses.ts','utf8')),{exports:addresses})
const exportsObject={}, state=[],refs=[];let index=0,refIndex=0,effects=[], keyHandler,failSend=false
const sent=[],closed=[],discarded=[],minimized=[]
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/components/ComposeOverlay.tsx','utf8')),{
 exports:exportsObject,Error,window:{addEventListener:(_name,fn)=>{keyHandler=fn},removeEventListener(){}},require:id=>{
 if(id==='react')return {...React,useState:initial=>{const slot=index++;if(!(slot in state))state[slot]=initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value}]},useRef:initial=>{const slot=refIndex++;return refs[slot]??(refs[slot]={current:initial})},useEffect:fn=>effects.push(fn),useMemo:fn=>fn()}
 if(id==='@shared/mailAddresses')return addresses
 if (id === '../settings/ShortcutsProvider') return { useFormatCombo: () => combo => combo }
  if(id==='../i18n')return{useI18n:()=>({t:key=>key})}
 if(id==='../lib/usePresence')return{usePresence:()=>({mounted:true,closing:false})}
 if(id==='../lib/cx')return{cx:(...v)=>v.filter(Boolean).join(' ')}
 if(id==='../data/demo')return{COPILOT_DRAFT:''}
 if(id==='../lib/composeHtml')return{composeEmailHtml:html=>html,splitReplyHtml:html=>({html,quote:''})}
 if(id==='./EmailBody')return{EmailBody:()=>null}
 if(id==='./RichTextEditor')return{RichTextEditor:()=>null}
 if(id==='./RecipientInput')return{RecipientInput:()=>null}
 if(id==='./Select')return{Select:()=>null}
 if(id==='./Icon')return{Icon:()=>null}
 if(id==='./Tooltip')return{TooltipButton:()=>null}
 return require(id)
}})
function render(options = {}){index=refIndex=0;effects=[];const tree=exportsObject.ComposeOverlay({open:true,sender:'sender@example.com',to:'',subject:'Subject',body:'Text',copilot:false,onClose:async value=>closed.push(value),onDiscard:async()=>discarded.push(true),onMinimize:async value=>minimized.push(value),onSend:async value=>{if(failSend)throw new Error('Send failed');sent.push(value)},...options});effects.at(-1)();return tree}
function find(tree,predicate){let result;function visit(node){if(!React.isValidElement(node))return;if(predicate(node))result=node;React.Children.forEach(node.props.children,visit)}visit(tree);return result}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
;(async()=>{
 let tree=render()
 assert.ok(React.Children.toArray(find(tree,n=>n.props.className==='composer__sender').props.children).includes('sender@example.com'),'composer displays the actual sending address')
 find(tree,n=>n.props['aria-label']==='mail.priority').props.onChange({target:{value:'high'}})
 tree=render()
 find(tree,n=>n.props.className==='send-btn').props.onClick();await flush()
 assert.equal(sent.length,0)
 assert.ok(find(render(),n=>n.props.role==='alert'))
 find(render(),n=>n.props.field==='to').props.onChange('first@example.com, second@example.com')
 tree=render();find(tree,n=>n.type==='button'&&n.props.children==='compose.cc').props.onClick()
 tree=render();find(tree,n=>n.type==='button'&&n.props.children==='compose.bcc').props.onClick()
 tree=render();find(tree,n=>n.props.field==='cc').props.onChange('copy@example.com')
 tree=render();find(tree,n=>n.props.field==='bcc').props.onChange('hidden@example.com')
 render();keyHandler({key:'Escape',stopPropagation(){},preventDefault(){}});await flush()
 assert.equal(closed[0].to,'first@example.com, second@example.com')
 assert.equal(closed[0].priority,'high')
 assert.equal(closed[0].cc,'copy@example.com');assert.equal(closed[0].bcc,'hidden@example.com')
 failSend=true;tree=render();find(tree,n=>n.props.className==='send-btn').props.onClick();await flush()
 assert.equal(closed.length,1)
 assert.equal(find(render(),n=>n.props.role==='alert').props.children,'Send failed')
 assert.equal(find(render(),n=>typeof n.props.onChange==='function' && n.props.text==='Text').props.text,'Text')
 failSend=false;tree=render();const sendButton=find(tree,n=>n.props.className==='send-btn');sendButton.props.onClick();sendButton.props.onClick();await flush()
 assert.equal(sent.length,1,'repeated clicks do not duplicate mail')
 assert.equal(sent[0].priority,'high')
 assert.equal(sent[0].bcc,'hidden@example.com')
 tree=render();find(tree,n=>n.props.className==='tool-btn btn--danger').props.onClick();await flush()
 assert.equal(discarded.length,1);assert.equal(closed.length,1,'discard does not save the draft')

 tree=render()
 find(tree,n=>n.props.text==='Text'&&typeof n.props.onChange==='function').props.onChange('Latest edit','<p><strong>Latest edit</strong></p>')
 find(tree,n=>n.props.title==='common.close').props.onClick();await flush()
 assert.equal(closed.at(-1).body,'Latest edit','closing in the same turn must save the latest rich editor transaction')
 assert.ok(closed.at(-1).html.includes('<strong>'))
 tree=render();find(tree,n=>n.props.title==='compose.minimize').props.onClick();await flush()
 assert.equal(minimized.at(-1).priority,'high')
 assert.equal(minimized.at(-1).body,'Latest edit');assert.ok(minimized.at(-1).html.includes('<strong>'))
 tree=render();find(tree,n=>n.props.className==='send-caret').props.onClick()
 tree=render();find(tree,n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('compose.sendPlain')).props.onClick();await flush()
 assert.equal(sent.at(-1).html,undefined);assert.equal(sent.at(-1).body,'Latest edit')
 assert.ok(closed.at(-1).html.includes('<strong>'),'plain sending must not mutate draft formatting')
 tree=render()
 find(tree,n=>n.type==='button'&&n.props.children==='compose.cc').props.onClick()
 find(tree,n=>n.type==='button'&&n.props.children==='compose.bcc').props.onClick()
 tree=render()
 assert.ok(find(tree,n=>n.props.field==='cc'),'A populated CC field remains visible')
 assert.ok(find(tree,n=>n.props.field==='bcc'),'A populated BCC field remains visible to the sender')
 const files=[{id:'report',name:'Report.pdf',size:2048},{id:'notes',name:'Notes.txt',size:1024}]
 const pick=()=>find(render({onPickAttachments:async()=>files}),n=>typeof n.props.onAttach==='function').props.onAttach()
 pick();await flush();tree=render()
 assert.ok(find(tree,n=>n.props.className==='composer__attachments'),'attachments appear above the editor')
 assert.ok(find(tree,n=>n.props.role==='status').props.children.includes('compose.attachmentsAdded'))
 const rich=find(tree,n=>n.props.text==='Latest edit'&&typeof n.props.onChange==='function')
 assert.ok(!find(rich,n=>n.props.className==='attach-row'),'attachments no longer sit below the writing area')
 find(tree,n=>n.props.title==='common.close').props.onClick();await flush()
 assert.equal(closed.at(-1).attachments.length,2,'attachments still persist in the draft')
 find(tree,n=>n.props.title==='compose.removeAttachment').props.onClick();tree=render()
 assert.ok(!find(tree,n=>n.props.role==='status'),'removing an attachment clears the old success notice')
 find(render({onPickAttachments:async()=>[]}),n=>typeof n.props.onAttach==='function').props.onAttach();await flush()
 assert.ok(!find(render(),n=>n.props.role==='status'),'canceling the picker does not announce success')
 find(render({onPickAttachments:async()=>{throw new Error('Pick failed')}}),n=>typeof n.props.onAttach==='function').props.onAttach();await flush()
 assert.equal(find(render(),n=>n.props.role==='alert').props.children,'Pick failed')
 console.log('Compose editor: pending addresses, validation, CC/BCC, Escape draft, failed sends, duplicate clicks and discard passed')
})().catch(error=>{console.error(error);process.exitCode=1})

const htmlHelpers = {}
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/lib/composeHtml.ts','utf8')), { exports:htmlHelpers, URL, require:()=>({default:{sanitize:html=>html}}) })
for (const url of ['javascript:alert(1)','file:///tmp/file','data:text/html,test','https:///','https://','relative/path']) assert.equal(htmlHelpers.isComposeLink(url),false)
for (const url of ['https://example.com/path','http://localhost/test','mailto:person@example.com']) assert.equal(htmlHelpers.isComposeLink(url),true)
console.log('Rich editor links: URL parsing and safe protocol validation passed')

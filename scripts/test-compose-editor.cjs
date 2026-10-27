const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript'), React=require('react')
const compile=text=>ts.transpile(text,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX})
const addresses={};vm.runInNewContext(compile(fs.readFileSync('src/shared/mailAddresses.ts','utf8')),{exports:addresses})
const exportsObject={}, state=[],refs=[];let index=0,refIndex=0,effects=[], keyHandler,failSend=false
const sent=[],closed=[],discarded=[]
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/components/ComposeOverlay.tsx','utf8')),{
 exports:exportsObject,Error,window:{addEventListener:(_name,fn)=>{keyHandler=fn},removeEventListener(){}},require:id=>{
 if(id==='react')return {...React,useState:initial=>{const slot=index++;if(!(slot in state))state[slot]=initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value}]},useRef:initial=>{const slot=refIndex++;return refs[slot]??(refs[slot]={current:initial})},useEffect:fn=>effects.push(fn)}
 if(id==='@shared/mailAddresses')return addresses
 if(id==='../i18n')return{useI18n:()=>({t:key=>key})}
 if(id==='../lib/usePresence')return{usePresence:()=>({mounted:true,closing:false})}
 if(id==='../lib/cx')return{cx:(...v)=>v.filter(Boolean).join(' ')}
 if(id==='../data/demo')return{COPILOT_DRAFT:''}
 if(id==='../lib/composeHtml')return{composeEmailHtml:html=>html}
 if(id==='./RichTextEditor')return{RichTextEditor:()=>null}
 if(id==='./RecipientInput')return{RecipientInput:()=>null}
 if(id==='./Icon')return{Icon:()=>null}
 if(id==='./Tooltip')return{TooltipButton:()=>null}
 return require(id)
}})
function render(){index=refIndex=0;effects=[];const tree=exportsObject.ComposeOverlay({open:true,to:'',subject:'Subject',body:'Text',copilot:false,onClose:async value=>closed.push(value),onDiscard:async()=>discarded.push(true),onSend:async value=>{if(failSend)throw new Error('Send failed');sent.push(value)}});effects.at(-1)();return tree}
function find(tree,predicate){let result;function visit(node){if(!React.isValidElement(node))return;if(predicate(node))result=node;React.Children.forEach(node.props.children,visit)}visit(tree);return result}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
;(async()=>{
 let tree=render()
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
 assert.equal(closed[0].cc,'copy@example.com');assert.equal(closed[0].bcc,'hidden@example.com')
 failSend=true;tree=render();find(tree,n=>n.props.className==='send-btn').props.onClick();await flush()
 assert.equal(closed.length,1)
 assert.equal(find(render(),n=>n.props.role==='alert').props.children,'Send failed')
 assert.equal(find(render(),n=>typeof n.props.onChange==='function' && n.props.text==='Text').props.text,'Text')
 failSend=false;tree=render();const sendButton=find(tree,n=>n.props.className==='send-btn');sendButton.props.onClick();sendButton.props.onClick();await flush()
 assert.equal(sent.length,1,'repeated clicks do not duplicate mail')
 assert.equal(sent[0].bcc,'hidden@example.com')
 tree=render();find(tree,n=>n.props.className==='tool-btn btn--danger').props.onClick();await flush()
 assert.equal(discarded.length,1);assert.equal(closed.length,1,'discard does not save the draft')

 tree=render()
 find(tree,n=>n.props.text==='Text'&&typeof n.props.onChange==='function').props.onChange('Latest edit','<p><strong>Latest edit</strong></p>')
 find(tree,n=>n.props.title==='common.close').props.onClick();await flush()
 assert.equal(closed.at(-1).body,'Latest edit','closing in the same turn must save the latest rich editor transaction')
 assert.ok(closed.at(-1).html.includes('<strong>'))
 console.log('Compose editor: pending addresses, validation, CC/BCC, Escape draft, failed sends, duplicate clicks and discard passed')
})().catch(error=>{console.error(error);process.exitCode=1})

const htmlHelpers = {}
vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/lib/composeHtml.ts','utf8')), { exports:htmlHelpers, URL, require:()=>({default:{sanitize:html=>html}}) })
for (const url of ['javascript:alert(1)','file:///tmp/file','data:text/html,test','https:///','https://','relative/path']) assert.equal(htmlHelpers.isComposeLink(url),false)
for (const url of ['https://example.com/path','http://localhost/test','mailto:person@example.com']) assert.equal(htmlHelpers.isComposeLink(url),true)
console.log('Rich editor links: URL parsing and safe protocol validation passed')

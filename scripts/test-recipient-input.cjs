const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const compile=text=>ts.transpile(text,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX})
const addresses={};vm.runInNewContext(compile(fs.readFileSync('src/shared/mailAddresses.ts','utf8')),{exports:addresses})
async function check(field){
 const state=[],changes=[],out={};let index=0,effect
 vm.runInNewContext(compile(fs.readFileSync('src/renderer/src/components/RecipientInput.tsx','utf8')),{
  exports:out,window:{setTimeout:fn=>{fn();return 1},clearTimeout(){},api:{suggestRecipients:async()=>[{email:'jorge@example.com',name:'Jorge Ocejo'}]}},require:id=>{
   if(id==='react')return {...React,useState:initial=>{const slot=index++;if(!(slot in state))state[slot]=initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value}]},useEffect:fn=>{effect=fn}}
   if(id==='@shared/mailAddresses')return addresses
   if(id==='../i18n')return{useI18n:()=>({t:key=>key})}
   if(id==='./Icon')return{Icon:()=>null}
   return require(id)
  }
 })
 const render=()=>{index=0;return out.RecipientInput({field,initialValue:'',onChange:value=>changes.push(value),suggest:true})}
 function find(tree,predicate){let result;function visit(node){if(!React.isValidElement(node))return;if(predicate(node))result=node;React.Children.forEach(node.props.children,visit)}visit(tree);return result}
 const input=()=>find(render(),n=>n.type==='input')
 const key=name=>({key:name,nativeEvent:{isComposing:false},preventDefault(){},stopPropagation(){}})
 input().props.onChange({target:{value:'person@example.com'}})
 input().props.onKeyDown(key('Enter'))
 assert.equal(changes.at(-1),'person@example.com')
 assert.ok(find(render(),n=>n.props.className==='recipient recipient--contact'))
 assert.equal(input().props.value,'')
 input().props.onChange({target:{value:'PERSON@example.com'}});input().props.onKeyDown(key('Enter'))
 assert.equal(changes.at(-1),'person@example.com','duplicate addresses do not create another chip')
 input().props.onChange({target:{value:'invalid'}});input().props.onKeyDown(key('Enter'))
 assert.equal(input().props['aria-invalid'],true)
 assert.equal(input().props.value,'invalid')
 input().props.onChange({target:{value:'jorge'}});input().props.onFocus();render();effect();await Promise.resolve();await Promise.resolve()
 assert.equal(input().props['aria-expanded'],true)
 input().props.onKeyDown(key('ArrowDown'))
 assert.ok(input().props['aria-activedescendant'])
 input().props.onKeyDown(key('Enter'))
 assert.equal(changes.at(-1),'person@example.com, jorge@example.com')
 assert.ok(find(render(),n=>n.type==='strong'&&n.props.children==='Jorge Ocejo'))
 input().props.onChange({target:{value:'jorge'}});render();effect();await Promise.resolve();await Promise.resolve()
 input().props.onKeyDown(key('Escape'))
 assert.equal(input().props['aria-expanded'],false)
 find(render(),n=>n.type==='button'&&n.props['aria-label']?.endsWith('jorge@example.com')).props.onClick()
 assert.equal(changes.at(-1),'person@example.com, jorge')
}
;(async()=>{for(const field of ['to','cc','bcc'])await check(field);console.log('Recipient fields: Enter chips, duplicate suppression, invalid input, arrow selection, names, Escape and removal passed in To/CC/BCC')})().catch(error=>{console.error(error);process.exitCode=1})

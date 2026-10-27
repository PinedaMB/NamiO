const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/components/AccountDialog.tsx', 'utf8')
const ast = ts.createSourceFile('AccountDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
let selectProvider
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(ast), node.initializer.getText(ast))
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onClick' && node.initializer?.expression?.getText(ast).includes("id === 'google' ? 'gmail' : 'outlook'")) selectProvider = node.initializer.expression.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
const state = {}
const context = { PRESETS: vm.runInNewContext(declarations.get('PRESETS')) }
for (const name of ['Host', 'Port', 'Secure', 'SmtpHost', 'SmtpPort', 'SmtpSecure', 'Auth', 'Provider', 'Password', 'Error']) {
  context[`set${name}`] = value => { state[name] = value }
}
function evaluate(code) { return vm.runInNewContext(ts.transpile(`(${code})`, { target: ts.ScriptTarget.ES2022 }), context) }
const applyPreset = evaluate(declarations.get('applyPreset'))
context.applyPreset = applyPreset
for (const [provider, host] of [['google', 'imap.gmail.com'], ['microsoft', 'outlook.office365.com']]) {
  context.id = provider
  evaluate(selectProvider)()
  assert.equal(state.Host, host)
  assert.equal(state.Auth, 'oauth2')
  assert.equal(state.Provider, provider)
}
applyPreset(context.PRESETS.find(preset => preset.id === 'custom'))
assert.equal(state.Host, '')
assert.equal(state.SmtpHost, '')
assert.equal(state.Provider, 'custom')
assert.equal(state.Auth, 'password')
assert.equal(state.Password, '')
applyPreset(context.PRESETS.find(preset => preset.id === 'yahoo'))
assert.equal(state.Host, 'imap.mail.yahoo.com')
assert.equal(state.SmtpHost, 'smtp.mail.yahoo.com')
assert.equal(state.Auth, 'password')
for (const [host, expected] of [['imap.gmail.com', false], ['outlook.office365.com', true], ['imap.mail.yahoo.com', false]]) {
  context.host = host
  assert.equal(evaluate(declarations.get('needsOAuth')), expected)
}
const onboardingSource = fs.readFileSync('src/renderer/src/components/Onboarding.tsx', 'utf8')
const onboarding = ts.createSourceFile('Onboarding.tsx', onboardingSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let presetExpression
function findPreset(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(onboarding) === 'preset') presetExpression = node.initializer.getText(onboarding)
  ts.forEachChild(node, findPreset)
}
findPreset(onboarding)
for (const choice of ['gmail', 'outlook']) for (const gmailPassword of [true, false]) {
  const preset = vm.runInNewContext(presetExpression, { choice, gmailPassword, PRESETS: { gmail: { oauth: true }, outlook: { oauth: true } } })
  assert.equal(preset.oauth, choice === 'outlook' || !gmailPassword)
}
console.log('Provider checks passed: presets, custom reset, Yahoo and Gmail authentication options')

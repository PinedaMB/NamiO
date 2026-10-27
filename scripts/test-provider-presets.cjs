const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/components/AccountDialog.tsx', 'utf8')
const ast = ts.createSourceFile('AccountDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
let selectProvider
let serverFromEmail
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'serverFromEmail') serverFromEmail = node.getText(ast)
  if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(ast), node.initializer.getText(ast))
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onClick' && node.initializer?.expression?.getText(ast).includes("id === 'google' ? 'gmail' : 'outlook'")) selectProvider = node.initializer.expression.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
const state = {}
const context = { PRESETS: vm.runInNewContext(declarations.get('PRESETS')) }
for (const name of ['PresetId', 'Host', 'Port', 'Secure', 'SmtpHost', 'SmtpPort', 'SmtpSecure', 'Auth', 'Provider', 'Password', 'Error']) {
  context[`set${name}`] = value => { state[name] = value }
}
function evaluate(code) { return vm.runInNewContext(ts.transpile(`(${code})`, { target: ts.ScriptTarget.ES2022 }), context) }
const applyPreset = evaluate(declarations.get('applyPreset'))
context.applyPreset = applyPreset
for (const [provider, host] of [['google', 'imap.gmail.com'], ['microsoft', 'outlook.office365.com']]) {
  context.id = provider
  evaluate(selectProvider)()
  assert.equal(state.PresetId, provider === 'google' ? 'gmail' : 'outlook')
  assert.equal(state.Host, host)
  assert.equal(state.Auth, 'oauth2')
  assert.equal(state.Provider, provider)
}
applyPreset(context.PRESETS.find(preset => preset.id === 'custom'))
assert.equal(state.PresetId, 'custom')
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

assert.match(source, /presetId === 'custom' && <div className="account-field">/)
assert.match(source, /<legend className="account-section__title">\{t\('account.imap'\)\}/)

context.serverFromEmail = evaluate(serverFromEmail)
for (const [email, expected] of [
  ['person@example.com', 'email.example.com'],
  [' Person@SUB.Example.COM ', 'email.sub.example.com'],
  ['person', ''], ['person@', ''], ['person@example', ''],
  ['person@@example.com', ''], ['person@example.com/path', ''], ['a b@example.com', '']
]) assert.equal(context.serverFromEmail(email), expected)
context.setUser = value => { state.User = value }
const updateUser = evaluate(declarations.get('updateUser'))
Object.assign(context, { presetId: 'custom', user: '', host: '', smtpHost: '' })
updateUser('person@example.com')
assert.equal(state.Host, 'email.example.com')
assert.equal(state.SmtpHost, 'email.example.com')
Object.assign(context, { user: 'person@example.com', host: 'email.example.com', smtpHost: 'smtp.manual.com' })
state.SmtpHost = context.smtpHost
updateUser('person@another.com')
assert.equal(state.Host, 'email.another.com')
assert.equal(state.SmtpHost, 'smtp.manual.com')
Object.assign(context, { presetId: 'gmail', host: 'imap.gmail.com', smtpHost: 'smtp.gmail.com' })
state.Host = context.host
state.SmtpHost = context.smtpHost
updateUser('person@gmail.com')
assert.equal(state.Host, 'imap.gmail.com')
assert.equal(state.SmtpHost, 'smtp.gmail.com')
assert.match(source, /<details className="account-advanced" key=\{String\(open\)\}>/)
console.log('Server suggestions: domain prefix, edits, invalid emails, manual servers and provider presets passed')

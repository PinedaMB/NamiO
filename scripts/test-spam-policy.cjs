const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
for (const path of ['electron.vite.config.ts', 'src/main/index.ts']) {
  assert.match(fs.readFileSync(path, 'utf8'), /"img-src 'self' data: blob: https: http:"/)
}
function compile(file) { return ts.transpile(fs.readFileSync(file, 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }) }
const dates = {}
vm.runInNewContext(compile('src/renderer/src/lib/dates.ts'), { exports: dates })
const live = {}
const mailboxes = {}
vm.runInNewContext(compile('src/shared/mailboxes.ts'), { exports: mailboxes })
vm.runInNewContext(compile('src/renderer/src/data/live.ts'), { exports: live, require: id => id === '../lib/dates' ? dates : mailboxes })
for (const mailbox of [
  { path: 'provider-special-folder', specialUse: '\\Junk' },
  { path: '[Gmail]/Spam' }, { path: 'Junk Email' },
  { path: 'Correo no deseado' }, { path: 'Spam/subfolder' }
]) assert.equal(live.isSpamMailbox(mailbox), true)
assert.equal(live.isSpamMailbox({ path: 'INBOX' }), false)
assert.equal(live.isSpamMailbox({ path: 'Spam reports' }), false)
assert.equal(live.mailboxToFolder({ path: 'Spam', name: 'Spam', unseen: 2 }).icon, 'report')
for (const blocked of [true, false]) for (const setting of ['allow', 'block']) for (const override of [null, true]) {
  let index = 0
  const exports = {}
  vm.runInNewContext(compile('src/renderer/src/components/EmailBody.tsx'), {
    exports,
    DOMParser: class { parseFromString(html) { return { querySelectorAll: () => [], body: { innerHTML: html } } } },
    require: id => {
      if (id === 'react') return { ...React, useState: initial => [index++ === 0 ? override : initial, () => {}], useRef: () => ({ current: null }), useEffect: () => {}, useLayoutEffect: () => {}, useMemo: fn => fn() }
      if (id === 'dompurify') return { default: { sanitize: html => html } }
      if (id === '../i18n') return { useI18n: () => ({ t: key => key }) }
      if (id === '../settings/PreferencesProvider') return { usePreferences: () => ({ remoteImages: setting, bodyTheme: 'light' }) }
      if (id === '../lib/emailTheme') return { applyEmailTheme() {} }
      if (id === './Icon') return { Icon: () => null }
      return require(id)
    }
  })
  const tree = exports.EmailBody({ html: '<img src="https://example.com/pixel.png">', blockRemote: blocked })
  const frame = React.Children.toArray(tree.props.children).find(child => child.type === 'iframe')
  const csp = frame.props.srcDoc.match(/Content-Security-Policy" content="([^"]+)"/)[1]
  const allowed = !blocked && (override ?? setting === 'allow')
  assert.equal(csp.includes('img-src data: https: http:'), allowed)
  assert.ok(csp.includes("default-src 'none'"))
  assert.ok(csp.includes('font-src data:'))
  assert.ok(csp.includes('media-src data:'))
  if (blocked) {
    const html = renderToStaticMarkup(tree)
    assert.ok(html.includes('mail.spamRemoteBlocked'))
    assert.ok(!html.includes('mail.showImages'))
    assert.ok(!csp.includes('https:'))
    assert.ok(!csp.includes('http:'))
  }
}
console.log('Spam policy: special folders, localized names, nested folders and forced CSP across preferences/overrides passed')

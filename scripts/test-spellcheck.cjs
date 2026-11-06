const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')

async function check(platform, available, expected, saved = 'es') {
  let handler, menu, language = 'es', destroyed = false, replaced, added, configured
  const window = { webContents: {
    session: {
      availableSpellCheckerLanguages: available,
      setSpellCheckerLanguages: value => { configured = Array.from(value) },
      addWordToSpellCheckerDictionary: word => { added = word }
    },
    on: (event, callback) => { assert.equal(event, 'context-menu'); handler = callback },
    isDestroyed: () => destroyed,
    replaceMisspelling: word => { replaced = word }
  } }
  const exports = {}
  vm.runInNewContext(ts.transpile(fs.readFileSync('src/main/spellcheck.ts', 'utf8'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }), {
    exports, process: { platform }, require: id => {
      if (id === './settings') return { readSettings: async () => ({ language, spellcheckLanguage: saved }) }
      if (id === 'electron') return {
        app: { getLocale: () => 'es-MX' },
        Menu: { buildFromTemplate: items => ({ popup: options => { assert.equal(options.window, window); menu = items } }) }
      }
      throw new Error(id)
    }
  })
  await exports.setupSpellcheck(window)
  assert.deepEqual(configured, expected)
  const params = { isEditable: true, misspelledWord: 'holaa', dictionarySuggestions: ['hola'], editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: false, canSelectAll: true } }
  await handler({}, params)
  assert.equal(menu[0].label, 'hola')
  menu[0].click()
  assert.equal(replaced, 'hola')
  menu.find(item => item.label === 'Añadir al diccionario').click()
  assert.equal(added, 'holaa')
  assert.equal(menu.find(item => item.role === 'paste').enabled, false)
  assert.equal(menu.find(item => item.role === 'undo').enabled, true)
  language = 'en'
  await handler({}, { ...params, dictionarySuggestions: [] })
  assert.equal(menu[0].label, 'No suggestions')
  assert.equal(menu[0].enabled, false)
  assert.ok(menu.some(item => item.label === 'Add to dictionary'))
  await handler({}, { ...params, misspelledWord: '' })
  assert.equal(menu[0].role, 'undo', 'correct words retain the editing menu')
  menu = undefined
  await handler({}, { ...params, isEditable: false })
  assert.equal(menu, undefined, 'received mail and app menus are unaffected')
  destroyed = true
  await handler({}, params)
  assert.equal(menu, undefined, 'do not open a menu after the window closes')
}
async function checkSettingsHandler() {
  const source = fs.readFileSync('src/main/ipc.ts', 'utf8')
  const ast = ts.createSourceFile('ipc.ts', source, ts.ScriptTarget.Latest, true)
  let callback
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' && node.arguments[0]?.getText(ast) === 'IPC.settingsSet') callback = node.arguments[1].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  let saved, selected, fail = false
  const session = {}
  const handler = vm.runInNewContext(ts.transpile(`(${callback})`, { target: ts.ScriptTarget.ES2022 }), {
    sanitizeSettingsPatch: patch => patch,
    writeSettings: async patch => { if (fail) throw new Error('Disk full'); saved = patch.spellcheckLanguage },
    setSpellcheckLanguage: (target, language) => { assert.equal(target, session); selected = language }
  })
  await handler({ sender: { session } }, { spellcheckLanguage: 'en' })
  assert.equal(saved, 'en')
  assert.equal(selected, 'en', 'saving a dictionary changes the active Electron session')
  fail = true
  await assert.rejects(handler({ sender: { session } }, { spellcheckLanguage: 'es' }), /Disk full/)
  assert.equal(selected, 'en', 'a failed save leaves the active dictionary unchanged')
}
;(async () => {
  await checkSettingsHandler()
  await check('linux', ['es-MX', 'es', 'en-US'], ['es-MX'])
  await check('win32', ['es', 'en-US'], ['es'])
  await check('linux', ['es-ES'], ['es-ES'])
  await check('linux', ['es-MX', 'en-US'], ['en-US'], 'en')
  await check('darwin', ['en-US'], undefined)
  assert.match(fs.readFileSync('src/main/index.ts', 'utf8'), /setupSpellcheck\(mainWindow\)/)
  console.log('Spellcheck: supported languages, suggestions, personal dictionary, edit actions, localization and window lifecycle passed')
})().catch(error => { console.error(error); process.exitCode = 1 })

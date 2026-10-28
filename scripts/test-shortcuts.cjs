const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
const shortcuts = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/renderer/src/settings/shortcuts.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}), { exports: shortcuts })

const normalized = shortcuts.normalizeBindings({ snooze: 'h', archive: ' X ', compose: 'mod+n' })
assert.equal(normalized.snooze, undefined, 'stored bindings for the unavailable action are ignored')
assert.equal(normalized.archive, 'x', 'existing custom shortcuts are preserved')
assert.equal(normalized.compose, 'mod+n')
assert.equal(shortcuts.actionForCombo({ ...shortcuts.DEFAULT_BINDINGS, ...normalized }, 'h'), undefined)
assert.equal(shortcuts.actionForCombo({ ...shortcuts.DEFAULT_BINDINGS, ...normalized }, 'x'), 'archive')
assert.equal(shortcuts.SHORTCUTS.some(shortcut => shortcut.id === 'snooze'), false)
console.log('Shortcuts: unavailable actions are ignored without changing other custom bindings')

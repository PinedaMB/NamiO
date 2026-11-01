const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')

/** El rail ordena especiales y muestra las subcarpetas debajo de su padre. */
const shared = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/shared/mailboxes.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}), { exports: shared })

const box = (path, name, specialUse = null) => ({ path, name, specialUse, messages: 0, unseen: 0 })
const mailboxes = [
  box('Archivo', 'Archivo', '\\Archive'),
  box('Deleted', 'Deleted', '\\Trash'),
  box('Drafts', 'Drafts', '\\Drafts'),
  box('INBOX', 'INBOX', '\\Inbox'),
  box('Junk', 'Junk', '\\Junk'),
  box('Mailspring', 'Mailspring'),
  box('Mailspring/Snoozed', 'Snoozed'),
  box('Notes', 'Notes'),
  box('Outbox', 'Outbox'),
  box('Problemas de sincronización', 'Problemas de sincronización'),
  box('Problemas de sincronización/Conflictos', 'Conflictos'),
  box('Problemas de sincronización/Errores del servidor', 'Errores del servidor'),
  box('Problemas de sincronización/Errores locales', 'Errores locales'),
  box('Sent', 'Sent', '\\Sent')
]

const organized = shared.organizedSidebarMailboxes(mailboxes)
assert.deepEqual(Array.from(organized, ({ mailbox }) => mailbox.path), [
  'INBOX', 'Drafts', 'Sent', 'Archivo', 'Junk', 'Deleted', 'Outbox',
  'Mailspring', 'Mailspring/Snoozed', 'Notes',
  'Problemas de sincronización', 'Problemas de sincronización/Conflictos',
  'Problemas de sincronización/Errores del servidor', 'Problemas de sincronización/Errores locales'
])
assert.deepEqual(Array.from(organized, ({ depth }) => depth), [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1])
assert.equal(organized.find(({ mailbox }) => mailbox.path === 'Mailspring').hasChildren, true)
assert.equal(organized.find(({ mailbox }) => mailbox.path === 'Mailspring/Snoozed').parentId, 'Mailspring')
assert.equal(organized.find(({ mailbox }) => mailbox.path === 'Problemas de sincronización').hasChildren, true)
assert.equal(organized.find(({ mailbox }) => mailbox.path === 'Problemas de sincronización/Conflictos').parentId, 'Problemas de sincronización')

const sidebar = fs.readFileSync('src/renderer/src/components/Sidebar.tsx', 'utf8')
assert.match(sidebar, /hiddenByGroup/, 'collapsed groups hide their descendants')
assert.match(sidebar, /nav-group__toggle/, 'parents expose a disclosure toggle')
assert.match(sidebar, /aria-expanded=\{!groupCollapsed\}/, 'the toggle exposes its state')
assert.match(sidebar, /className="nav-item rail__settings"/, 'settings uses the same navigation row')
assert.doesNotMatch(sidebar, /sync-pill[\s\S]{0,500}onOpenSettings/, 'settings is not inside the sync pill')
assert.match(sidebar, /data-depth=\{folder\.depth/, 'nested folders expose their depth')
assert.match(fs.readFileSync('src/renderer/src/styles/app.css', 'utf8'), /\.rail__settings \{\s*width:\s*100%/, 'settings row fills the rail')

console.log('Sidebar: special folders first, nested folders indented, settings styled as a navigation row')

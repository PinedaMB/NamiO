const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript-test')
for (const file of ['messageParts', 'attachmentCache']) {
  const exportsObject = {}
  vm.runInNewContext(ts.transpile(fs.readFileSync(`src/main/${file}.ts`, 'utf8'), {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}), {exports: exportsObject})
  Object.assign(module.exports, exportsObject)
}

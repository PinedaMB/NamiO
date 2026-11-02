const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript-test')
vm.runInNewContext(ts.transpile(fs.readFileSync(path.join(__dirname, '../src/shared/ipc.ts'), 'utf8'), {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}), {exports: module.exports})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript-test')
const { spawnSync } = require('node:child_process')
const source = fs.readFileSync('scripts/generate-licenses.mjs', 'utf8')
const ast = ts.createSourceFile('generate-licenses.mjs', source, ts.ScriptTarget.Latest, true)
let renderer
for (const statement of ast.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(ast) === 'renderer') renderer = vm.runInNewContext(declaration.initializer.getText(ast))
  }
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'namio-license-'))
try {
  fs.mkdirSync(path.join(directory, 'scripts'))
  fs.writeFileSync(path.join(directory, 'scripts/generate-licenses.mjs'), source)
  const writePackage = (name, extra = {}, licensed = true) => {
    const target = path.join(directory, 'node_modules', name)
    fs.mkdirSync(target, {recursive: true})
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({name, version: '1.0.0', license: 'MIT', ...extra}))
    // Fixture notices, deliberately not real third-party license texts.
    if (licensed) fs.writeFileSync(path.join(target, 'LICENSE'), 'Fixture: SIL OPEN FONT LICENSE\nFixture: Apache License\n')
  }
  for (const name of ['nodemailer', ...renderer]) writePackage(name)
  writePackage('pdfjs-dist', {license: 'Apache-2.0', optionalDependencies: {'@napi-rs/canvas': '1.0.0'}})
  writePackage('@napi-rs/canvas', {optionalDependencies: {'@napi-rs/canvas-linux-x64-gnu': '1.0.0'}})
  writePackage('@napi-rs/canvas-linux-x64-gnu', {}, false)
  const project = {dependencies: {nodemailer: '1.0.0'}}
  const writeProject = () => fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(project))
  const generate = () => spawnSync(process.execPath, ['scripts/generate-licenses.mjs'], {cwd: directory, encoding: 'utf8'})
  writeProject()
  let result = generate()
  assert.equal(result.status, 0, result.stderr)
  const notices = fs.readFileSync(path.join(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  assert.ok(notices.includes('pdfjs-dist'))
  assert.ok(notices.includes('nodemailer'))
  assert.ok(!notices.includes('@napi-rs/canvas'), 'the browser renderer does not distribute the Node.js canvas packages')

  writePackage('missing-license', {}, false)
  writePackage('nodemailer', {dependencies: {'missing-license': '1.0.0'}})
  result = generate()
  assert.notEqual(result.status, 0)
  assert.ok(result.stderr.includes('Falta texto de licencia: missing-license'), 'real missing runtime notices must still block generation')

  writePackage('nodemailer')
  project.dependencies['pdfjs-dist'] = '1.0.0'
  writeProject()
  result = generate()
  assert.notEqual(result.status, 0)
  assert.ok(result.stderr.includes('Falta texto de licencia: @napi-rs/canvas-linux-x64-gnu'), 'the exception must not apply if PDF.js is shipped as a Node.js runtime dependency')
  console.log('License generation: renderer-only PDF.js excludes native canvas, distributed notices remain required, runtime canvas is not exempt')
} finally {
  fs.rmSync(directory, {recursive: true, force: true})
}

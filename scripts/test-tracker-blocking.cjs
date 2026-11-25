const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

const trackers = {}
vm.runInNewContext(compile('src/renderer/src/lib/trackers.ts'), { exports: trackers, URL })

const auth = {}
vm.runInNewContext(compile('src/shared/icsParser.ts'), { exports: auth, require })

// 1x1 pixel tracking
assert.equal(trackers.isTrackingPixel('https://example.com/logo.png', { width: '1', height: '1' }), true)
assert.equal(trackers.isTrackingPixel('https://example.com/pixel.gif', { style: 'width: 1px; height: 1px;' }), true)
assert.equal(trackers.isTrackingPixel('https://example.com/open.png', { style: 'display:none' }), true)

// Known tracker endpoints
assert.equal(trackers.isTrackingPixel('https://u123.ct.sendgrid.net/wf/open?upn=abc'), true)
assert.equal(trackers.isTrackingPixel('https://company.us1.list-manage.com/track/open.php?u=1&id=2'), true)
assert.equal(trackers.isTrackingPixel('https://track.example.com/pixel.gif'), true)

// Legitimate images must NOT be flagged
assert.equal(trackers.isTrackingPixel('https://cdn.example.com/banner.jpg', { width: '600', height: '200' }), false)
assert.equal(trackers.isTrackingPixel('data:image/png;base64,AAAA', { width: '1', height: '1' }), false)

// Authentication-Results parsing
assert.equal(auth.parseAuthWarning('mx.google.com; dkim=pass; spf=pass; dmarc=pass'), undefined)
assert.equal(auth.parseAuthWarning('mx.google.com; dkim=fail; spf=pass; dmarc=fail'), 'dmarc-fail')
assert.equal(auth.parseAuthWarning('mx.server.test; spf=fail; dkim=fail'), 'spf-dkim-fail')
assert.equal(auth.parseAuthWarning('mx.server.test; spf=pass; dkim=fail'), undefined)

console.log('Tracker blocking & Auth-Results: 1x1 pixels, tracker domains, legitimate images and SPF/DKIM/DMARC checks passed')

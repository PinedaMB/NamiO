const assert = require('node:assert/strict')
const capturePage = require('./capture-page.cjs')

;(async () => {
  const image = {}
  let calls = 0, invalidations = 0
  assert.equal(await capturePage({
    capturePage: async () => { if (++calls < 3) throw new Error('UnknownVizError'); return image },
    invalidate: () => invalidations++
  }), image)
  assert.equal(calls, 3)
  assert.equal(invalidations, 2)
  calls = 0
  await assert.rejects(capturePage({
    capturePage: async () => { calls++; throw new Error('UnknownVizError') }, invalidate() {}
  }), /UnknownVizError/)
  assert.equal(calls, 3, 'persistent capture errors still fail')
  calls = 0
  await assert.rejects(capturePage({
    capturePage: async () => { calls++; throw new Error('Renderer crashed') }, invalidate() { assert.fail('Unexpected retry') }
  }), /Renderer crashed/)
  assert.equal(calls, 1, 'unrelated failures are never retried')
  console.log('Capture: transient surface recovery, bounded retries and unrelated failures passed')
})().catch(error => { console.error(error); process.exitCode = 1 })

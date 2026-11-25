const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')

const compiled = ts.transpileModule(fs.readFileSync('src/shared/icsParser.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

const mod = {}
vm.runInNewContext(compiled, { exports: mod, require })

const sampleIcs = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:meeting-123@example.com',
  'DTSTART:20261126T150000Z',
  'DTEND:20261126T160000Z',
  'SUMMARY:Revisión de integración\\, Omnibees',
  'LOCATION:Google Meet',
  'ORGANIZER;CN="Tiago Gorgulho":mailto:tiago@example.com',
  'ATTENDEE;CN=Jorge:mailto:jorge@example.com',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const event = mod.parseIcsEvent(sampleIcs)
assert.ok(event, 'parses valid VEVENT')
assert.equal(event.uid, 'meeting-123@example.com')
assert.equal(event.summary, 'Revisión de integración, Omnibees')
assert.equal(event.location, 'Google Meet')
assert.equal(event.organizerName, 'Tiago Gorgulho')
assert.equal(event.organizerEmail, 'tiago@example.com')
assert.equal(event.start, '2026-11-26T15:00:00.000Z')
assert.equal(event.attendees.length, 1)

const reply = mod.buildIcsReply(event, 'jorge@example.com', 'ACCEPTED')
assert.ok(reply.includes('METHOD:REPLY'))
assert.ok(reply.includes('UID:meeting-123@example.com'))
assert.ok(reply.includes('ATTENDEE;PARTSTAT=ACCEPTED:mailto:jorge@example.com'))

const unsub1 = mod.parseListUnsubscribe('<mailto:unsub@news.test>, <https://news.test/unsub?id=42>', 'List-Unsubscribe=One-Click')
assert.deepEqual({ ...unsub1 }, { url: 'https://news.test/unsub?id=42', mailto: 'mailto:unsub@news.test', oneClick: true })

const unsub2 = mod.parseListUnsubscribe('<http://insecure.test/unsub>')
assert.equal(unsub2, undefined, 'rejects non-https URLs')

console.log('ICS parser & List-Unsubscribe: VEVENT parsing, iTIP REPLY generation and RFC 8058 header checks passed')

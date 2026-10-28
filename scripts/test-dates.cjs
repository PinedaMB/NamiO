const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript-test')
process.env.TZ = 'America/Mexico_City'
const compile = file => ts.transpile(fs.readFileSync(file, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const dates = {}
vm.runInNewContext(compile('src/renderer/src/lib/dates.ts'), { exports: dates })
const { formatMessageDate, formatMessageDateTime, formatElapsed } = dates
const now = Date.parse('2026-10-27T12:00:00-06:00')
assert.equal(formatMessageDate('2026-10-27T06:05:00Z', 'es', now), '00:05', 'midnight uses 00, not 24, in local time')
assert.equal(formatMessageDate('2026-10-26T23:59:00-06:00', 'es', now), 'Ayer')
assert.equal(formatMessageDate('2026-10-26T23:59:00-06:00', 'en', now), 'Yesterday')
assert.equal(formatMessageDate('2026-10-27T05:50:00Z', 'es', Date.parse('2026-10-27T00:30:00-06:00')), 'Ayer', 'calendar days follow local time, not UTC')
assert.equal(formatMessageDate('2026-10-27T10:00:00-06:00', 'es', now), '10:00')
assert.equal(formatMessageDate('2026-10-27T10:00:00-06:00', 'es', Date.parse('2026-10-28T00:01:00-06:00')), 'Ayer', 'labels advance without changing the stored message')
assert.match(formatMessageDate('2025-03-02T12:00:00Z', 'es', now), /2025/)
assert.match(formatMessageDate('2027-03-02T12:00:00Z', 'es', now), /2027/)
assert.doesNotMatch(formatMessageDate('2026-03-02T12:00:00Z', 'es', now), /2026/)
for (const invalid of ['', 'invalid', NaN, Infinity]) {
  assert.equal(formatMessageDate(invalid, 'es', now), '—')
  assert.equal(formatMessageDateTime(invalid, 'es'), '—')
}
assert.match(formatMessageDate(0, 'es', now), /1969/, 'Unix epoch is a valid instant, even when local time is in the previous year')
const full = formatMessageDateTime('2026-10-27T23:45:00-06:00', 'es')
assert.match(full, /2026/)
assert.match(full, /23:45/)
assert.match(full, /GMT|UTC|CST|CDT/, 'the detailed date identifies its time zone')
assert.equal(formatElapsed(59999, 'es'), '59 segundos')
assert.equal(formatElapsed(60000, 'es'), '1 minuto')
assert.equal(formatElapsed(3600000, 'es'), '1 hora')
assert.equal(formatElapsed(2 * 86400000, 'es'), '2 días')
assert.equal(formatElapsed(30 * 86400000, 'es'), '1 mes')
assert.equal(formatElapsed(365 * 86400000, 'en'), '1 year')
assert.equal(formatElapsed(-5000, 'es'), '0 segundos')
assert.equal(formatElapsed(NaN, 'es'), '—')

process.env.TZ = 'America/New_York'
const fall = Date.parse('2026-11-02T00:30:00-05:00')
assert.equal(formatMessageDate(fall, 'es', fall), '00:30')
assert.equal(formatMessageDate('2026-11-01T00:15:00-04:00', 'es', fall), 'Ayer', 'yesterday can be more than 24 hours ago across DST')
assert.equal(formatMessageDate('2026-03-08T00:15:00-05:00', 'es', Date.parse('2026-03-09T00:30:00-04:00')), 'Ayer', 'yesterday can be a 23-hour calendar day')

const live = {}
vm.runInNewContext(compile('src/renderer/src/data/live.ts'), { exports: live, require: id => id === '../lib/dates' ? dates : { isSpamMailbox: () => false } })
const envelopes = [
  { uid: 1, messageId: '<late>', inReplyTo: '<early>', date: '2026-10-27T23:30:00-06:00' },
  { uid: 2, messageId: '<early>', date: '2026-10-28T00:30:00Z' },
  { uid: 3, messageId: '<invalid>', inReplyTo: '<early>', date: 'invalid' }
].map(row => ({ ...row, subject: 'Test', from: null, size: 1, unread: false, flagged: false }))
assert.deepEqual(Array.from(live.envelopesToThreads(envelopes, 'es')[0].messageIds), [2, 1, 3], 'conversation order compares instants rather than ISO strings with different offsets')
const detail = live.detailToMessage({ uid: 1, date: 'invalid', text: 'Body', from: null, to: [], attachments: [] }, 'es')
assert.equal(detail.sentAt, '—', 'a malformed message date cannot crash the reader')
const drafts = live.pendingDraftThreads([], [{ id: 'bad-date', updatedAt: Infinity, to: '', subject: '', body: '' }], 'Drafts', 'es', 'Draft')
assert.equal(drafts[0].receivedAt, '—', 'a malformed draft timestamp cannot throw during ISO conversion')
console.log('Dates: Mexico formatting, local midnight, year boundaries, DST, invalid dates, elapsed units and chronological conversation order passed')

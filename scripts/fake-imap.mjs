// Servidor IMAP en memoria para pruebas de integración (no se empaqueta).
// Uso: node scripts/fake-imap.mjs [puerto]
//
// Credenciales: testuser / testpass. Buzones: INBOX, Sent, Archive.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')

const port = Number(process.argv[2] ?? 1143)

const message = (headers, body) => `${headers}\r\n\r\n${body}\r\n`

const INBOX = [
  {
    flags: [],
    raw: message(
      [
        'From: Elena Vance <elena@sequoia.vc>',
        'To: Alex Rivera <alex@namio.dev>, legal@namio.dev',
        'Subject: Series A Term Sheet Review & Founder Call',
        'Date: Wed, 22 Oct 2026 10:42:00 -0700',
        'Message-ID: <series-a-001@sequoia.vc>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8'
      ].join('\r\n'),
      [
        'Alex,',
        '',
        'Our investment committee closed consensus this morning. The $18M valuation cap holds with revised pro-rata rights.',
        '',
        'Once Latham gives the green light on clause 4.2, we can sign digitally before 5:00 PM PT.',
        '',
        'Elena'
      ].join('\r\n')
    )
  },
  {
    flags: ['\\Seen'],
    raw: message(
      [
        'From: Marcus Brody <marcus@stripe-edge.io>',
        'To: Alex Rivera <alex@namio.dev>',
        'Subject: API rate-limiting edge rollout updates',
        'Date: Wed, 22 Oct 2026 09:15:00 -0700',
        'Message-ID: <edge-rollout-002@stripe-edge.io>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8'
      ].join('\r\n'),
      [
        'We pushed regional cluster v4.9.1 to us-east-2.',
        '',
        'Gateway overhead dropped to sub-4ms with fallback webhooks enabled.',
        '',
        'Marcus'
      ].join('\r\n')
    )
  },
  {
    flags: ['\\Seen'],
    raw: message(
      [
        'From: Kavita Lamba <k.lamba@lw.com>',
        'To: Alex Rivera <alex@namio.dev>',
        'Subject: Updated Board Observer Agreement Draft',
        'Date: Tue, 21 Oct 2026 18:31:00 -0400',
        'Message-ID: <observer-003@lw.com>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="lw-boundary"'
      ].join('\r\n'),
      [
        '--lw-boundary',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Alex,',
        '',
        'Attached clean copy per Section 6.1 carveout. Please cross-reference with outside counsel comments.',
        '',
        '--lw-boundary',
        'Content-Type: application/pdf; name="Observer_Agreement_Clean.pdf"',
        'Content-Disposition: attachment; filename="Observer_Agreement_Clean.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp4nDPQM1Qo5ypUMFAwALJMLU31jBQsTAz1TVIsCg0N9QwNFYoV7BUKFPTdDA0NFYpAACs4B0MKZW5kc3RyZWFtCmVuZG9iag==',
        '--lw-boundary--'
      ].join('\r\n')
    )
  }
]

const server = hoodiecrow({
  plugins: [
    'ID',
    'AUTH-PLAIN',
    'SASL-IR',
    'NAMESPACE',
    'IDLE',
    'ENABLE',
    'CONDSTORE',
    'UNSELECT',
    'SPECIAL-USE',
    'LITERAL+'
  ],
  users: { testuser: { password: 'testpass' } },
  storage: {
    '': {
      separator: '/',
      type: 'personal',
      folders: {
        Sent: { messages: [] },
        Archive: { messages: [] }
      }
    },
    INBOX: { messages: INBOX }
  }
})

server.listen(port, () => {
  console.log(`fake-imap escuchando en 127.0.0.1:${port} (testuser/testpass)`)
})

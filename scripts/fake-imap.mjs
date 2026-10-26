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
        'Content-Type: multipart/alternative; boundary="alt-series-a"'
      ].join('\r\n'),
      [
        '--alt-series-a',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Alex,',
        '',
        'Our investment committee closed consensus this morning. The $18M valuation cap holds with revised pro-rata rights.',
        '',
        'Once Latham gives the green light on clause 4.2, we can sign digitally before 5:00 PM PT.',
        '',
        'Elena',
        '',
        '--alt-series-a',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px">',
        '  <p>Alex,</p>',
        '  <p>Our investment committee <strong>closed consensus</strong> this morning. The $18M valuation cap holds with revised pro-rata rights.</p>',
        '  <p><a href="https://example.com/term-sheet">Ver el term sheet completo</a></p>',
        '  <p><img src="https://example.com/logo.png" width="120" height="40" alt="Sequoia" /></p>',
        '  <p><img src="https://tracker.example.com/pixel.gif" width="1" height="1" alt="" /></p>',
        '  <p>Elena</p>',
        '</div>',
        '',
        '--alt-series-a--'
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
  },
  {
    flags: [],
    raw: message(
      [
        'From: Sequoia Events <events@sequoia.vc>',
        'To: Alex Rivera <alex@namio.dev>',
        'Subject: Press embargo reminder for the announcement',
        'Date: Thu, 23 Oct 2026 08:05:00 -0700',
        'Message-ID: <embargo-004@sequoia.vc>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8'
      ].join('\r\n'),
      [
        'Hi Alex,',
        '',
        'Quick reminder: the press embargo lifts at 6:00 AM PT on Friday.',
        '',
        'Please keep the announcement under wraps until then.',
        '',
        'Sequoia Events'
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

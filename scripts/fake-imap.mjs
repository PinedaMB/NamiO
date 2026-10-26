// Servidor IMAP en memoria para pruebas de integración (no se empaqueta).
// Uso: node scripts/fake-imap.mjs [puertoImap] [puertoSmtp]
//
// Credenciales: testuser / testpass. Buzones: INBOX, Sent, Archive.
// El SMTP de entrada deposita todo en INBOX (ciclo de envío completo).
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')

const port = Number(process.argv[2] ?? 1143)
const smtpPort = Number(process.argv[3] ?? 1025)
/** Mensajes extra para probar la sync completa (opcional): node fake-imap.mjs 1143 1025 300 */
const bulk = Number(process.argv[4] ?? 0)

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
    'XOAUTH2',
    'NAMESPACE',
    'IDLE',
    'ENABLE',
    'CONDSTORE',
    'UNSELECT',
    'SPECIAL-USE',
    'LITERAL+'
  ],
  users: { testuser: { password: 'testpass', xoauth2: { accessToken: 'testtoken' } } },
  storage: {
    '': {
      separator: '/',
      type: 'personal',
      folders: {
        Sent: { messages: [] },
        Archive: { messages: [] }
      }
    },
    INBOX: {
      messages: [
        ...INBOX,
        // Volumen opcional para probar la sync completa y el progreso.
        ...Array.from({ length: bulk }, (_, index) => ({
          flags: [],
          raw: message(
            [
              `From: Boletin <boletin+${index + 1}@rutamayatravel.com>`,
              'To: testuser@namio.dev',
              `Subject: Boletin de prueba #${index + 1}`,
              `Date: ${new Date(Date.now() - (index + 1) * 3_600_000).toUTCString()}`,
              `Message-ID: <bulk-${index + 1}@rutamayatravel.com>`,
              'MIME-Version: 1.0',
              'Content-Type: text/plain; charset=utf-8'
            ].join('\r\n'),
            `Cuerpo del boletin ${index + 1}.`
          )
        }))
      ]
    }
  }
})

server.listen(port, () => {
  console.log(`fake-imap escuchando en 127.0.0.1:${port} (testuser/testpass)`)

  // SMTP de entrada propio (no el helper de hoodiecrow) para poder exigir
  // XOAUTH2: así se prueba el envío con token, no solo con contraseña.
  const smtpRequire = createRequire(require.resolve('hoodiecrow-imap'))
  const { SMTPServer } = smtpRequire('smtp-server')
  const credentials = server.getCredentials()

  const smtp = new SMTPServer({
    banner: 'NamiO test SMTP',
    authMethods: ['PLAIN', 'LOGIN', 'XOAUTH2'],
    key: credentials.key,
    cert: credentials.cert,
    logger: false,
    onAuth(auth, session, done) {
      if (auth.method === 'XOAUTH2') {
        if (auth.username === 'testuser' && auth.accessToken === 'testtoken') {
          done(null, { user: 'testuser' })
          return
        }
        done(new Error('token XOAUTH2 inválido'))
        return
      }

      if (auth.username === 'testuser' && auth.password === 'testpass') {
        done(null, { user: 'testuser' })
        return
      }
      done(new Error('credenciales inválidas'))
    },
    onData(stream, session, done) {
      const chunks = []
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('error', done)
      stream.on('end', () => {
        server.appendMessage('INBOX', [], false, Buffer.concat(chunks).toString('binary'))
        done()
      })
    }
  })

  smtp.on('error', () => undefined)
  smtp.listen(smtpPort, () => {
    console.log(`fake-smtp escuchando en 127.0.0.1:${smtpPort} (XOAUTH2: testtoken)`)
  })
})

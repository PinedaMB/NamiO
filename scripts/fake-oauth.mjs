// Servidor OAuth2 falso para probar el flujo completo sin proveedores reales.
// Uso: node scripts/fake-oauth.mjs [puerto]
//
// - GET /authorize  → redirige al redirect_uri con ?code=testcode&state=<mismo>
// - POST /token     → access_token "testtoken" (refresh "testrefresh") + id_token
// - Cualquier otro  → 404
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 9000)
const ACCESS_TOKEN = 'testtoken'
const REFRESH_TOKEN = 'testrefresh'

const idToken = () => {
  const payload = Buffer.from(JSON.stringify({ email: 'testuser@namio.dev', sub: 'testuser' })).toString('base64url')
  return `header.${payload}.signature`
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)

  if (request.method === 'GET' && url.pathname === '/authorize') {
    const redirect = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state') ?? ''

    // Deja constancia de PKCE y scope: la prueba verifica que viajen.
    console.log(`[authorize] url=${url.toString()}`)
    console.log(
      `[authorize] challenge=${url.searchParams.get('code_challenge')?.slice(0, 12) ?? '-'}…` +
        ` method=${url.searchParams.get('code_challenge_method')} scope="${url.searchParams.get('scope')}"`
    )

    if (!redirect) {
      response.writeHead(400, { 'content-type': 'text/plain' }).end('falta redirect_uri')
      return
    }

    const target = new URL(redirect)
    target.searchParams.set('code', 'testcode')
    target.searchParams.set('state', state)
    response.writeHead(302, { location: target.toString() }).end()
    return
  }

  if (request.method === 'POST' && url.pathname === '/token') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      const grant = body.get('grant_type')
      console.log(
        `[token] grant=${grant} client=${body.get('client_id')} verifier=${body.get('code_verifier')?.slice(0, 10) ?? '-'}…`
      )

      if (grant === 'refresh_token' && body.get('refresh_token') !== REFRESH_TOKEN) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }

      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          expires_in: 3600,
          token_type: 'Bearer',
          id_token: idToken()
        })
      )
    })
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not_found' }))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`fake-oauth escuchando en http://127.0.0.1:${port}`)
  console.log(`  authorize: http://127.0.0.1:${port}/authorize`)
  console.log(`  token:     http://127.0.0.1:${port}/token`)
})

import { useEffect, useState } from 'react'
import type { CoreStatus, Milestone } from '@shared/ipc'

const ROADMAP: ReadonlyArray<{ id: Milestone; title: string; detail: string }> = [
  { id: 'M0', title: 'Esqueleto y contrato IPC', detail: 'Ventana, aislamiento y núcleo tipado' },
  { id: 'M1', title: 'IMAP: conectar y listar', detail: 'Una cuenta real, carpetas e INBOX' },
  { id: 'M2', title: 'Visor de mensaje', detail: 'MIME, HTML sanitizado y adjuntos' },
  { id: 'M3', title: 'Caché local y offline', detail: 'SQLite + sync incremental por UID' },
  { id: 'M4', title: 'Enviar y borradores', detail: 'SMTP y cola de salida' },
  { id: 'M5', title: 'Multi-cuenta y búsqueda', detail: 'FTS5 e hilos por References' },
  { id: 'M6', title: 'OAuth2 y empaquetado', detail: 'AppImage y .deb para Linux' }
]

const FOLDERS = ['Recibidos', 'Enviados', 'Borradores', 'Papelera', 'Spam'] as const

function App(): React.JSX.Element {
  const [status, setStatus] = useState<CoreStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api
      .getCoreStatus()
      .then((value) => {
        if (alive) setStatus(value)
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Correo</strong>
            <span className="brand-sub">para Linux</span>
          </div>
        </div>

        <div className="account">
          <span className="account-label">Cuenta</span>
          <p className="account-empty">Ninguna configurada</p>
          <button className="btn-primary" type="button" disabled>
            Conectar cuenta · M1
          </button>
        </div>

        <nav className="folders" aria-label="Carpetas">
          {FOLDERS.map((folder) => (
            <button key={folder} type="button" className="folder" disabled>
              <span>{folder}</span>
              <span className="count">0</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="dot" aria-hidden="true" />
          Núcleo en línea
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <input
            className="search"
            type="search"
            placeholder="Buscar correos · llega en M5"
            disabled
            aria-label="Buscar correos"
          />
        </header>

        <section className="content">
          <div className="hero">
            <span className="badge">Hito M0 completado</span>
            <h1>Base lista para hablar IMAP</h1>
            <p>
              El proceso principal ya aísla la UI: el renderer no tiene red, ni disco, ni Node. El
              siguiente paso es el motor de sincronización.
            </p>
          </div>

          <div className="grid">
            <article className="card">
              <h2>Diagnóstico</h2>
              {error ? (
                <p className="error">No se pudo leer el núcleo: {error}</p>
              ) : status ? (
                <dl className="facts">
                  <div>
                    <dt>Etapa</dt>
                    <dd className="mono">{status.stage}</dd>
                  </div>
                  <div>
                    <dt>Versión</dt>
                    <dd className="mono">{status.appVersion}</dd>
                  </div>
                  <div>
                    <dt>Electron</dt>
                    <dd className="mono">{status.electronVersion}</dd>
                  </div>
                  <div>
                    <dt>Plataforma</dt>
                    <dd className="mono">{status.platform}</dd>
                  </div>
                  <div>
                    <dt>Cuentas</dt>
                    <dd className="mono">{status.accountCount}</dd>
                  </div>
                  <div>
                    <dt>Empaquetado</dt>
                    <dd className="mono">{status.isPackaged ? 'sí' : 'no'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="muted">Consultando al núcleo…</p>
              )}
            </article>

            <article className="card">
              <h2>Roadmap</h2>
              <ol className="roadmap">
                {ROADMAP.map((item) => (
                  <li key={item.id} className={item.id === 'M0' ? 'done' : undefined}>
                    <span className="milestone">{item.id}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          </div>

          <p className="footnote">
            Arquitectura: main (ventanas, keyring, IPC) · worker (sync IMAP) · SQLite FTS5 · cola
            SMTP. La UI solo lee de la caché local.
          </p>
        </section>
      </main>
    </div>
  )
}

export default App

# NamiO — cliente de email para Linux

NamiO es un cliente de correo de escritorio (IMAP/SMTP) con caché local, pensado para Linux y
desarrollado en Windows. Estado actual: **M0 + shell visual** — aislamiento real entre UI y núcleo, y
la identidad visual del producto aplicada sobre datos de demostración.

## Stack y por qué

| Pieza | Elección | Motivo |
| --- | --- | --- |
| Shell | Electron 45 | Chromium ya renderiza HTML de correo como lo espera el usuario; es el punto donde más se sufre en GTK/WebKit |
| UI | React 19 + TypeScript | Iteración rápida; sin framework de estilos para arrancar liviano |
| Build | electron-vite 6 + Vite 8 | HMR en el renderer y bundle CJS para main/preload |
| Paquetes | electron-builder 26 | AppImage + `.deb` desde CI en Ubuntu |

Costo asumido: ~150–300 MB de RAM. Si el objetivo pasa a ser un cliente ultraliviano, la ruta de
salida es Tauri + Rust, no seguir optimizando Electron.

## Arquitectura

```
┌── Renderer (React) ── solo UI, sin red, sin disco, sin Node ──┐
│                  IPC tipado (contextBridge)                  │
├── Main (Node) ── ventanas, menús, keyring, CSP ──────────────┤
│   Worker: motor de sync (imapflow + IDLE)                    │
│   SQLite WAL + FTS5  ← caché local = offline                 │
│   Cola de salida (nodemailer) + borradores                   │
└──────────────────────────────────────────────────────────────┘
```

**Regla dura:** la UI nunca toca la red. Todo pasa por la caché local, y los canales de
`src/shared/ipc.ts` son la única superficie pública del núcleo. Agregar un canal es una decisión de
seguridad.

```
src/
  main/      proceso principal: ventana, sesión, handlers IPC
  preload/   puente contextBridge; única API que ve la UI
  renderer/  React; cero privilegios
  shared/    contrato IPC y tipos compartidos
```

Decisiones de seguridad ya aplicadas en M0:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Navegación externa bloqueada: los links van al navegador del sistema, nunca a una ventana de Electron.
- CSP estricta en producción (`frame-src 'none'`, `object-src 'none'`, `connect-src 'self'`).
- Permisos de la sesión denegados por defecto; se habilitan uno por uno cuando una feature lo justifique.
- Instancia única: dos procesos escribiendo la misma caché SQLite es un bug garantizado.

## Identidad visual

![Bandeja de tres paneles](docs/inbox.png)

La interfaz sigue la identidad de los mockups **Veloce** —superficie casi negra con acentos
índigo-lavanda, Inter para el contenido y JetBrains Mono para metadatos, etiquetas y atajos— con la
marca **NamiO**. Los tokens viven en
[`src/renderer/src/styles/tokens.css`](src/renderer/src/styles/tokens.css): cambiar la marca es
cambiar ese archivo.

| Pieza | Decisión |
| --- | --- |
| Paleta | `#0f131c` superficie · `#c0c1ff` primario · `#bdc2ff` secundario · `#b8c4ff` terciario · `#ffb4ab` error |
| Tipografía | Inter Variable (contenido) + JetBrains Mono Variable (metadatos, `kbd`, direcciones) |
| Iconos | Material Symbols Outlined, **empaquetado**: 4 MB de woff2, cero pedidos a CDN |
| Estructura | rail 224 · cola 380 · lectura flexible · contexto 320 · pie 36 |
| Atajos | `J`/`K` navegar · `E` archivar · `S` destacar · `R` responder · `C` redactar · `⌘K` paleta |

La UI se adapta al ancho: debajo de 1560px la ficha del remitente pasa a dos filas, debajo de 1520px
los atajos salen del toolbar de lectura (siguen en el pie) y debajo de 1280px se oculta el panel de
contexto.

El panel de contexto (IA) se colapsa con el botón del extremo derecho del toolbar: la lectura gana
todo el ancho y la preferencia se recuerda en `settings.json`. El colapso anima el ancho (260 ms) con
el contenido a ancho fijo, así se recorta en vez de reflowear.

![Panel de contexto colapsado](docs/inbox-collapsed.png)

El resto del movimiento es deliberadamente corto: 220 ms al cambiar de pantalla, 160–190 ms al
cambiar de sección o de hilo, y 140 ms de salida en paleta y compositor. Todo respeta
`prefers-reduced-motion`.

| Compositor | Paleta de comandos |
| --- | --- |
| ![Compositor con copiloto](docs/compose.png) | ![Paleta de comandos](docs/palette.png) |

Dos decisiones a tener presentes:

- **La UI es bilingüe (es/en)**: toda la copia sale de `src/renderer/src/i18n/`. El contenido de los
  correos no se traduce, se lee en el idioma en que llegó (ver [Idioma](#idioma)).
- **`src/renderer/src/data/demo.ts` es demostración**, no datos reales. Cuando llegue el motor de
  sync esto se reemplaza por la caché SQLite sin tocar los componentes.

## Idioma

La interfaz está en español e inglés, con un conmutador `ES / EN` en la barra superior.

| Español | English |
| --- | --- |
| ![Interfaz en español](docs/inbox-es.png) | ![Interfaz en inglés](docs/inbox.png) |

- Diccionarios tipados en [`src/renderer/src/i18n/`](src/renderer/src/i18n): `es.ts` es la fuente y
  define `Dictionary`; `en.ts` está declarado como `Dictionary`, así que **una clave faltante no
  compila**.
- Idioma inicial: preferencia guardada → idioma del sistema → español.
- La preferencia se persiste en `settings.json` dentro del perfil de la app, por IPC
  (`settings:get` / `settings:set`). El renderer nunca escribe archivos.
- **Se traduce** toda la copia de la interfaz: carpetas, filtros, barra de lectura, paleta de comandos,
  compositor, avisos y etiquetas.
- **No se traduce** el contenido de los correos ni lo derivado de ellos (asuntos, cuerpos, resumen del
  copiloto, acciones detectadas): un correo se lee en el idioma en que llegó.

Sumar un idioma es crear `pt.ts` tipado como `Dictionary` y agregarlo a `LOCALES` y `DICTIONARIES`.

## Configuración y atajos

![Configuración](docs/settings.png)

Se abre con `⌘,`, con el engranaje del rail o con el ícono de preferencias. Tiene cinco secciones:
General y velocidad, Atajos de teclado, Cuentas y alias, Ajuste del copiloto, y Reglas y filtros.

- **Atajos remapeables de verdad**: clic en una fila, se presiona la combinación nueva y se aplica.
  Los atajos viven en un provider compartido, así que la bandeja, la leyenda del pie y la paleta
  reaccionan en el acto, y persisten en `settings.json` entre reinicios.
- Detección de conflictos (`⌘K` ya lo usa «Abrir la paleta»), `Esc` reservado para cerrar y botón
  para volver al esquema por defecto.
- Las secciones sin motor todavía (Cuentas, Copiloto, Reglas) son estados vacíos explícitos, no
  maquetas falsas: dicen qué falta y en qué hito llega.
- El diagnóstico muestra versión, Electron y plataforma reales, obtenidos por IPC.

| Acción | Por defecto |
| --- | --- |
| Siguiente / anterior | `J` / `K` |
| Archivar | `E` |
| Destacar | `S` |
| Posponer | `H` |
| Responder | `R` |
| Redactar | `C` |
| Paleta de comandos | `⌘K` |
| Ajustes | `⌘,` |

## M1: IMAP real

![Cuenta conectada](docs/inbox-live.png)

Conectar una cuenta real ya funciona de punta a punta: diálogo de credenciales, buzones del servidor,
bandeja con los últimos 50 mensajes y lectura del cuerpo de texto.

![Conectar cuenta](docs/account.png)

- **Credenciales**: la contraseña se guarda cifrada por el SO con `safeStorage` (DPAPI en Windows,
  libsecret/kwallet en Linux). Si el sistema no ofrece cifrado, no se persiste y el diálogo lo avisa.
- **Transporte**: `imapflow` vive solo en el proceso principal; el renderer no abre sockets. Todo pasa
  por IPC y devuelve `{ ok: true, data }` o `{ ok: false, code, detail }`, con códigos de error
  (auth, dns, refused, timeout, tls, network) que la UI traduce.
- **Buzones**: `LIST` + `STATUS` por buzón (hasta 30) para mostrar totales. Es lento a propósito en M1;
  M3 lo resuelve con la caché local.
- **Mensajes**: `ENVELOPE` + `FLAGS` + tamaño; al abrir, se descarga la fuente y se parsea con
  `mailparser` para mostrar texto y adjuntos. El HTML sanitizado es M2.
- **Destacar** sí escribe en el servidor (`\Flagged`). Archivar, mover, posponer y eliminar quedan
  deshabilitados hasta que exista la caché local (M3): mejor un botón apagado que uno que mienta.

Limitaciones conocidas de M1: sin OAuth2 (solo contraseña de aplicación), sin STARTTLS (el cifrado se
elige con el switch), sin caché (cada carpeta se consulta al servidor) y sin HTML.

Para probar sin cuenta real:

```bash
node scripts/fake-imap.mjs 1143   # servidor IMAP en memoria: testuser / testpass
```

En la app: Conectar cuenta → Local (pruebas) → Conectar.

## Comandos

```bash
pnpm install
pnpm dev            # app en desarrollo con HMR; detecta solo si puede usar el sandbox
pnpm dev:raw        # electron-vite dev crudo (sin detección)
pnpm dev:web        # solo el renderer (Vite + HMR), sin Electron
pnpm dev:restricted # fuerza sandbox desactivado (ver más abajo)
pnpm typecheck      # tsc para main/preload y para el renderer
pnpm build          # typecheck + build de producción en out/
pnpm build:linux    # AppImage + .deb (requiere Linux o CI)
pnpm preview        # sirve out/renderer en http://127.0.0.1:4173 (revisar UI sin Electron)
```

Herramientas de revisión visual (usan Edge o Chromium headless, no Electron):

```bash
node scripts/shoot.mjs http://127.0.0.1:4173/ .cache/inbox.png   # captura PNG
node scripts/shoot.mjs http://127.0.0.1:4173/ .cache/x.png "document.querySelector('.search').click()"
node scripts/probe.mjs "document.querySelector('.statusbar').getBoundingClientRect().width"
```

Los artefactos quedan en `release/`.

## Estado de verificación

| Comprobación | Estado |
| --- | --- |
| `pnpm install` reproducible (pnpm 12, builds autorizados) | ✅ |
| `pnpm typecheck` (main/preload y renderer) | ✅ |
| `pnpm build` → `out/main`, `out/preload`, `out/renderer` | ✅ |
| App Electron real: ventana, IPC y smoke test 7/7 | ✅ |
| UI capturada en Chromium headless (bandeja, compositor, paleta) | ✅ |
| Remapeo de atajos: aplicado en vivo y persistido en `settings.json` | ✅ |
| M1: cuenta IMAP, buzones, bandeja, cuerpo y adjuntos (contra servidor de prueba) | ✅ |
| Destacar (`\Flagged`) escrito en el servidor | ✅ |

### Si `pnpm dev` muere con `-2147483645` o `0xc0000005`

No es el proyecto: es Chromium inicializando en un entorno restringido. Hay dos causas
independientes, y conviene distinguirlas porque los códigos se parecen:

1. **Sandbox de Chromium.** Dentro de un Job Object restrictivo (contenedores, CI, terminales
   embebidas) Chromium no puede crear su sandbox y llama a `__debugbreak()`: el proceso muere con
   `STATUS_BREAKPOINT` (`0x80000003`, que Node reporta como `-2147483645`) antes de ejecutar una sola
   línea de JavaScript.
2. **Perfil no escribible.** Si `%APPDATA%` está bloqueado por un sandbox de archivos, Chromium muere
   con `ACCESS_VIOLATION` (`0xc0000005`) mientras inicializa su perfil, sin ningún mensaje de error.

`scripts/dev.mjs` resuelve las dos antes de arrancar: sonda `electron --version` (no necesita perfil
ni ventana, y falla exactamente cuando el sandbox no puede crearse) y mueve el perfil a
`.cache/userdata`, que siempre es escribible dentro del proyecto.

```bash
pnpm dev              # detecta y se adapta; no hace falta que elijas nada
pnpm dev:restricted   # fuerza sandbox desactivado (si la sonda te da un falso positivo)
pnpm dev:raw          # electron-vite dev crudo, para diagnosticar
```

| Situación | Resultado de `pnpm dev` |
| --- | --- |
| Terminal normal de Windows/Linux | sandbox activo, perfil en `.cache/userdata` |
| Contenedor, CI o terminal embebida | sandbox desactivado **solo en desarrollo** + aviso en consola |
| Solo la UI, sin Electron | `pnpm dev:web` → http://localhost:5173 |

Nunca se desactiva el sandbox en los builds de producción: eso vive únicamente en el lanzador de
desarrollo. El perfil de desarrollo se resetea borrando `.cache/userdata`.

Smoke test automático (necesita la app con `--remote-debugging-port=9333`):

```bash
node scripts/smoke.mjs
```

Valida que React montó, que el puente IPC existe, que `window.require` **no** está expuesto y que el
núcleo responde `stage: "M0"`.

## Roadmap

| # | Entrega | Criterio de listo |
| --- | --- | --- |
| ✅ M0 | Esqueleto, aislamiento y contrato IPC | La app abre y reporta estado del núcleo |
| ✅ Shell | Identidad visual de NamiO sobre datos de demostración | Bandeja, compositor y paleta navegables |
| ✅ M1 | **Rebanada vertical**: conectar 1 cuenta IMAP, listar carpetas, abrir INBOX | Se ven correos reales en pantalla |
| M2 | Visor de mensaje: MIME, HTML sanitizado, adjuntos | Se abre un correo con imágenes y links |
| M3 | Caché SQLite + sync incremental + offline | Sin red, la app muestra todo lo ya sincronizado |
| M4 | Redactar/enviar SMTP + borradores | Llega un mail enviado a uno mismo |
| M5 | Multi-cuenta, búsqueda FTS5, hilos por `References` | Buscar devuelve resultados correctos |
| M6 | OAuth2 (Gmail/Outlook) + empaquetado | Instalable en Linux vía `.deb` |

## Los problemas que hay que respetar desde el día uno

1. **OAuth2 antes de M4.** Gmail y Outlook ya no aceptan contraseña de aplicación en todos los casos:
   hace falta registrar la app en Google Cloud / Entra y usar PKCE con redirect a loopback.
2. **Sync incremental de verdad.** `UIDVALIDITY` y `UIDNEXT` son el mínimo; `CONDSTORE`/`QRESYNC`
   evita re-bajar la bandeja entera cada vez.
3. **MIME real.** Multipart anidado, `encoded-words` (RFC 2047), charsets rotos, base64 y
   quoted-printable, adjuntos en streaming (nunca cargar 30 MB en memoria).
4. **HTML hostil.** Sanitizar (DOMPurify), bloquear imágenes remotas por defecto (tracking pixels),
   cero JS, CSP estricta, sin `iframe` hasta que haya sandboxing explícito.
5. **Gmail no es IMAP estándar.** Etiquetas vs. carpetas, `[Gmail]/All Mail`, nombres en UTF-7.
6. **Cola de salida idempotente.** Sin red el envío se encola; con red se reintenta sin duplicar.

## Notas de despliegue en Linux

- Los paquetes se generan en `.github/workflows/build-linux.yml` (Ubuntu), no desde Windows.
- Falta `build/icon.png` de 512×512 antes del primer release; sin eso electron-builder usa el icono
  por defecto de Electron.
- `author.email` en `package.json` es un placeholder: `.deb` lo usa como maintainer.
- Flatpak queda para después de M6; el canal natural es Flathub con el runtime de Electron.

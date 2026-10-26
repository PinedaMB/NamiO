# Correo — cliente de email para Linux

Cliente de correo de escritorio (IMAP/SMTP) con caché local, pensado para Linux y desarrollado en
Windows. Estado actual: **M0 + shell visual** — aislamiento real entre UI y núcleo, y la identidad
visual del producto aplicada sobre datos de demostración.

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

La interfaz sigue la identidad **Veloce**: superficie casi negra con acentos índigo-lavanda, Inter
para el contenido y JetBrains Mono para metadatos, etiquetas y atajos. Los tokens viven en
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

| Compositor | Paleta de comandos |
| --- | --- |
| ![Compositor con copiloto](docs/compose.png) | ![Paleta de comandos](docs/palette.png) |

Dos decisiones a tener presentes:

- **La copia de la UI está en inglés** porque es el idioma del diseño. Los strings viven en cada
  componente; se extraen a i18n cuando empecemos M1.
- **`src/renderer/src/data/demo.ts` es demostración**, no datos reales. Cuando llegue el motor de
  sync esto se reemplaza por la caché SQLite sin tocar los componentes.

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
| ✅ Shell | Identidad visual Veloce sobre datos de demostración | Bandeja, compositor y paleta navegables |
| M1 | **Rebanada vertical**: conectar 1 cuenta IMAP, listar carpetas, abrir INBOX | Se ven correos reales en pantalla |
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

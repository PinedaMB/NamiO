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

El sistema completo (paleta con contrastes medidos, escala tipográfica, layout, componentes, motion,
accesibilidad y reglas de implementación) está en **[DESIGN.md](DESIGN.md)**.

| Pieza | Decisión |
| --- | --- |
| Marca | Mapache índigo (logo) en el rail a 30 px; icono de app 512/1024 desde el mismo master |
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

## M2: HTML de correo

![Correo HTML con imágenes bloqueadas](docs/html-email.png)

- El HTML se sanitiza con **DOMPurify** y se pinta en un **iframe aislado** (`sandbox="allow-same-origin"`,
  sin `allow-scripts`) con su propia CSP: `default-src 'none'`, imágenes solo `data:` por defecto, sin
  formularios y con `base-uri 'none'`. Aunque la sanitización fallara, no hay scripts posibles.
- **Imágenes remotas bloqueadas por defecto**: se reemplazan por un GIF transparente antes de renderizar,
  así el píxel de tracking nunca se pide. Un banner permite cargarlas solo para ese mensaje, y en
  **Ajustes → General** se elige la política global (`Bloquear` o `Permitir`), que se guarda en el perfil.
- **Links**: los clicks se interceptan y se abren con `shell.openExternal`, que solo acepta `http(s)` y
  `mailto:`. Nada de `javascript:`, `data:` ni `file:`.
- El correo se dibuja sobre **papel claro** dentro del tema oscuro, como hacen la mayoría de los clientes:
  el HTML ajeno asume fondo blanco.
- **Altura automática**: el iframe comparte origen (sin scripts), el padre lo mide y evita el scroll
  anidado.

Verificado: 2 imágenes remotas pasan a `data:`, el click de un link no navega el iframe (queda en
`about:srcdoc`, o sea que el `preventDefault` corre) y al mostrar imágenes vuelven las URLs reales.

Limitaciones de M2: sin `cid:` (imágenes embebidas como adjunto) y sin zoom de texto.

## M3: caché local y modo offline

![Modo offline sobre la caché](docs/offline.png)

- **SQLite embebido** (`node:sqlite`, sin módulos nativos que recompilar) en `cache.db` dentro del
  perfil. Tablas `mailboxes`, `messages` y `meta`.
- **La UI lee siempre de la caché**; la red solo la actualiza. Al abrir una carpeta con caché se
  responde al instante y se sincroniza en segundo plano; el motor avisa por IPC y la lista se refresca.
- **Sync incremental**: se guardan `UIDVALIDITY` y `UIDNEXT` por buzón. Si cambia la validez de UIDs se
  reinicia ese buzón; si no, se piden solo los mensajes nuevos.
- **Offline real**: si la red falla, la app sigue mostrando la copia local, con una franja
  "Sin conexión", botón de reintento y el estado real en el rail.
- **Caché de cuerpos**: texto, HTML, destinatarios y adjuntos se guardan al leer el mensaje. Si se abre
  uno sin conexión cuyo cuerpo no estaba cacheado, lo dice en vez de inventar.

Limitaciones de M3: sin búsqueda FTS (M5), sin poda de mensajes borrados en el servidor, y archivar /
eliminar siguen deshabilitados porque necesitan la cola de salida de M4.

## M4: envío y cola de salida

![Cola de salida con un envío pendiente](docs/outbox.png)

- **SMTP real** con las credenciales de la cuenta (nodemailer), compartiendo usuario y contraseña con
  IMAP; los presets ya cargan también el servidor de envío.
- El mensaje se compone en crudo (RFC 5322, asunto UTF-8) y **lo mismo que sale se copia a Enviados**
  por `APPEND`, así el original queda idéntico.
- **Cola de salida** en SQLite: enviar, archivar y eliminar se encolan primero y se aplican en orden.
  Sin red quedan pendientes (contador en la barra de estado); si el servidor rechaza, se reintenta
  hasta 5 veces y queda `failed` con aviso y botón de reintento.
- **Archivar y eliminar** ya modifican el servidor de verdad y actualizan la caché.
- Después de enviar se sondea la bandeja: si el servidor devuelve la copia (o te escribís a vos mismo),
  aparece sola.

Verificado con el servidor de pruebas: varios envíos llegaron a INBOX y quedaron en Sent, un mensaje
archivado terminó en Archive, otro borrado desapareció del servidor, y un envío encolado sin red salió
al reconectar.

Limitaciones de M4: sin borradores persistidos, sin adjuntos ni HTML en el envío, y sin IDLE (la
bandeja se sondea cada 60 s).

## M5: búsqueda local (FTS5)

![Búsqueda sobre la caché](docs/search.png)

- Índice **FTS5** dentro de la misma base de la caché (`unicode61 remove_diacritics 2`): encuentra
  "valoración" buscando `valoracion`, y funciona con prefijos.
- Se indexan asunto y remitentes de **todos** los mensajes sincronizados, y el **cuerpo** cuando se
  descarga. El índice se mantiene al vuelo (se reindexa al insertar, al actualizar el asunto y al
  guardar el cuerpo).
- Resultados con **fragmento resaltado** (`snippet()` de FTS5), buzón de origen y salto directo al
  mensaje; si vive en otro buzón, la app cambia de carpeta y lo abre.
- La consulta se sanea (comillas, paréntesis, operadores) para que nada de lo que se escriba rompa el
  motor, y va con debounce de 200 ms y mínimo dos caracteres.

Verificado: `sequoia` devuelve 2 mensajes (coincidencia en remitente), `embargo` devuelve 1 con el
fragmento resaltado y `zzzz` no devuelve nada.

Limitación honesta: se busca **solo en la caché**, y los cuerpos entran al índice cuando se abren. La
búsqueda contra el servidor (IMAP `SEARCH`) queda pendiente.

## Pulido para uso diario

![Responder con cita](docs/reply.png)

Antes de empaquetar se cerraron los huecos que hacían ruido al usar la app de verdad:

- **Leído / no leído**: abrir un mensaje escribe `\Seen` en el servidor y el cambio se refleja al
  instante; `U` (remapeable) lo alterna y el botón de la barra hace lo mismo. El hilo abierto no
  desaparece del filtro "Sin leer" mientras lo leés: si desapareciera, la selección saltaría al
  siguiente y lo marcaría leído también (una cascada de mensajes leídos sin abrir).
- **Responder con cita**: `R` precarga destinatario, `Re: …` y el cuerpo original citado con `>`.
- **Adjuntos descargables**: cada adjunto se baja del servidor y se guarda con el diálogo del sistema.
- **Flags frescos**: en cada sincronización se refrescan los flags del tramo reciente, así leer desde
  el móvil se ve acá (antes la caché se quedaba con el estado viejo para siempre).
- **Filtros honestos**: en modo real solo se muestran los filtros que tienen datos; el de VIP es de la
  demo y ya no aparece con una cuenta conectada.
- **Compositor limpio**: con cuenta real no aparece el copiloto de demo, ni los adjuntos de ejemplo,
  ni las etiquetas de "guardado automático" y "retención cero" que no eran ciertas.
- **Adjuntos al enviar**: el clip abre el diálogo del sistema y el mensaje sale como `multipart/mixed`
  (compilado con nodemailer); la copia en Enviados es exactamente el mismo crudo que se envió.
- **Borrador**: cerrar el compositor con texto lo guarda en la caché; al abrir uno nuevo se retoma con
  el aviso "Borrador restaurado", y enviar lo limpia.

Limitaciones conocidas: hay **un solo borrador** (el último compositor, sin lista de borradores) y el
envió no permite aún elegir remitente alternativo.

## Integridad del CSS

`pnpm run css:audit` cruza el CSS con el JSX y verifica cuatro cosas: que toda variable usada esté
definida, que toda clase usada en un componente tenga al menos una regla, que los `url()` locales
resuelvan y que el bundle construido conserve sus assets (fuentes incluidas).

Estado actual: **337 clases definidas / 322 usadas · 54 variables (46 usadas) · 0 problemas**.

Lo que encontró y se corrigió en esta pasada:

- `--tertiary-container` se usaba en dos lugares y **nunca se definía**, así que `.avatar--tertiary`
  se quedaba sin fondo (la declaración entera era inválida). Ahora está en `tokens.css`.
- `.mono` se usaba en Ajustes para versiones y rutas, **sin regla**: los valores salían en la fuente
  de interfaz. Se agregó la utilidad.
- `.list-empty` (estado vacío de búsqueda), `.attachment__icon` y `.statusbar__version` se usaban sin
  estilo propio; se agregaron sus reglas.
- `var(--text-dim, …)` apuntaba a una variable inexistente; se dejó el fallback directo.

Deuda anotada, sin efecto en runtime: 8 variables y 15 clases que vienen de los mockups y ya no se
usan (`t-headline-*`, `kbd--*` extra, `btn--surface/quiet/ghost`, etc.). Se pueden podar cuando
convenga; el auditor las lista con `--verbose`.

## OAuth2 (Gmail y Outlook)

![Cuenta configurada con OAuth2](docs/account-oauth.png)

Gmail y Microsoft ya no aceptan usuario + contraseña para IMAP/SMTP. La app implementa el flujo de
escritorio completo, sin backend:

- **PKCE (S256)** y redirect a un **loopback efímero** (`http://127.0.0.1:<puerto libre>/callback`),
  con `state` verificado; para Microsoft usa `localhost`, que es lo que exige su registro.
- **El refresh token se guarda cifrado** con `safeStorage` (DPAPI, libsecret o Keychain); el access
  token vive en memoria y se renueva solo. Al reabrir la app se reconecta sin tocar el navegador.
- **IMAP por XOAUTH2** (`imapflow`) y **SMTP por XOAUTH2** (`nodemailer`) con el mismo token.
- Necesitás **tu propio cliente OAuth de escritorio**; no se puede embeber uno en el binario:
  - Google Cloud → *Credentials* → *OAuth client ID* → **Desktop app**.
  - Microsoft Entra → *App registrations* → plataforma **Mobile and desktop** → redirect
    `http://localhost`.
- Presets incluidos: Google (`https://mail.google.com/`), Microsoft (`IMAP.AccessAsUser.All` +
  `SMTP.Send`) y **Otro** para cualquier proveedor con endpoints propios.

Verificado contra un proveedor falso (`scripts/fake-oauth.mjs`): el `code_challenge` viaja, el código
se canjea con el `code_verifier`, el access token entra al IMAP de pruebas por XOAUTH2, el refresh
funciona sin navegador al reiniciar y el envío SMTP sale autenticado con el mismo token.
**Microsoft no se probó contra un tenant real.**

## Primer arranque

![Bienvenida: elegir proveedor](docs/onboarding.png)

Un perfil vacío ya no cae directo en la demo: abre una bienvenida con el camino corto.

Al abrir, la app pasa por una **pantalla de carga** (logo, barra fina y "Abriendo tu correo…") hasta
que sabe si hay cuenta configurada y si ya pasaste por la bienvenida. Sin ese corte se veía la
bandeja de demo y un instante después la bienvenida encima; medido con CDP: el loader aparece a
~100 ms y en ese momento no hay ni bandeja ni onboarding pintados.

1. **Elegir proveedor** — Gmail y Outlook / Microsoft 365 (OAuth2), otro correo IMAP (Fastmail,
   iCloud, Proton, tu servidor) o servidor local para pruebas.
2. **Conectar** — la bienvenida tiene su **propio formulario**, adaptado al proveedor: Gmail/Outlook
   piden correo + Client ID (OAuth2, hosts fijos); otro IMAP pide correo, contraseña y servidor de
   salida; local viene precargado con `127.0.0.1`.
3. **Usar el correo** — al conectar se cargan buzones y bandeja; la bienvenida no vuelve a aparecer.

![Paso de Gmail: formulario propio](docs/onboarding-gmail.png)

El diálogo de cuenta del rail queda para **después**: ajustar hosts, puertos, endpoints OAuth o
cambiar de método. El alta no pasa por ahí.

"Explorar la demo" sigue a un click y la decisión se guarda en `settings.json` (`onboarded`), así que
no vuelve a preguntar. Quien ya tiene cuenta configurada nunca ve la bienvenida.

Verificado: Gmail muestra el formulario OAuth2 en la propia bienvenida (sin abrir el diálogo); "Cambiar"
vuelve a la grilla de proveedores; "Servidor local" precarga `127.0.0.1:1143` y conecta con la cuenta
de pruebas, que carga `Archive/INBOX/Sent`; y sin servidor, el error aparece **inline**
("El servidor rechazó la conexión") en vez de un banner global.

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
pnpm css:audit      # integridad del CSS contra el JSX
pnpm preview        # sirve out/renderer en http://127.0.0.1:4173 (revisar UI sin Electron)
node scripts/fake-imap.mjs   # IMAP 1143 + SMTP 1025, con XOAUTH2 (testuser/testpass | testtoken)
node scripts/fake-oauth.mjs  # proveedor OAuth2 falso en 9000 (para probar el flujo)
```

Herramientas de revisión visual (usan Edge o Chromium headless, no Electron):

```bash
node scripts/shoot.mjs http://127.0.0.1:4173/ .cache/inbox.png   # captura PNG
node scripts/shoot.mjs http://127.0.0.1:4173/ .cache/x.png "document.querySelector('.search').click()"
node scripts/probe.mjs "document.querySelector('.statusbar').getBoundingClientRect().width"
```

Los artefactos quedan en `release/`.

## Empaquetado

### Qué se puede construir desde Windows

| Comando | Resultado | Sirve para |
| --- | --- | --- |
| `pnpm build` | `out/` (main, preload, renderer) | desarrollo y empaquetado |
| `pnpm exec electron-builder --win dir` | `release/win-unpacked` | **probar el runtime empaquetado** |
| `pnpm exec electron-builder --linux dir` | `release/linux-unpacked` | validar el contenido del paquete |

El paquete de Linux quedó verificado así: `app.asar` de **12.55 MB / 855 archivos** con las
dependencias de runtime (`imapflow`, `mailparser`, `nodemailer` y sus transitivas), **13 fuentes
woff2 (4.1 MB)** incluidas las de Material Symbols, y `out/main`, `out/preload` y `out/renderer`
completos.

Y sobre la app ya empaquetada (`isPackaged: true`, cargando desde `app.asar`):

- Inter Variable, JetBrains Mono y Material Symbols **cargan desde el asar** (`document.fonts.check`).
- La **CSP se aplica de verdad**: un script inline y un `fetch` remoto fueron bloqueados.
- El **correo HTML renderiza** en su iframe (`frame-src 'self' about:`) con imágenes bloqueadas.
- IPC, modo demo y conexión IMAP funcionan igual que en desarrollo.
- Cero errores de consola propios.

### Por qué AppImage y .deb necesitan Linux

- **AppImage** arma el layout con symlinks; Windows devuelve `EPERM` sin modo desarrollador o
  privilegios de administrador.
- **deb** usa `fpm`, que no existe en Windows.

En Linux (o en CI, que es lo recomendado):

```bash
pnpm install
pnpm run build:linux     # → release/NamiO-0.1.0.AppImage + release/namio_0.1.0_amd64.deb
```

La CI está en [`.github/workflows/release-linux.yml`](.github/workflows/release-linux.yml): corre en
`ubuntu-latest` con Node 22 y pnpm 12, audita el CSS, compila y sube los dos instalables como
artefactos (se dispara con un tag `v*` o a mano).

### Marca y asociación de ventana

- `build/icon.png` (512×512) y `build/icon-1024.png`: el **mapache índigo** de la app, con fondo
  transparente y 4 % de respiro. Se regeneran desde `build/logo-source.png` con
  `python scripts/make-icons.py` (recorta el alfa del master y exporta 1024/512/256).
- `src/renderer/src/assets/logo.png` (256²) es la marca dentro de la interfaz: el rail la muestra a
  30 px junto al wordmark.
- `desktopName: namio.desktop` en `package.json` + `linux.syncDesktopName` en `electron-builder.yml`
  para que GNOME/KDE asocien la ventana con el lanzador.
- **Antes de publicar**: reemplazar `homepage` (hoy `https://example.com/namio`) y `maintainer`.

### La CSP en producción va por meta, no por cabecera

La app empaquetada carga `file://`, donde no existen cabeceras de respuesta: una CSP puesta con
`onHeadersReceived` **no se aplica**. Por eso la política viaja como `<meta http-equiv>` inyectado
solo en build (`electron.vite.config.ts`); en desarrollo la relaja Vite para el HMR.

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
| M2: HTML sanitizado en iframe, imágenes bloqueadas y links externos | ✅ |
| M3: caché SQLite, sync incremental y modo offline | ✅ |
| Reapertura con el servidor caído mostrando la caché | ✅ |
| M4: envío SMTP, copia en Enviados, cola con reintentos | ✅ |
| Archivar y eliminar aplicados en el servidor | ✅ |
| M5: búsqueda FTS5 sobre la caché con fragmentos | ✅ |
| Leído/no leído, responder con cita y adjuntos descargables | ✅ |
| Adjuntos al enviar (multipart) y borrador persistido | ✅ |
| OAuth2 (PKCE + loopback) con XOAUTH2 en IMAP y SMTP | ✅ |
| Bienvenida guiada: proveedor → conexión → bandeja | ✅ |
| Icono, metadatos y paquete linux-unpacked (12.6 MB de asar) | ✅ |
| CSP activa en la app empaquetada | ✅ |

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
| ✅ M2 | Visor de mensaje: MIME, HTML sanitizado, adjuntos | Se abre un correo con imágenes y links |
| ✅ M3 | Caché SQLite + sync incremental + offline | Sin red, la app muestra todo lo ya sincronizado |
| ✅ M4 | Envío SMTP + cola de salida + archivar/eliminar | Me envío un correo y me llega |
| ✅ M5 | Búsqueda FTS5 sobre la caché | Encuentro un correo por una palabra del cuerpo |
| M6 | Reglas y filtros locales | Un remitente molesto se archiva solo |
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

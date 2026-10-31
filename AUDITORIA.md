# Auditoría de NamiO 1.0.0-rc.5

**Fecha:** 31 de octubre de 2026 · **Alcance:** código de `src/`, pruebas, CI, empaquetado y documentación.
**Método:** lectura completa de los módulos principales, ejecución de typecheck/build/suite/CSS audit, medición de consultas SQLite con `node:sqlite` y revisión de los cambios recientes (`rc.1` → `rc.5`).
**Naturaleza:** auditoría estática y de verificación local. No sustituye pruebas con proveedores IMAP/SMTP reales, instalación en escritorio ni una auditoría de penetración.

---

## Veredicto

El proyecto está en mucho mejor estado de lo que sugiere su tamaño: **compila, pasa typecheck, pasan las 64 pruebas de regresión, la auditoría de CSS no reporta errores y el i18n tiene paridad exacta (614/614)**. La seguridad de base de Electron está bien resuelta (sandbox, contextIsolation, preload mínimo, DOMPurify + iframe sin scripts, CSP, TLS verificado, SQL parametrizado).

Los riesgos que quedan para declarar 1.0 no son de "arranque", sino de **comportamiento bajo condiciones reales**:

| Prioridad | Tema | Consecuencia |
|---|---|---|
| **P0** | Cola de salida: `attempts` cuenta invocaciones | Un correo encolado sin red pasa a `failed` en ~5 minutos |
| **P0** | Índice FTS: borrado por columnas no indexadas | ~1 s de bloqueo del hilo principal por refresco de 50 sobres con 20.000 mensajes |
| **P0** | Cambio de cuenta con operaciones en cola | Riesgo de mover/borrar el mensaje equivocado en la cuenta nueva |
| **P0** | Frontera de confianza `settings` + navegación `file://` | El renderer recibe credenciales cifradas y secretos; un HTML local puede heredar `window.api` |
| **P0** | Auto-update sin firma y `rc` publicada como estable | Actualizaciones y releases con integridad/ canal incorrectos |
| **P1** | Rendimiento del renderer y sync | Lista O(n²), sin virtualización, body completo en memoria, reglas sobre histórico |
| **P1** | Accesibilidad de diálogos y lector | Foco escapa de modales; *summary* del lector inutilizable con teclado |
| **P2** | Deuda de pruebas, lint, releases y CSS/i18n | Regresiones que la suite actual no puede detectar |

**Conteo:** 5 hallazgos P0, 11 P1 y 9 P2. Los P0 son acotados y en su mayoría se corrigen en días, no semanas.

### Estado de correcciones (31 de octubre de 2026)

- ✅ **P0 #1 — cola de salida:** los errores transitorios (red/offline) ya no consumen intentos ni marcan la fila como `failed`; `retryOutbox` reinicia el ciclo. Cubierto por `scripts/test-outbox-retry.cjs`.
- ✅ **P0 #2 — índice FTS:** identificadores estables (`search_ids`), reindexado solo cuando cambia el texto, borrado por id y limpieza de huérfanos. Medición local (20.000 mensajes): 10 refrescos de 50 sobres bajan de ~8,8 s a **7 ms**; guardar 50 cuerpos, de ~0,9 s a **49 ms**. Cubierto por `scripts/test-search-index.cjs` y la suite completa.
- ✅ **P0 #3 — identidad de cuenta en la cola:** cada trabajo guarda `accountId` y `UIDVALIDITY`; la sesión IMAP recuerda su cuenta; cambiar de cuenta (activar, seleccionar) cierra la sesión y reapunta la caché dentro de la cadena serial. Cubierto por `scripts/test-outbox-identity.cjs`, `test-move-message.cjs` y la suite completa.
- ✅ **P0 #4 — frontera de confianza:** `settings:get` proyecta solo ajustes públicos; `settings:set` usa lista blanca y validación de tipos; la navegación `file://` queda restringida a la página de la app y se bloquea el drop de archivos en la ventana y en el iframe del correo. Cubierto por `scripts/test-settings-allowlist.cjs`, `scripts/test-navigation-guard.cjs` y la suite completa.
- ✅ **P1 #6 — conversaciones:** `visible` deduplica por `messageIds`; `j`/`k`, posición, “1 de N” y selección masiva trabajan por hilo, y las acciones se expanden a todos los mensajes del grupo. Cubierto por `scripts/test-conversation-navigation.cjs`, `test-list-filters`, `test-multi-select` y `test-conversation`.
- 🟡 **P1 #13 — rendimiento de la lista:** se eliminó el O(n²) por fila con mapas de conversación/miembros/adjuntos, se memoizaron los formateadores `Intl` y se usa `content-visibility: auto` para filas fuera de pantalla. **Falta** virtualización real y un tope/ventana para `listLimit` si se quieren miles de filas simultáneas.
- ✅ **P1 #7 — topes de memoria:** mensajes de 50 MB, cuerpos offline de 30 MB, adjuntos de 25 MB y 50 MB por envío; los streams se cortan al superar el límite, los adjuntos se validan antes de copiarlos a SQLite y la descarga offline omite mensajes enormes. Cubierto por `scripts/test-memory-limits.cjs` y la suite completa.
- 🟡 **P0 #5 — release:** los tags `-rc` se publican como *prerelease*, los workflows ejecutan pruebas y adjuntan `SHA256SUMS`, y el updater distingue candidate/estable. **Falta** el certificado de firma y `publisherName` en Windows para que `electron-updater` verifique el editor; sin esos secretos el instalador sigue sin firma.
- ⏳ Pendientes: firma de Windows, virtualización real de la lista, extracción de adjuntos por parte y P2 de accesibilidad/documentación.

---

## Línea base verificada

| Comprobación | Resultado |
|---|---|
| `pnpm run typecheck` | ✅ Sin errores (node + web) |
| `pnpm run build` | ✅ Compila; renderer 1,09 MB JS + 142 KB CSS; editor y PDF en chunks lazy |
| `node scripts/test.mjs` | ✅ 71/71 archivos, 0 fallos (~60 s) |
| `node scripts/css-audit.mjs` | ✅ Sin variables indefinidas, clases rotas ni URLs rotas |
| Paridad i18n `es`/`en` | ✅ 614/614 claves |
| Pruebas de interfaz Electron (`--ui`) | ⚠️ No ejecutadas en esta auditoría (requieren Electron/entorno gráfico) |
| IMAP/SMTP/instaladores reales | ⚠️ No verificados aquí |

> **Matiz importante sobre las pruebas:** `node --test` cuenta **1 caso por archivo** porque los scripts usan aserciones de nivel superior, no `test()/describe()`. "71 pruebas" significa 71 archivos con muchos asserts, no 71 casos aislados; un assert fallido aborta el resto del archivo.

---

## P0 — resolver antes de 1.0

### 1. La cola de salida marca como `failed` correos que solo esperaban red

**Dónde:** [mail.ts:20](src/main/mail.ts#L20), [mail.ts:89-96](src/main/mail.ts#L89-L96), [mail.ts:262-289](src/main/mail.ts#L262-L289), [mail.ts:363-367](src/main/mail.ts#L363-L367).

`registerFailure` suma 1 a `attempts` **cada vez que `processOutbox` intenta la fila**, y `processOutbox` se dispara desde ~10 sitios (envío, guardado de borrador, reglas, sincronización, IPC) más un temporizador cada 60 s ([index.ts:190-192](src/main/index.ts#L190-L192)). Sin red, enviar un correo y guardar el borrador cuatro veces deja `attempts = 5` → `failed`; el correo **no se envía solo nunca**. Además `retryOutbox` no reinicia `attempts`, así que el primer fallo tras reintentar lo devuelve a `failed`.

**Mejora:** separar intentos reales de intentos de proceso. Persistir `next_attempt_at` con backoff exponencial + jitter, contar solo fallos de red por pasada, reiniciar `attempts` en `retryOutbox` (como ya hace `drafts.ts:21`) y distinguir error permanente (`auth`, 5xx) de reintentable.

### 2. El índice FTS bloquea el hilo principal en la ruta más caliente

**Dónde:** [db.ts:149-156](src/main/db.ts#L149-L156), [db.ts:710-725](src/main/db.ts#L710-L725), [db.ts:329](src/main/db.ts#L329).

`search` es FTS5 con `mailbox` y `uid` como `UNINDEXED`. `reindexMessage` hace `DELETE FROM search WHERE mailbox = ? AND uid = ?`, que fuerza un **escaneo completo del índice**; después inserta. `upsertEnvelopes` llama a `reindexMessage` por **cada sobre**, incluidos los que ya existían y no cambiaron. Medición propia con 20.000 filas: **50 borrados FTS ≈ 0,9 s**; con cuerpos de ~1 KB, una medición independiente da ~40 ms por borrado. Todo ocurre en el proceso principal con `DatabaseSync`, así que bloquea IPC y UI.

**Mejora (alto impacto y bajo coste):**
1. Reindexar solo los UID nuevos (`previos` ya se calcula) y cuando cambie asunto/remitente/cuerpo, no en cada upsert.
2. Migrar a FTS5 `content='messages'` con `content_rowid`, o mantener una tabla `search_key(rowid, mailbox, uid)` indexada y borrar por `rowid`.
3. Borrar filas de `search` en la misma transacción que `clearMailbox`, `pruneExcept` y `deleteMessageRow` (hoy quedan huérfanas y el índice crece sin límite).

### 3. Cambio de cuenta mientras la cola serial tiene operaciones pendientes

**Dónde:** [imap.ts:1177-1193](src/main/imap.ts#L1177-L1193), [imap.ts:1186](src/main/imap.ts#L1186), [mail.ts:209-259](src/main/mail.ts#L209-L259), [imap.ts:993-1018](src/main/imap.ts#L993-L1018).

Las tareas `delete` y `seen` de la cola **no llevan `accountId` ni `uidValidity`** (solo `move` lo hace, [mail.ts:331](src/main/mail.ts#L331)), y `deleteMessage` no comprueba la identidad de la carpeta. La cuenta se valida antes y después de `runOne`, pero `selectAccount` cambia el `activeAccount` y luego ejecuta `openAccountCache(id)` **fuera de la cadena serial**. En una ventana estrecha —tarea encolada + cambio de cuenta— `ensureClient()` conecta la cuenta nueva y el mismo `(INBOX, uid)` se mueve o borra allí, incluida su caché. Es un fallo de aislamiento entre cuentas, no solo de rendimiento.

**Mejora:** persistir `{ accountId, uidValidity }` en cada trabajo de la cola y revalidarlos **dentro** de la tarea serial justo antes del comando IMAP; mover `openAccountCache` dentro de la cadena; pasar `generation` a `syncMessages`, `syncInbox` y `replaceMailboxes`, que hoy no lo comprueban.

### 4. Frontera de confianza del renderer: `settings` y navegación local

**Dónde:** [ipc.ts:116](src/main/ipc.ts#L116), [ipc.ts:118-129](src/main/ipc.ts#L118-L129), [settings.ts:54-64](src/main/settings.ts#L54-L64), [index.ts:90-97](src/main/index.ts#L90-L97).

Dos problemas que se suman:

- `settings:get` devuelve `readSettings()` completo (tipo real `StoredSettings`, declarado como `Partial<AppSettings>`): el renderer recibe `accounts[].secret`, `refreshToken` (cifrados, pero innecesarios) y `oauth.clientSecret` **en claro**. `settings:set` hace merge superficial de cualquier clave: un renderer comprometido puede escribir `accounts`, `activeAccount` o `mailNotificationCursors`, borrando cuentas o apuntando la cuenta activa a una inyectada.
- `will-navigate` acepta **cualquier** `file://` y no hay handler `dragover/drop`. Si el usuario arrastra un HTML local sobre la ventana, Chromium navega a `file://…`, el preload se vuelve a ejecutar y esa página obtiene `window.api` completo, sin la CSP del bundle. Requiere interacción del usuario, pero convierte un archivo descargado en una página con acceso a correo, envío y cuentas.

**Mejora:** proyectar solo claves de `AppSettings` en get/set (lista blanca explícita, rechazar `accounts`, `activeAccount`, cursores y secretos); restringir `will-navigate` a `pathToFileURL(index.html)` (y a `devUrl` en desarrollo); añadir `dragover/drop preventDefault` en `main.tsx` o implementar drop-to-attach con `webUtils.getPathForFile`; envolver los handlers IPC con validación de `senderFrame.url`.

### 5. Actualizaciones sin firma y release candidate publicada como estable

**Dónde:** [electron-builder.yml:50-57](electron-builder.yml#L50-L57), [updater.ts:31-44](src/main/updater.ts#L31-L44), [.github/workflows/release-windows.yml](.github/workflows/release-windows.yml), [.github/workflows/release-linux.yml](.github/workflows/release-linux.yml).

No hay `CSC_LINK`/certificado ni `publisherName`. Sin `publisherName` en `app-update.yml`, `electron-updater` no verifica firma: solo compara el `sha512` de `latest.yml`, servido desde la misma Release de GitHub. Quien comprometa el repo/cuenta o un paso del build obtiene ejecución en los clientes Windows al cerrar la app. Además, `softprops/action-gh-release` no define `prerelease`, así que un tag `v1.0.0-rc.5` se publica como **Latest** y puede ofrecerse por el canal estable.

**Mejora:** firmar NSIS en CI (`CSC_LINK`, `CSC_KEY_PASSWORD`, `win.publisherName`), fijar verificación de firma, marcar `prerelease: contains(ref_name, '-rc.')` y separar canales `latest`/`beta` en `electron-builder.yml`. Mientras no haya firma, `autoDownload=false` e instalación manual explícita.

---

## P1 — alto

### 6. Conversaciones duplicadas en el estado de `App` (no solo en la lista)

**Dónde:** [live.ts:94-105](src/renderer/src/data/live.ts#L94-L105), [ThreadList.tsx:130-136](src/renderer/src/components/ThreadList.tsx#L130-L136), [App.tsx:308](src/renderer/src/App.tsx#L308), [App.tsx:852-855](src/renderer/src/App.tsx#L852-L855), [App.tsx:1439](src/renderer/src/App.tsx#L1439), [App.tsx:1489-1490](src/renderer/src/App.tsx#L1489-L1490).

`envelopesToThreads` devuelve **un `Thread` por sobre**, todos con el mismo `messageIds`. `ThreadList` deduplica solo para pintar, pero `visible` sigue con duplicados y alimenta `step()` (j/k), `position/total` del lector y "seleccionar todo". Con un hilo de 3 mensajes, j/k avanzan a filas invisibles (parece que no responde), el lector anuncia "1 de 3" y la selección masiva cuenta mensajes, no conversaciones.

**Mejora:** deduplicar `visible` por grupo de `messageIds` (una entrada por conversación) y resolver `members` con un `Map` precalculado; usar esa lista única para navegación, contadores y selección.

### 7. Mensajes y adjuntos grandes sin tope de memoria

**Dónde:** [imap.ts:701-713](src/main/imap.ts#L701-L713), [imap.ts:916-948](src/main/imap.ts#L916-L948), [attachmentPreview.ts:6](src/main/attachmentPreview.ts#L6), [mail.ts:106-132](src/main/mail.ts#L106-L132).

Abrir un correo descarga el RFC822 completo y lo concatena en memoria antes de parsear; descargar un adjunto repite la descarga completa y parsea **todos** los adjuntos para devolver uno; el tope de 20 MB se aplica después de tenerlo todo en memoria; al adjuntar, el archivo entero se copia a un BLOB de SQLite sin límite. Un remitente puede provocar OOM del proceso principal o llenar el disco.

**Mejora:** comprobar `envelope.size`/`part.size` antes de descargar, extraer solo la parte con `client.download(uid, part)`, tope explícito en `saveAttachment`/`registerAttachments`, validar `index` contra la lista real y limitar el tamaño por adjunto y por buzón offline.

### 8. Reglas sobre correo histórico, cobertura parcial y sin transacción

**Dónde:** [imap.ts:381-385](src/main/imap.ts#L381-L385), [imap.ts:449-452](src/main/imap.ts#L449-L452), [rules.ts:85-120](src/main/rules.ts#L85-L120), [db.ts:981-997](src/main/db.ts#L981-L997).

El comentario dice que el relleno histórico no cuenta como nuevo, pero la rama `fullSync` empuja **todos** los UID insertados a `nuevos`, y `applyRulesToNew` los evalúa: al cambiar UIDVALIDITY, una regla "de GitHub → archivar" puede mover en masa correo antiguo. Tampoco se excluyen Papelera/Spam/Borradores. "Aplicar a los existentes" solo mira los 5.000 más recientes (`LIMIT 5000`), hace dos escrituras por coincidencia sin transacción y luego ejecuta una operación IMAP por mensaje dentro del handler.

**Mejora:** no pasar a reglas los UID de un `fullSync`; excluir `\Trash`, `\Junk` y `\Drafts`; paginar con cursor y devolver progreso; encolar y actualizar hits en una transacción; agrupar por carpeta/regla en rangos de UID.

### 9. Envío SMTP sin idempotencia → duplicados

**Dónde:** [mail.ts:134-207](src/main/mail.ts#L134-L207), [mail.ts:209-259](src/main/mail.ts#L209-L259).

Si el servidor acepta el mensaje y se pierde la respuesta (timeout de socket) o falla el borrado de la fila tras el envío, la fila sigue `queued` y se reenvía. No hay `Message-ID` estable persistido ni comprobación en Enviados antes de reintentar.

**Mejora:** generar el `Message-ID` al encolar, persistirlo como cabecera y, en el reintento, comprobar Enviados o pasar a un estado `sent-unknown` con confirmación manual.

### 10. `MessageAttachment.index` tiene dos semánticas

**Dónde:** [imap.ts:668-678](src/main/imap.ts#L668-L678), [imap.ts:693-697](src/main/imap.ts#L693-L697), [imap.ts:730-735](src/main/imap.ts#L730-L735), [imap.ts:936](src/main/imap.ts#L936).

`cacheMessageBody` guarda adjuntos recorriendo BODYSTRUCTURE (excluye partes `related`); `fetchMessage`/`readAttachment` indexan `parsed.attachments` de mailparser, que incluye imágenes inline. Según cómo se cacheó el cuerpo, guardar/ver el adjunto `index` puede descargar **otra parte** (por ejemplo, el logo inline en vez del PDF).

**Mejora:** persistir la sección IMAP (`part`) como identificador y descargar con `client.download(uid, part)`; no depender del índice de mailparser.

### 11. TLS y errores de autenticación se presentan como "sin conexión"

**Dónde:** [imap.ts:103-105](src/main/imap.ts#L103-L105), [imap.ts:610-617](src/main/imap.ts#L610-L617), [imap.ts:646-651](src/main/imap.ts#L646-L651), [imap.ts:880-891](src/main/imap.ts#L880-L891).

`isOfflineError` incluye `tls`, así que un certificado inválido o caducado se convierte en modo offline y se reintenta para siempre en lugar de mostrar el aviso de certificado; el `catch` del sync de fondo marca `offline = true` ante **cualquier** error, incluso `auth`. El CHANGELOG rc.3 promete lo contrario ("los errores de autenticación y certificados conservan su aviso"). `syncInbox` además traga el error sin avisar.

**Mejora:** separar `tls`/`auth` de los errores de red; marcar `offline` solo con `isOfflineError`; propagar `auth`/`tls` a la UI; añadir backoff exponencial con jitter y reset al éxito en lugar de reconectar cada 60 s.

### 12. Sincronización: la guarda de `ensureFullSync` es insatisfacible y hay doble descarga

**Dónde:** [imap.ts:581-589](src/main/imap.ts#L581-L589), [imap.ts:412](src/main/imap.ts#L412), [imap.ts:384-390](src/main/imap.ts#L384-L390), [imap.ts:415-418](src/main/imap.ts#L415-L418), [imap.ts:646-651](src/main/imap.ts#L646-L651).

Con `offlineDownload` desactivado (valor por defecto), `countBodies >= countMessages` nunca se cumple porque los cuerpos se bajan bajo demanda. Resultado: **cada sincronización** lanza `fullSyncMailbox`, que hace `SEARCH ALL` del buzón y recorre todos los UID en lotes de 100 para no hacer nada, y vuelve a salir en la fase de cuerpos. Además `syncMessages` pide dos veces la misma ventana reciente (una para novedades y otra para refrescar flags) y parsea cabeceras con `simpleParser` por mensaje.

**Mejora:** persistir un flag de "cabeceras completas" en `meta`; condicionar la fase de cuerpos a `offlineDownload`; coalescer sincronizaciones por carpeta con un `Set<path>`; refrescar flags con un FETCH solo de `flags`; evitar la segunda descarga cuando los rangos coinciden.

### 13. Renderer: lista O(n²), sin virtualización y formateadores por celda

**Dónde:** [ThreadList.tsx:195-204](src/renderer/src/components/ThreadList.tsx#L195-L204), [App.tsx:580-591](src/renderer/src/App.tsx#L580-L591), [dates.ts:10-37](src/renderer/src/lib/dates.ts#L10-L37).

Por cada fila se hace `allThreads.filter(...)`, `sort` y `allThreads.some(...)`: O(n²) por render. `listLimit` sube +100 sin tope al hacer scroll, así que el DOM crece indefinidamente. Cada celda crea nuevos `Intl.DateTimeFormat`/`RelativeTimeFormat` y usa `Date.now()` en el render. Con 1.000 hilos cargados, cada pintado (incluido el tick de 30 s) recorre ~1 millón de comparaciones.

**Mejora:** `useMemo` con `Map<uid, thread>` y `Map<conversación, miembros>`; virtualizar la lista o fijar una ventana de paginación; memoizar formateadores por región/opciones y calcular `now` una vez por render.

### 14. Accesibilidad: foco que escapa y lector con control inaccesible

**Dónde:** [AccountDialog.tsx:240](src/renderer/src/components/AccountDialog.tsx#L240), [ComposeOverlay.tsx:258](src/renderer/src/components/ComposeOverlay.tsx#L258), [Settings.tsx:630](src/renderer/src/components/Settings.tsx#L630), [ThreadPane.tsx:270-271](src/renderer/src/components/ThreadPane.tsx#L270-L271), [tokens.css:123-130](src/renderer/src/styles/tokens.css#L123-L130).

`AccountDialog`, el compositor y el diálogo de remapeo usan `<div role="dialog" aria-modal="true">` sin trampa de foco ni restauración: Tab escapa al fondo. El resto ya usa `<dialog>.showModal()`. En el lector, el `<summary>` lleva `tabIndex={-1}` y `preventDefault`, con un `<button>` dentro: el control nativo de expandir queda inaccesible y hay interactivos anidados. Además todos los scrollbars están ocultos (`* { scrollbar-width: none }`), lo que quita la única pista de posición en listas largas.

**Mejora:** migrar esos tres diálogos a `<dialog>`/`showModal` o a un hook compartido de focus-trap; reestructurar el encabezado del mensaje con un botón de divulgación fuera del `<summary>`; valorar scrollbars finas visibles o un indicador de posición.

### 15. Secretos: backend `basic_text`, `clientSecret` en claro y secreto de Google versionado

**Dónde:** [settings.ts:72-76](src/main/settings.ts#L72-L76), [imap.ts:1269](src/main/imap.ts#L1269), [imap.ts:1082](src/main/imap.ts#L1082), [googleOAuth.ts:2](src/main/googleOAuth.ts#L2), [oauth.ts:236-246](src/main/oauth.ts#L236-L246).

- `encryptSecret` solo consulta `isAsyncEncryptionAvailable()`. En Linux sin keyring, Electron puede seleccionar el backend `basic_text` (clave fija de Chromium) y seguir reportando cifrado disponible; las contraseñas y refresh tokens quedarían recuperables desde `settings.json`. Hay que comprobar `safeStorage.getSelectedStorageBackend()` y no persistir si es `basic_text`/`unknown` (mostrarlo en la UI).
- El `oauth.clientSecret` se guarda **sin cifrar** en `StoredAccount` y se devuelve al renderer en `AccountState`, mientras contraseña y refresh token sí se cifran.
- El secreto de cliente de Google está embebido y **versionado en un repo público** (`GOCSPX-…`). Para clientes instalados no es confidencial por diseño, pero conviene rotarlo/confirmar el uso y no depender de él como si lo fuera.
- Sin *single-flight* en `getAccessToken`: dos refrescos concurrentes (IMAP + SMTP) con rotación de Microsoft pueden dejar inválido el token recién guardado.

**Mejora:** validar el backend de `safeStorage`; cifrar o eliminar `clientSecret` del contrato (PKCE lo hace innecesario para clientes públicos); memoizar la promesa de refresh por clave e invalidar ante `invalid_grant`; documentar el secreto de Google o retirarlo.

### 16. DevTools y aceleradores de menú activos en producción

**Dónde:** [index.ts:51-59](src/main/index.ts#L51-L59), [index.ts:73](src/main/index.ts#L73).

No hay `devTools: false` ni `Menu.setApplicationMenu(...)`; el menú por defecto de Electron expone `Ctrl+Shift+I` (DevTools) y `Ctrl+Shift+R` (recarga forzada). El bloqueo de `Ctrl+R` no los cubre. `setIgnoreMenuShortcuts` solo se activa para Ctrl+A. En la app empaquetada se puede abrir DevTools y ejecutar JS en el renderer.

**Mejora:** `devTools: isDev`, menú propio (o `null`) en producción y `setIgnoreMenuShortcuts(true)`; mantener los atajos de zoom propios.

---

## P2 — medio y bajo

### 17. Ciclo de vida de la caché y `settings.json`

**Dónde:** [index.ts:150-154](src/main/index.ts#L150-L154), [db.ts:57-60](src/main/db.ts#L57-L60), [settings.ts:41-59](src/main/settings.ts#L41-L59), [db.ts:1051-1079](src/main/db.ts#L1051-L1079).

`initCache` no se espera antes de registrar IPC ni de crear la ventana: una llamada que gane la carrera responde "La caché no está inicializada". `readSettings` devuelve `{}` ante un JSON corrupto y la siguiente escritura sobrescribe cuentas y preferencias sin avisar. `clearAccountCache` abre una segunda conexión al mismo archivo (incluida la cuenta activa), hace `BEGIN IMMEDIATE` y `VACUUM` con la conexión viva, sin `busy_timeout`: puede fallar con `SQLITE_BUSY` de forma silenciosa.

**Mejora:** `await initCache(...)` en `whenReady`; apartar `settings.json` corrupto a `.bak` y no sobrescribir hasta confirmar; `PRAGMA busy_timeout = 5000` en cada apertura; reutilizar el handle cuando la cuenta ya está abierta; migraciones con `PRAGMA user_version`.

### 18. Validación IPC incompleta

**Dónde:** [ipc.ts:255-271](src/main/ipc.ts#L255-L271), [ipc.ts:339-350](src/main/ipc.ts#L339-L350), [ipc.ts:358](src/main/ipc.ts#L358), [ipc.ts:372-373](src/main/ipc.ts#L372-L373), [ipc.ts:412](src/main/ipc.ts#L412).

`messagesList` valida `limit >= 1` pero no un máximo (la búsqueda sí limita a 100); `messageGet/Flag/Seen/Move/Archive`, `attachmentSave`, `draftOpen`, `outboxRetry/Cancel` y `rulesDelete` no validan tipo/rango. No hay inyección IMAP (imapflow valida los sequence sets) ni SQL, pero sí se puede operar sobre cualquier buzón/uid y provocar errores inconsistentes o consumo de memoria. Tampoco existe un tope duro para `listLimit`, que crece con el scroll.

**Mejora:** helper `assertUid/assertMailbox`, tope duro (p. ej. 500) y trocear los `IN (...)`/`NOT IN (...)` para no superar las 32.766 variables SQL; tipar los handlers con un envoltorio `handle<T>()`.

### 19. Pruebas, lint y release

**Dónde:** [scripts/test.mjs](scripts/test.mjs), [.github/workflows/ci-linux.yml](.github/workflows/ci-linux.yml), [.github/workflows/release-linux.yml](.github/workflows/release-linux.yml), [.github/workflows/release-windows.yml](.github/workflows/release-windows.yml), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

- No hay lint (ESLint/Biome/Prettier) ni step en CI; `react-hooks/exhaustive-deps` habría señalado el listener global sin dependencias y `userNavigated` sin lecturas.
- La capa IPC no se prueba: solo `settings:set` se extrae y ejecuta; el resto de handlers se sustituye por mocks de texto. Un rename de canal o un cambio de payload no lo detecta nada.
- No hay cobertura ni umbral; `rules.ts` no tiene prueba dedicada.
- Las pruebas de UI usan timers reales, polling y `/tmp` (no `os.tmpdir()`), y el contraste solo se comprueba en tema claro.
- Los workflows de release **no ejecutan `pnpm test`**; solo `build` + empaquetado. Un tag puede publicar con regresiones.
- No hay verificación de artefactos (`SHA256SUMS`, `asar-inspect`, `smoke`) en CI, aunque el checklist afirma haberlo hecho a mano.
- Versión/tags desalineados: `package.json` = `1.0.0-rc.5`, el último tag es `v1.0.0-rc.1`; rc.2–rc.5 no tienen tag y hay tags 0.4.2/0.4.5/0.4.6 sin entrada clara en el CHANGELOG. El checklist cita `release/1.0.0-rc.5/` y `release/rc-validation/`, que no existen en el árbol.

**Mejora:** ESLint + `eslint-plugin-react-hooks` obligatorio; tests de contrato de IPC con el preload real; cobertura con umbral; job `verify` reutilizable como `needs` de ambos release; `prerelease` para `-rc`; checksums y smoke en CI; etiquetar lo publicado o corregir el checklist.

### 20. i18n: plurales, atajos con Shift y claves muertas

**Dónde:** [es.ts:128](src/renderer/src/i18n/es.ts#L128), [es.ts:173](src/renderer/src/i18n/es.ts#L173), [es.ts:260](src/renderer/src/i18n/es.ts#L260), [shortcuts.ts:61-71](src/renderer/src/settings/shortcuts.ts#L61-L71).

`search.shown` produce "1 resultados mostrados" y `list.liveQueue`/`palette.indexed` tienen el mismo problema. `comboFromEvent` nunca emite `shift`, pero `formatCombo` y `normalizeBindings` lo aceptan: un atajo con Shift no se puede disparar y al remapear se guarda sin Shift. Hay ~24 claves sin referencia (sobre todo `topbar.*` y `status.*`) y el panel de demostración del compositor tiene copy en inglés fijo ("Fast Lane 4.5", "Tomorrow at…", "Alex Rivera") en una app con español como idioma principal.

**Mejora:** variantes singular/plural o `Intl.PluralRules`; incluir Shift en `comboFromEvent` o rechazarlo en la UI; limpiar claves y mover el copy de demo a i18n o aislarlo tras un flag.

### 21. CSS y peso del paquete

**Dónde:** [tokens.css](src/renderer/src/styles/tokens.css), [app.css](src/renderer/src/styles/app.css), [main.tsx:7](src/renderer/src/main.tsx#L7), [Settings.tsx:3](src/renderer/src/components/Settings.tsx#L3).

La auditoría reporta **8 variables y 38 clases sin uso** (`.t-headline-lg`, `.kbd--quiet`, `.chip--tertiary`, `.btn--quiet`…), 5 bloques `prefers-reduced-motion` y breakpoints repetidos (3×520, 2×960, además de 720/800/1080/1280/1520/1560). Hay colores fuera de token (`#555555` en `ThreadPane`). La fuente Material Symbols pesa **3,9 MB** y se carga siempre; `naomi.png` pesa 670 KB y se importa de forma eager en Settings aunque solo se use en el easter egg; el CSS inicial es de 142 KB.

**Mejora:** limpiar variables/clases y unificar breakpoints y bloques de movimiento; sustituir el color hardcodeado por un token; subsetear la fuente de iconos a las ligaduras usadas (o pasar a SVG por icono); cargar `naomi.png` con `import()` al abrir la dedicatoria; dividir `app.css` por secciones si se mantiene el crecimiento.

### 22. Deriva de documentación

**Dónde:** [README.md:6](README.md#L6), [README.md:50](README.md#L50), [DESIGN.md:41-46](DESIGN.md#L41-L46), [tokens.css:155](src/renderer/src/styles/tokens.css#L155).

El README sigue diciendo "interfaz oscura" y "hora de 24 horas" fija, cuando la app ya tiene tema claro/oscuro/sistema y formato 12/24 h configurable. DESIGN.md define headline 26/34, el token `.t-headline-lg` usa 28/36 (y no se usa) y `app.css` repite 26/34 a mano. Las 21 capturas de `docs/` no se referencian desde el README.

**Mejora:** actualizar README (tema y formato horario), unificar la escala tipográfica en tokens y enlazar o retirar las capturas.

---

## Mejoras rápidas (1–2 días, alto retorno)

1. **Reindexar solo UID nuevos** en `upsertEnvelopes` y borrar FTS por `rowid`: elimina ~1 s de bloqueo por refresco y minutos en sync completa.
2. **Reiniciar `attempts` en `retryOutbox`** y contar solo intentos de red: evita correos "fallidos" que solo esperaban conexión.
3. **Deduplicar `visible` por conversación** y usarla para j/k, posición y selección: arregla navegación y contadores.
4. **Lista blanca en `settings:get/set`**: deja de enviar secretos al renderer y de permitir que sobrescriba cuentas.
5. **Bloquear navegación `file://` + `dragover/drop`**: cierra la cadena de HTML local con `window.api`.
6. **`devTools: false`, menú propio y `setIgnoreMenuShortcuts(true)`** en producción.
7. **Sacar `tls`/`auth` de "offline"** y mostrar el aviso correcto.
8. **Tope de tamaño antes de descargar** mensajes/adjuntos y descarga por `part`.
9. **`prerelease: true` para `-rc`** y firma del instalador cuando haya certificado.
10. **Limpiar 8 variables, 38 clases y ~24 claves i18n**; corregir plurales y Shift.
11. **Migrar los tres diálogos a `<dialog>`** y arreglar el `<summary>` del lector.
12. **Actualizar README/DESIGN** y el checklist de release.

---

## Lo que está bien (verificado)

- **Aislamiento de Electron:** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`; preload mínimo que solo expone `invoke`/`on` por canal; sin `webview` ni `dangerouslySetInnerHTML`.
- **Correo hostil:** DOMPurify + `DOMParser` + iframe `srcDoc` con `sandbox="allow-same-origin"` **sin** `allow-scripts`, `referrerPolicy="no-referrer"`, CSP interna `default-src 'none'`, bloqueo de `meta/base/link/form`, `srcset` eliminado, imágenes remotas bloqueadas por defecto y siempre en Spam.
- **Credenciales y red:** TLS verificado en IMAP/SMTP; access token solo en memoria; OAuth con PKCE S256 y `state` de 128 bits; sin fallback a contraseña en claro.
- **Acciones destructivas:** confirmación nativa en el proceso principal (borrar, vaciar, desvincular, limpiar caché).
- **Integridad IMAP:** `uidValidity` y capacidades `UIDPLUS`/`MOVE` antes de mover/borrar/actualizar borradores; SQL 100 % parametrizado; `toFtsQuery` neutraliza operadores FTS5; caché por cuenta con id saneado.
- **Diseño:** tokens con `light-dark()`, cero overrides de tema oscuro duplicados, 0 `!important` en `app.css`, 1.161 usos de `var()`, contraste AA en la muestra revisada.
- **i18n y pruebas:** 614/614 claves, `Dictionary` fuerza paridad; la suite cubre búsqueda, selección, borradores, offline, reconexión, OAuth, notificaciones y rendimiento de arranque; CI ejecuta CSS audit, build y UI en cada push.

---

## Plan sugerido

**Semana 1 — P0:** cola (`attempts`/backoff), FTS por `rowid`, identidad de cuenta en la cola, lista blanca de settings + navegación, firma/prerelease.

**Semana 2 — P1:** deduplicación de conversaciones, topes de memoria, reglas históricas, idempotencia de envío, índice de adjuntos, clasificación de errores, rendimiento del renderer y accesibilidad.

**Semana 3 — P2:** lint/cobertura/tests de IPC, release con verificación de artefactos, limpieza de CSS/i18n, documentación y checklist.

---

## Anexo: comandos ejecutados

```text
pnpm run typecheck        → OK
pnpm run build            → OK (renderer 1,09 MB JS; 142 KB CSS)
node scripts/test.mjs     → 64/64 archivos, 0 fallos (~85 s)
node scripts/css-audit.mjs→ OK; 8 variables y 38 clases sin uso
```

Medición FTS propia (20.000 filas, `node:sqlite`):

```text
50 DELETE ... WHERE mailbox = ? AND uid = ?  → 884,5 ms
50 INSERT                                    →  14,1 ms
```

**Limitaciones:** no se probaron proveedores reales, instaladores ni el sandbox de Chromium en escritorio; las pruebas de UI Electron no se ejecutaron en esta sesión; las cifras de rendimiento son locales y sirven para comparar órdenes de magnitud, no como benchmark absoluto.

# Correo — cliente de email para Linux

Cliente de correo de escritorio (IMAP/SMTP) con caché local, pensado para Linux y desarrollado en
Windows. Estado actual: **M0 terminado** — esqueleto con aislamiento real entre UI y núcleo.

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

## Comandos

```bash
pnpm install
pnpm dev          # app en modo desarrollo con HMR
pnpm typecheck    # tsc para main/preload y para el renderer
pnpm build        # typecheck + build de producción en out/
pnpm build:linux  # AppImage + .deb (requiere Linux o CI)
```

Los artefactos quedan en `release/`.

## Estado de verificación (M0)

| Comprobación | Estado |
| --- | --- |
| `pnpm install` reproducible (pnpm 12, builds autorizados) | ✅ |
| `pnpm typecheck` (main/preload y renderer) | ✅ |
| `pnpm build` → `out/main`, `out/preload`, `out/renderer` | ✅ |
| Ventana abierta con IPC respondiendo | ⚠️ pendiente de probar en una sesión gráfica propia |

El arranque de la ventana **no se pudo verificar desde el entorno del agente**: ahí `electron.exe`
termina con `STATUS_BREAKPOINT` (0x80000003) antes de ejecutar una sola línea de JS, y le pasa igual
a la app por defecto que trae Electron, así que no es el código del proyecto. Dos causas probables:
política de aplicación sobre un binario sin firma Authenticode, o restricción de estación de ventanas
del proceso que lanza los comandos. Para descartarlo en tu terminal:

```bash
pnpm dev
```

Si elegís "sí" y la ventana no aparece, revisá esto antes de tocar código:

- `ELECTRON_RUN_AS_NODE` debe estar **vacío**. Si vale `1`, Electron corre como Node puro y la app
  muere con `TypeError: Cannot read properties of undefined (reading 'isPackaged')`. En este equipo
  estaba en `1`; se limpia con `Remove-Item Env:ELECTRON_RUN_AS_NODE`.
- Reinstalá el binario si sospechás de la descarga: `Remove-Item node_modules\electron -Recurse` y
  `pnpm install`.

Smoke test automático (necesita una sesión gráfica con `--remote-debugging-port=9333` abierto):

```bash
node scripts/smoke.mjs
```

Valida que React montó, que el puente IPC existe, que `window.require` **no** está expuesto y que el
núcleo responde `stage: "M0"`.

## Roadmap

| # | Entrega | Criterio de listo |
| --- | --- | --- |
| ✅ M0 | Esqueleto, aislamiento y contrato IPC | La app abre y reporta estado del núcleo |
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

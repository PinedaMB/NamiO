# Preparación de NamiO 1.0

Estado al 30 de octubre de 2026. La candidata actual es `1.0.0-rc.5`; sus cambios están en el changelog. Los instalables Linux en `release/1.0.0-rc.5/` son compilaciones locales para realizar las pruebas pendientes, no una publicación estable 1.0. Los artefactos previos en `release/rc-validation/` corresponden a 0.4.7.

## Alcance propuesto

Cliente IMAP/SMTP con lectura, redacción, respuesta y respuesta a todos, adjuntos, borradores, varias cuentas, búsqueda en caché, reglas, notificaciones y cola persistente. Mover, Spam y No es spam están implementados para el correo seleccionado; se habilitan cuando la cuenta ofrece la carpeta correspondiente. Marcar como spam mueve el correo, sin prometer entrenamiento del filtro del proveedor ni bloqueo del remitente.

La bandeja unificada, la IA, traducción, impresión y bloqueo de remitentes quedan fuera de 1.0. Una plataforma solo debe anunciarse como soportada tras validar su instalador y su uso real.

## Comprobaciones locales

- [x] Candidata `1.0.0-rc.5`: AppImage y `.deb` generados en `release/1.0.0-rc.5/`, SHA-256 en `SHA256SUMS`, versión Debian y contenido ASAR coincidentes. Se verificaron las licencias y 23 archivos compilados; el ejecutable reporta `1.0.0-rc.5` por IPC y pasa la prueba de arranque con un perfil temporal.
- [x] Apariencia: Claro/Oscuro/Sistema, persistencia, cambios del equipo, contraste y preferencias nativas probados en Electron; revisión visual a 800 y 1440 píxeles.
- [x] Modal de comandos: búsqueda en toda la caché de la cuenta, paginación, reintento, respuestas obsoletas y apertura de un resultado fuera de la lista visible comprobados.
- [x] Imágenes CID: resolución al abrir un cuerpo guardado, persistencia y conservación del texto offline comprobadas con IMAP local y renderizado en Electron.
- [x] Regresión de interfaz: 6 pruebas con `node scripts/test.mjs --ui`.

- [x] Cuerpos offline: texto/HTML selectivos, caracteres UTF-8/Latin-1, adjuntos bajo demanda, estado de lectura y fallos/reanudación, comprobados con caché SQLite y un servidor IMAP local.

- [x] Reconexión automática y lectura local: eventos offline/online, mensaje no descargado, recuperación del cuerpo parcial y aviso de red sin error DNS de configuración, probados en la aplicación Electron.

- [x] Actualización inmediata del lector tras movimientos y borrados confirmados, probada con consultas de carpetas lentas y fallidas.

- [x] Candidata `1.0.0-rc.4`: compilación, AppImage y `.deb` generados en `release/1.0.0-rc.4/`, hashes SHA-256 y correspondencia del código empaquetado verificados. El ejecutable reporta `1.0.0-rc.4` por IPC al arrancar con un perfil temporal.

- [x] Envío con cuenta real: confirmado por el usuario durante esta sesión.
- [x] Regresión automática: 64 pruebas con `pnpm test`.
- [x] Compilación y tipos: `pnpm run build`.
- [x] Auditoría de estilos: `pnpm run css:audit`.
- [x] Interfaz en Electron: editor, renderizado de correos y aplicación completa. Se actualizaron los selectores de prueba de las opciones de envío.
- [x] Cola de movimiento: persiste tras reabrir la caché, se aísla entre cuentas, rechaza duplicados y comprueba UIDVALIDITY antes de mover.
- [x] Fallos de servidor y respuestas obsoletas: conservan el mensaje visible.
- [x] Recuperación simulada de envío, borradores, borrado en segundo plano y credenciales OAuth, mediante la suite de regresión.
- [x] Instalables AppImage y `.deb` generados en `release/rc-validation/`, con hashes en `SHA256SUMS`. Se verificaron sus contenedores y que incluyan el mismo ASAR del paquete local.
- [x] Paquete Linux descomprimido: recursos ASAR, arranque, IPC real, renderer sin Node y preferencias conservadas entre reinicios, usando un perfil temporal.

Las pruebas de Electron de este entorno usan modo headless y `--no-sandbox`. No certifican el sandbox de Chromium, la instalación del sistema ni el comportamiento de un escritorio real.

## Pruebas externas que bloquean declarar 1.0

- [ ] Confirmar proveedores y plataformas soportados oficialmente.
- [ ] En cada proveedor anunciado: leer, responder, responder a todos, enviar con CC/CCO y adjuntos, guardar/reabrir borradores, mover, Spam y No es spam.
- [ ] Con cuentas de prueba: desconectar la red y cerrar/reabrir la aplicación mientras haya operaciones pendientes; confirmar recuperación sin pérdida de borradores ni eliminación del correo incorrecto.
- [ ] Validar inicio de sesión y renovación de OAuth reales donde se anuncie su compatibilidad.
- [ ] Instalar AppImage y `.deb` en los escritorios Linux soportados; comprobar apertura, icono, bandeja, notificaciones y reapertura.
- [ ] Probar la actualización desde una versión anterior con un perfil de prueba: conservar cuentas, borradores, adjuntos locales, reglas y cola.
- [ ] Windows: construir/probar el instalador, firma o advertencias, notificaciones y actualización en un equipo Windows. macOS queda fuera hasta contar con distribución y validación propias.
- [ ] Revisión final de teclado, foco, movimiento reducido y mensajes extensos en español e inglés.

## Cierre de la candidata

1. Registrar proveedor, sistema operativo, versión y resultado de las pruebas externas; no usar correos privados en capturas ni logs compartidos.
2. Resolver los fallos encontrados y repetir las comprobaciones afectadas.
3. Usar los instalables `1.0.0-rc.5` generados desde la versión y changelog de esta candidata; si se corrigen fallos, generar una nueva candidata identificable.
4. Validar la candidata en uso diario y su actualización antes de publicar `1.0.0`.

SMTP no permite garantizar entrega única si el servidor acepta un correo y se pierde su confirmación. Las pruebas simuladas no sustituyen las pruebas de recuperación con los proveedores reales.

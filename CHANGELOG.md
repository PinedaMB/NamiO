# Cambios

## 1.0.0-rc.1 — 2026-10-30

- Mover un correo a otra carpeta desde el lector o su menú de opciones. Los movimientos se guardan en la cola persistente, evitan solicitudes duplicadas y verifican la identidad de la carpeta antes de reintentarse.
- Marcar como spam y devolver un correo de Spam a la bandeja de entrada con «No es spam», usando las carpetas de la cuenta.
- Menú de opciones en el encabezado del correo, con Responder y Responder a todos como acciones distintas. La respuesta a todos conserva Para y CC, excluye la cuenta activa y evita direcciones duplicadas.
- Compositor con selector de tipo de respuesta, destinatarios compactos y editables, contador de destinatarios únicos, área de respuesta identificada e importancia dentro de las opciones de envío.
- Listas completas de destinatarios en un modal, con copia individual o conjunta, estados de error y animaciones de entrada y salida accesibles.
- Formato horario de 12 o 24 horas configurable y persistente; fechas compactas en el encabezado del lector.
- Expandir y colapsar el correo únicamente desde su botón. Ctrl+R deja de recargar la aplicación; Ctrl+Shift+R conserva la recarga.
- La sincronización conserva el resultado de búsqueda abierto aunque esté fuera de la primera página.

## 0.4.7 — 2026-10-29

- Nueva identidad visual en los iconos de la aplicación, instaladores, bandeja, bienvenida y marca de la interfaz, con una variante propia para las notificaciones.
- General reorganizado por idioma, lectura y notificaciones. Actualizaciones e información técnica disponibles en Acerca de.
- Actualizaciones con confirmación de la última versión, fecha de publicación y de comprobación, enlace a novedades y progreso con porcentaje, tamaño descargado y velocidad.
- Notificaciones con icono propio, resumen del último correo al recibir varios mensajes y textos para remitentes o asuntos vacíos, respetando la opción de privacidad.


## 0.4.4 — 2026-10-28

- Bienvenida en el lector con acciones rápidas y atajos. Al iniciar o cambiar de carpeta no se abre un correo automáticamente; Esc cierra el mensaje actual.
- Ctrl+A respeta el foco: selecciona los mensajes cargados en la lista, el contenido del correo o el texto del visor TXT, sin resaltar toda la interfaz. Los campos de edición mantienen su comportamiento habitual.
- Lectura del HTML sin esperar a que terminen de cargar las imágenes remotas. Los mensajes de un hilo se muestran progresivamente, priorizando el elegido o el más reciente; se evitan descargas duplicadas y respuestas de cuentas anteriores.
- Búsqueda en todas las carpetas guardadas de la cuenta activa, con «Cargar más», alcance local explícito, reintento ante errores y apertura correcta de resultados fuera de la tanda visible. Los asuntos y fragmentos resaltan las coincidencias.
- Ordenamiento y filtros aplicados a toda la caché antes de limitar los mensajes mostrados, con contadores y carga de más mensajes. Conversaciones con fechas consistentes y controles de despliegue alineados.
- Visores integrados de imágenes, PDF y TXT. Incluyen cierre con Esc, guardado, zoom para imágenes y PDF y navegación por páginas de PDF. Los TXT conservan los acentos de UTF-8, UTF-16 y Windows-1252. La vista previa admite hasta 20 MB; los PDF con contraseña se guardan para abrirlos en un lector externo.
- Adjuntos colapsados inicialmente. Al guardarlos se muestra «Preparando descarga…» en el lector y los visores, con bloqueo de clics repetidos y limpieza del indicador al terminar, cancelar o fallar.
- Importancia alta, normal o baja al redactar, recibir y mostrar mensajes, conservada en borradores y envíos pendientes; independiente de la estrella de destacados.
- Redactor con tamaño de letra, color y resaltado, colores predefinidos y restauración de valores predeterminados. Se indica la cuenta desde la que se enviará el mensaje.
- Configuración avanzada de cuentas contraída inicialmente, con sugerencias de servidor a partir del dominio del correo que respetan los cambios manuales.
- Al desvincular se eliminan las credenciales y todos los datos locales de la cuenta, sin borrar los correos del servidor. La confirmación advierte sobre borradores sin sincronizar y operaciones pendientes y permite cancelar.
- Símbolos de atajos Ctrl o ⌘ configurables y guardados, con valor inicial según el sistema. Barra de búsqueda centrada y bienvenida, tarjetas y textos más consistentes.
- Tarjetas de correo más compactas, checkbox centrado sobre el avatar y fondo blanco para avatares con imagen.
- Pruebas de regresión ampliadas para búsqueda, selección por foco, carga de mensajes, desvinculación, visores y preparación de descargas.

## 0.4.3

- Actualizaciones visibles en la barra de estado: búsqueda manual, progreso de descarga, reintento ante errores y botón para reiniciar e instalar. Disponible en Windows y AppImage.

- Fechas consistentes en listas, búsqueda, lector y respuestas: formato regional de México, hora local de 24 horas, «Ayer», año para fechas de otros años y detalle con zona horaria. Las fechas inválidas no bloquean el lector; las conversaciones se ordenan por el instante real y la sincronización muestra días, meses o años cuando corresponde.

- Las respuestas nuevas separan el área de escritura del mensaje original mediante una cita con título y fondo propio; la estructura se conserva al guardar borradores y enviar HTML.

- Indicador persistente del borrado en segundo plano con carpeta, cantidad procesada y barra de progreso; las operaciones pendientes se distinguen de las activas y el estado permanece visible al cambiar de carpeta.

- Textos de la interfaz, avisos nativos y documentación adaptados al español de México, con tuteo y terminología consistente.

- «Vaciar carpeta» en el menú contextual y la barra del lector de Spam y Papelera, con confirmación del número de mensajes y advertencia de borrado definitivo. Incluye mensajes aún no descargados y excluye los que llegan después de preparar la operación.
- Eliminaciones múltiples con una sola confirmación, cola persistente y procesamiento en segundo plano por lotes. Las eliminaciones individuales también solicitan confirmación antes de mover a Papelera.

- Formularios de inicio y de cuentas alineados: mismos datos básicos por proveedor, Yahoo disponible también en el inicio, selector de autenticación de Gmail visible y servidores bajo opciones avanzadas. Las cuentas manuales y locales muestran sus servidores para poder configurarlos.

- Registro OAuth de escritorio de Google integrado: las nuevas cuentas de Gmail pueden iniciar sesión desde el navegador sin introducir Client ID ni Client Secret. Se conservan los registros propios existentes; el acceso sigue sujeto a los usuarios de prueba autorizados en Google Cloud.

- Pruebas de regresión e interfaz integradas en comandos y CI, con cobertura adicional de recuperación de envíos pendientes y renovación OAuth.
- Selector de autenticación de Gmail disponible en Configuración también para cuentas con contraseña de aplicación; instrucciones de OAuth y acceso para crear una contraseña de aplicación.
- Retirados los accesos a Posponer, que todavía no realizaban ninguna acción. Los demás atajos personalizados se conservan.
- El lector observa el tamaño del contenido del correo sin realimentar los cambios de altura del iframe.

## 0.4.1 — 2026-10-27

- Corregida la carga de imágenes remotas en mensajes cuando están permitidas en Windows y Linux.
- El instalador de Windows se instala en el perfil del usuario y no solicita privilegios de administrador.

## 0.4.0 — 2026-10-27

- Icono de bandeja con Abrir y Salir y preferencia para mantener NamiO en segundo plano al cerrar la ventana. Los avisos de otras cuentas permiten cambiar a la cuenta y abrir el mensaje, esperando si hay una redacción activa.

- Notificaciones nativas de correo nuevo en Recibidos para todas las cuentas, con agrupación por sincronización, sonido y privacidad configurables, botón de prueba y apertura del mensaje al pulsar el aviso. Seguimiento persistente por cuenta para evitar duplicados al cambiar de cuenta o reiniciar.

- Redacción con editor Tiptap: formato enriquecido, enlaces, listas, citas, deshacer/rehacer y envío en HTML o texto plano.
- Campos Para, CC y CCO con validación, chips y autocompletado de destinatarios persistente por cuenta.
- Borradores múltiples por cuenta, con formato y adjuntos, sincronizados con la carpeta de borradores del servidor; limpieza de la copia al enviar o descartar.
- Redactor con controles para minimizar, restaurar, ampliar, guardar, descartar y adjuntar, con animaciones que respetan la preferencia de movimiento reducido.
- Correcciones para conservar el contenido ante errores, evitar envíos duplicados, persistir adjuntos y mantener las cabeceras de respuesta de las conversaciones.
- Gestión de caché en Cuentas: tamaño total y por cuenta y vaciado con confirmación, conservando credenciales, borradores, reglas y operaciones pendientes.
- Menús contextuales para correos, carpetas y borradores, accesibles con teclado.
- Correcciones del tema inicial y del tamaño del lector para evitar destellos claros y contenido cortado; conservación del contenido visible al sincronizar.
- Indicadores de «Eliminando…» para acciones individuales y múltiples, con bloqueo de acciones repetidas mientras se procesan.
- Mejoras de carga de cuentas, formularios de conexión, conversaciones y estados de lectura; ocultación de carpetas spam redundantes vacías.
- Configuración abre en General y velocidad; las reglas se reinician al cambiar de cuenta y los errores de guardado de preferencias y reglas se muestran al usuario.
- Sección «Acerca de» con información del proyecto como cliente multiplataforma.
- Easter egg en «Acerca de»: al teclear consecutivamente `100825`, se abre una dedicatoria para Naomi Aké con ilustración, emojis, resplandor y animaciones de entrada y salida; cierre con Escape o botón y restauración del foco.

## 0.3.0 — 2026-10-27

- Conexión con Microsoft integrada; Gmail admite OAuth2 o contraseña de aplicación y Yahoo muestra sus opciones de conexión simplificadas.
- Validación TLS de certificados en IMAP y SMTP, incluidos los enlaces STARTTLS.
- Aislamiento de cuentas y carpetas, nombres personalizados y guardado seguro de preferencias y credenciales renovadas.
- Sincronización manual desde la barra superior y descarga en segundo plano compatible con huecos entre UID.
- Contadores de no leídos actualizados; Papelera muestra el total de mensajes.
- Eliminación hacia Papelera y confirmación del borrado definitivo; reconciliación de carpetas desaparecidas del servidor.
- Selección múltiple con acciones para leer, archivar y eliminar mensajes.
- Barra lateral compacta, menú de cuentas con cierre exterior, tooltips animados y selector reutilizable.
- Iconos de remitentes por dominio con caché local, sujetos a la preferencia de contenido remoto.
- Identificación de Spam y bloqueo obligatorio de su contenido remoto e iconos de remitentes.
- Modo oscuro del mensaje con adaptación de colores sin invertir imágenes; cambio temporal por mensaje y preferencia general independiente.

### Verificación

Pruebas automatizadas de persistencia, aislamiento, sincronización, contadores,
eliminación, selección, privacidad, temas y controles de interfaz. Las pruebas
locales no sustituyen la comprobación visual y de conexión con buzones reales.

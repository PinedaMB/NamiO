# Cambios

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

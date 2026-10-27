# Cambios

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

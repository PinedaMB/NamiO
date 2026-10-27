<div align="center">
  <img src="src/renderer/src/assets/logo.png" alt="Mapache de NamiO" width="128" />

  <h1>NamiO</h1>
  <p><strong>Tu correo, a tu ritmo.</strong></p>
  <p>Un cliente de correo de escritorio para leer, escribir y organizar tus mensajes.<br />Varias cuentas, acceso sin conexión y avisos de correo nuevo en una interfaz oscura.</p>

  <p><strong>0.4.0 · En desarrollo · Español / English</strong></p>

  <p>
    <a href="https://github.com/PinedaMB/NamiO/releases">Descargas</a> ·
    <a href="#-qué-podés-hacer">Funciones</a> ·
    <a href="#-primeros-pasos">Primeros pasos</a> ·
    <a href="https://github.com/PinedaMB/NamiO/issues">Reportar un problema</a>
  </p>
</div>

---

## ✨ Qué podés hacer

| | En NamiO |
| --- | --- |
| 📬 **Reunir tus cuentas** | Agregá varias cuentas de correo y alterná entre ellas. Cada una conserva sus mensajes, borradores y reglas. |
| ✍️ **Escribir con formato** | Usá negrita, cursiva, subrayado, enlaces, listas y citas. Enviá en HTML o como texto plano, con adjuntos, CC y CCO. |
| 📝 **Retomar un borrador** | Guardá varios borradores por cuenta, conservá su formato y adjuntos y sincronizalos con la carpeta de borradores del servidor. |
| 🔎 **Encontrar y organizar** | Buscá en el correo guardado, destacá mensajes, archivá, eliminá o aplicá acciones a una selección. También tenés menús con clic derecho. |
| 📂 **Automatizar el orden** | Creá reglas locales para mover, archivar, marcar como leído o eliminar mensajes según sus condiciones. |
| 🔔 **Enterarte de lo nuevo** | Recibí notificaciones de tus cuentas, elegí si llevan sonido y abrí el mensaje desde el aviso. |
| 📴 **Leer sin conexión** | Consultá los mensajes ya descargados. Los envíos aceptados en la cola quedan pendientes para reintentarse cuando vuelva la conexión. |
| ⌨️ **Moverte a tu manera** | Personalizá los atajos, usá la paleta de comandos y elegí entre español e inglés para la interfaz. |

### Más espacio para escribir y leer

El redactor se puede **ampliar, minimizar y restaurar** sin perder lo que estás escribiendo. Al cerrarlo, guardás el borrador; al descartarlo, lo eliminás.

El lector permite elegir un **fondo claro u oscuro para los mensajes**, independientemente del aspecto oscuro de la aplicación. Las animaciones respetan la preferencia de movimiento reducido de tu sistema.

## 🚀 Primeros pasos

1. **Descargá una versión disponible** desde [Releases](https://github.com/PinedaMB/NamiO/releases). Revisá qué sistema y formato incluye esa publicación.
2. **Abrí NamiO y agregá tu cuenta.** También podés explorar la demostración antes de conectar tu correo.
3. **Elegí tu proveedor y completá la conexión.** El método de acceso depende del servicio que uses.
4. **Dejá que se sincronice tu bandeja.** Podés empezar a leer mientras se descarga el resto en segundo plano.
5. **Ajustá NamiO a tu gusto** desde Configuración: idioma, atajos, imágenes remotas, tema del mensaje y notificaciones.

### Conectá tu correo

NamiO trabaja con cuentas **IMAP y SMTP**.

| Servicio | Cómo se conecta |
| --- | --- |
| **Outlook / Microsoft** | Inicio de sesión en el navegador con Microsoft. Algunas organizaciones requieren autorización del administrador. |
| **Gmail** | OAuth2 o contraseña de aplicación, según la configuración de tu cuenta. La opción OAuth2 todavía requiere configurar el identificador de cliente. |
| **Yahoo** | Correo y contraseña de aplicación. |
| **Otros servidores** | Datos de conexión IMAP y SMTP proporcionados por tu servicio de correo. |
| **Proton Mail** | Requiere Proton Mail Bridge y una cuenta que permita utilizarlo. |

## 🔔 Avisos, incluso con la ventana cerrada

NamiO puede avisarte de mensajes nuevos en **todas tus cuentas**. La cuenta activa se revisa cada minuto y las demás, cada tres minutos; los avisos no son instantáneos.

En **Configuración → General y velocidad** podés:

- Activar o desactivar las notificaciones.
- Elegir si reproducen sonido.
- Ocultar el remitente y el asunto; esta opción viene activada inicialmente.
- Probar un aviso.
- Activar **Mantener en segundo plano al cerrar**, desactivado por defecto.

Con el segundo plano activado, cerrar la ventana mantiene NamiO funcionando. El icono de bandeja ofrece **Abrir NamiO** y **Salir** para terminar la aplicación por completo. Si el escritorio no ofrece una bandeja disponible, se conserva el cierre normal.

Al pulsar un aviso, NamiO abre la cuenta y el mensaje correspondientes. Si estás redactando en otra cuenta, espera a que cierres el redactor para conservar tu trabajo.

> **En Linux:** el sonido usa el tema del escritorio y necesita `canberra-gtk-play`. El volumen de efectos del sistema influye en su reproducción. Los permisos y el modo No molestar también pueden afectar a los avisos.

## 🛡️ Tu correo y tu privacidad

- **Datos locales por cuenta.** Los mensajes descargados se guardan en tu equipo para consultarlos sin conexión.
- **Credenciales protegidas por el sistema.** Se guardan cifradas cuando el sistema ofrece almacenamiento seguro; si no está disponible, NamiO no las conserva y te lo informa.
- **Imágenes remotas bloqueadas inicialmente.** Podés permitirlas desde Configuración. En correo no deseado permanecen bloqueadas.
- **Contenido de correo protegido.** Los mensajes HTML se limpian antes de mostrarse y sus enlaces se abren en tu navegador.
- **Control del espacio.** En Cuentas podés consultar el uso de caché y vaciar el contenido descargado. Esta acción conserva credenciales, borradores, reglas y operaciones pendientes, y no borra el correo del servidor.

> Sin conexión solo está disponible lo que ya se descargó. Después de vaciar la caché necesitás conectarte para recuperar el contenido de los mensajes.

## 💻 Disponibilidad

NamiO está orientado a **Linux, Windows y macOS**. La disponibilidad actual es diferente en cada plataforma:

| Plataforma | Estado |
| --- | --- |
| **Linux** | Distribución en AppImage y `.deb`. Es la plataforma con comprobaciones locales realizadas hasta ahora. |
| **Windows** | Instalador previsto en formato `.exe`; validación completa pendiente. Consultá cada publicación para ver si lo incluye. |
| **macOS** | Distribución y validación pendientes. |

## 🌱 Estado actual

**NamiO 0.4.0 está en desarrollo.** Ya incluye lectura, redacción, borradores, reglas, varias cuentas y notificaciones, pero todavía no es una versión 1.0.

- La bandeja muestra **una cuenta a la vez**; no hay bandeja unificada.
- La revisión de cuentas inactivas detecta nuevos mensajes para los avisos; no equivale a sincronizar todo su contenido continuamente.
- Las funciones de copiloto con IA todavía no están disponibles.
- Sigue pendiente ampliar las pruebas con servidores reales, interrupciones de conexión y recuperación tras cierres inesperados.

Podés consultar las novedades en el [historial de cambios](CHANGELOG.md).

## 💬 ¿Encontraste algo que mejorar?

[Reportá un problema o proponé una mejora](https://github.com/PinedaMB/NamiO/issues). Incluí la versión de NamiO, tu sistema operativo y los pasos para reproducirlo. Si adjuntás una captura, ocultá direcciones y contenido privado.

---

<div align="center">
  <p><strong>NamiO</strong> · Creado por <a href="https://github.com/PinedaMB">PinedaMB</a> · Licencia MIT</p>
</div>

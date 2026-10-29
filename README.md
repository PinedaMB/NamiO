<div align="center">
  <img src="src/renderer/src/assets/logo.png" alt="Mapache de NamiO" width="128" />

  <h1>NamiO</h1>
  <p><strong>Tu correo, a tu ritmo.</strong></p>
  <p>Un cliente de correo de escritorio para leer, escribir y organizar tus mensajes.<br />Varias cuentas, acceso sin conexión y avisos de correo nuevo en una interfaz oscura.</p>

  <p><strong>0.4.7 · En desarrollo · Español (México) / English</strong></p>

  <p>
    <a href="https://github.com/PinedaMB/NamiO/releases">Descargas</a> ·
    <a href="#-qué-puedes-hacer">Funciones</a> ·
    <a href="#-primeros-pasos">Primeros pasos</a> ·
    <a href="https://github.com/PinedaMB/NamiO/issues">Reportar un problema</a>
  </p>
</div>

---

## ✨ Qué puedes hacer

| | En NamiO |
| --- | --- |
| 📬 **Reunir tus cuentas** | Agrega varias cuentas de correo y alterna entre ellas. Cada una conserva sus mensajes, borradores y reglas. |
| ✍️ **Escribir con formato** | Usa formato, tamaño de letra, colores y resaltado. Elige la importancia del mensaje y la cuenta remitente. Envía en HTML o como texto plano, con adjuntos, CC y CCO. |
| 📝 **Retomar un borrador** | Guarda varios borradores por cuenta, conserva su formato y adjuntos y sincronízalos con la carpeta de borradores del servidor. |
| 🔎 **Encontrar y organizar** | Busca en todas las carpetas guardadas de la cuenta, carga más resultados y abre coincidencias antiguas. Ordena, filtra y aplica acciones a una selección. |
| 📎 **Ver adjuntos** | Amplía imágenes, recorre PDF por páginas o consulta TXT sin salir del correo. Guarda los archivos cuando los necesites. |
| 📂 **Automatizar el orden** | Crea reglas locales para mover, archivar, marcar como leído o eliminar mensajes según sus condiciones. |
| 🔔 **Enterarte de lo nuevo** | Recibe notificaciones de tus cuentas, elige si llevan sonido y abre el mensaje desde el aviso. |
| 📴 **Leer sin conexión** | Consulta los mensajes ya descargados. Los envíos aceptados en la cola quedan pendientes para reintentarse cuando vuelva la conexión. |
| ⌨️ **Moverte a tu manera** | Personaliza los atajos y sus símbolos Ctrl o ⌘, usa la paleta de comandos y elige entre español e inglés. |

### Más espacio para escribir y leer

Para vaciar **Spam** o **Papelera**, haz clic derecho sobre la carpeta y elige **Vaciar carpeta…**; también está disponible en la barra del lector mediante el ícono de vaciado. NamiO muestra la cantidad de mensajes y pide confirmación: el borrado es definitivo. Las selecciones múltiples también se confirman una sola vez y se procesan en segundo plano; desde otras carpetas se mueven a Papelera. Puedes seguir navegando mientras la cola trabaja. Si cierras la aplicación o falla la conexión, las operaciones pendientes se conservan para reintentarse.

El redactor se puede **ampliar, minimizar y restaurar** sin perder lo que estás escribiendo. Al cerrarlo, guardas el borrador; al descartarlo, lo eliminas.

Al iniciar se muestra una **bienvenida con acciones rápidas**. Abre un correo desde la lista y pulsa **Esc** para cerrarlo. **Ctrl+A** selecciona los mensajes cargados cuando el foco está en la lista, o el texto cuando está en el correo, un TXT o un campo de edición.

Los adjuntos aparecen **colapsados**. Las imágenes, los PDF y los TXT admiten vista previa de hasta **20 MB**, con guardado y cierre mediante Esc. Los PDF con contraseña requieren guardarse para abrirlos en otro lector. Al descargar un archivo se muestra **«Preparando descarga…»** hasta terminar o cancelar.

La búsqueda consulta **todas las carpetas guardadas de la cuenta activa**, sin limitarse a los mensajes visibles. El cuerpo del mensaje solo participa si ya se descargó; la búsqueda no consulta directamente el servidor.

El lector permite elegir un **fondo claro u oscuro para los mensajes**, independientemente del aspecto oscuro de la aplicación. Las animaciones respetan la preferencia de movimiento reducido de tu sistema.

Las fechas usan la **zona horaria del equipo** y hora de 24 horas. La lista y la búsqueda muestran la hora de hoy, «Ayer» o una fecha con año si corresponde. Al pasar el cursor sobre una fecha puedes consultar el detalle completo; el lector y las citas de respuesta incluyen el año y la zona horaria.

## 🚀 Primeros pasos

1. **Descarga una versión disponible** desde [Releases](https://github.com/PinedaMB/NamiO/releases). Revisa qué sistema y formato incluye esa publicación.
2. **Abre NamiO y agrega tu cuenta.** También puedes explorar la demostración antes de conectar tu correo.
3. **Elige tu proveedor y completa la conexión.** El método de acceso depende del servicio que uses.
4. **Deja que se sincronice tu bandeja.** Puedes empezar a leer mientras se descarga el resto en segundo plano.
5. **Ajusta NamiO a tu gusto** desde Configuración: idioma, atajos, imágenes remotas, tema del mensaje y notificaciones.

### Conecta tu correo

NamiO trabaja con cuentas **IMAP y SMTP**.

| Servicio | Cómo se conecta |
| --- | --- |
| **Outlook / Microsoft** | Inicio de sesión en el navegador con Microsoft. Algunas organizaciones requieren autorización del administrador. |
| **Gmail** | Inicio de sesión en el navegador con Google, sin configurar credenciales OAuth. Mientras el registro esté en pruebas, requiere estar en la lista de usuarios de prueba. También admite contraseña de aplicación. |
| **Yahoo** | Correo y contraseña de aplicación. |
| **Otros servidores** | Datos de conexión IMAP y SMTP proporcionados por tu servicio de correo. |
| **Proton Mail** | Requiere Proton Mail Bridge y una cuenta que permita utilizarlo. |

En Gmail puedes elegir **Contraseña de aplicación** tanto al agregar la cuenta como en su configuración. El formulario incluye un acceso para crearla en Google; necesitas verificación en dos pasos y que tu cuenta permita ese método. [Ayuda de Google](https://support.google.com/accounts/answer/185833).

Con **Iniciar sesión con Google**, NamiO utiliza su registro OAuth de escritorio. Las cuentas que ya usan un registro propio conservan sus credenciales. El registro integrado sigue en pruebas: la distribución general con acceso IMAP/SMTP requiere atender la verificación de los permisos restringidos de Google. [Requisitos de Google](https://support.google.com/cloud/answer/13463817).

## 🔔 Avisos, incluso con la ventana cerrada

NamiO puede avisarte de mensajes nuevos en **todas tus cuentas**. La cuenta activa se revisa cada minuto y las demás, cada tres minutos; los avisos no son instantáneos.

En **Configuración → General y velocidad** puedes:

- Activar o desactivar las notificaciones.
- Elegir si reproducen sonido.
- Ocultar el remitente y el asunto; esta opción viene activada inicialmente.
- Probar un aviso.
- Activar **Mantener en segundo plano al cerrar**, desactivado por defecto.

Con el segundo plano activado, cerrar la ventana mantiene NamiO funcionando. El ícono de bandeja ofrece **Abrir NamiO** y **Salir** para terminar la aplicación por completo. Si el escritorio no ofrece una bandeja disponible, se conserva el cierre normal.

Al pulsar un aviso, NamiO abre la cuenta y el mensaje correspondientes. Si estás redactando en otra cuenta, espera a que cierres el redactor para conservar tu trabajo.

> **En Linux:** el sonido usa el tema del escritorio y necesita `canberra-gtk-play`. El volumen de efectos del sistema influye en su reproducción. Los permisos y el modo No molestar también pueden afectar a los avisos.

## 🛡️ Tu correo y tu privacidad

- **Datos locales por cuenta.** Los mensajes descargados se guardan en tu equipo para consultarlos sin conexión.
- **Credenciales protegidas por el sistema.** Se guardan cifradas cuando el sistema ofrece almacenamiento seguro; si no está disponible, NamiO no las conserva y te lo informa.
- **Imágenes remotas bloqueadas inicialmente.** Puedes permitirlas desde Configuración. En correo no deseado permanecen bloqueadas.
- **Contenido de correo protegido.** Los mensajes HTML se limpian antes de mostrarse y sus enlaces se abren en tu navegador.
- **Desvinculación completa.** Al desvincular una cuenta se eliminan sus credenciales y todos sus datos locales, sin borrar los correos del servidor. La confirmación advierte si hay borradores sin sincronizar u operaciones pendientes; puedes cancelar para conservarlos.
- **Control del espacio.** En Cuentas puedes consultar el uso de caché y vaciar el contenido descargado. Esta acción conserva credenciales, borradores, reglas y operaciones pendientes, y no borra el correo del servidor.

> Sin conexión solo está disponible lo que ya se descargó. Después de vaciar la caché necesitas conectarte para recuperar el contenido de los mensajes.

## 💻 Disponibilidad

NamiO está orientado a **Linux, Windows y macOS**. La disponibilidad actual es diferente en cada plataforma:

| Plataforma | Estado |
| --- | --- |
| **Linux** | Distribución en AppImage y `.deb`. Es la plataforma con comprobaciones locales realizadas hasta ahora. |
| **Windows** | Instalador `.exe` configurado para instalarse en el perfil del usuario, sin privilegios de administrador; validación completa pendiente. Consulta cada publicación para ver si lo incluye. |
| **macOS** | Distribución y validación pendientes. |

## 🌱 Estado actual

**NamiO 0.4.7 está en desarrollo.** Ya incluye lectura, redacción, borradores, reglas, varias cuentas y notificaciones, pero todavía no es una versión 1.0.

- La bandeja muestra **una cuenta a la vez**; no hay bandeja unificada.
- La revisión de cuentas inactivas detecta nuevos mensajes para los avisos; no equivale a sincronizar todo su contenido continuamente.
- Las funciones de copiloto con IA todavía no están disponibles.
- Sigue pendiente ampliar las pruebas con servidores reales, interrupciones de conexión y recuperación tras cierres inesperados.

Puedes consultar las novedades en el [historial de cambios](CHANGELOG.md).

### Comprobaciones de desarrollo

- `pnpm test`: ejecuta las pruebas de regresión sin abrir la aplicación ni conectar cuentas reales.
- `pnpm run test:ui`: compila y ejecuta las pruebas de interfaz con Electron en modo headless.
- `pnpm run css:audit`: comprueba clases, variables y recursos del CSS.

El CI de Linux ejecuta estas comprobaciones en cada push a `main` o `master` y en cada pull request. Las pruebas cubren fallos de red, persistencia de borradores y envíos pendientes, reintentos concurrentes, renovación de credenciales OAuth y fallos al guardar la copia en Enviados. No garantizan entrega única si el servidor SMTP acepta un correo y se pierde su confirmación, ni sustituyen las pruebas con proveedores reales.

Las pruebas usan `typescript-test` (TypeScript 5) para extraer y ejecutar funciones con su API de compilador; la compilación de la aplicación conserva TypeScript 7.

## 📄 Licencia

NamiO se distribuye bajo la [licencia MIT](LICENSE). Las bibliotecas, fuentes e íconos de terceros conservan sus propias [licencias y atribuciones](THIRD_PARTY_NOTICES.md), también incluidas con la aplicación.

## 💬 ¿Encontraste algo que mejorar?

[Reporta un problema o propón una mejora](https://github.com/PinedaMB/NamiO/issues). Incluye la versión de NamiO, tu sistema operativo y los pasos para reproducirlo. Si adjuntas una captura, oculta direcciones y contenido privado.

---

<div align="center">
  <p><strong>NamiO</strong> · Creado por <a href="https://github.com/PinedaMB">PinedaMB</a> · <a href="LICENSE">Licencia MIT</a></p>
</div>

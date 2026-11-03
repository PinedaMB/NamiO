---
name: "NamiO Calma"
description: "Correo con más espacio para leer y menos información permanente."
colors:
  surface: "light-dark(#ffffff, #202124)"
  surface-container-lowest: "light-dark(#ffffff, #202124)"
  surface-container-low: "light-dark(#f5f5f7, #292a2e)"
  surface-container: "light-dark(#f0f0f3, #303136)"
  surface-container-high: "light-dark(#e9e9ef, #393a40)"
  surface-container-highest: "light-dark(#dedee5, #45464e)"
  sidebar-surface: "light-dark(#f2f2f4, #292a2e)"
  selection-surface: "light-dark(#e7e7f4, #393952)"
  on-surface: "light-dark(#242428, #eeeef1)"
  on-surface-variant: "light-dark(#55555f, #c4c4ce)"
  outline: "light-dark(#66666f, #aaaab6)"
  outline-variant: "light-dark(#c8c8d2, #55555f)"
  primary: "light-dark(#5556b8, #b9baff)"
  on-primary: "light-dark(#ffffff, #1000a9)"
  secondary: "light-dark(#525a9d, #bdc2ff)"
  secondary-container: "light-dark(#e3e6ff, #2f3aa3)"
  on-secondary-container: "light-dark(#273272, #a8afff)"
  tertiary: "light-dark(#465b98, #b8c4ff)"
  tertiary-container: "light-dark(#dfe6ff, #3f4a8a)"
  error: "light-dark(#b3261e, #ffb4ab)"
  error-container: "light-dark(#ffdad6, #93000a)"
  on-error-container: "light-dark(#410002, #ffdad6)"
  overlay-scrim: "light-dark(rgb(20 20 30 / 28%), rgb(0 0 0 / 55%))"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter Variable', Inter, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
    letterSpacing: "-0.006em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter Variable', Inter, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter Variable', Inter, 'Segoe UI', sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "34px"
    letterSpacing: "-0.025em"
  label:
    fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "14px"
    letterSpacing: "0.04em"
rounded:
  sm: "2px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "12px"
  lg: "20px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    height: "28px"
    padding: "0 10px"
  tool-button:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 9px"
  navigation-selected:
    backgroundColor: "{colors.selection-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "6px"
  message-selected:
    backgroundColor: "{colors.selection-surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: "18px 12px"
  sender-avatar:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.full}"
    width: "28px"
    height: "28px"
  attachment:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: "12px"
  settings-section:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    rounded: "0"
    padding: "0"
  account-dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "28px"
    width: "min(600px, 100%)"
---

# Design System: NamiO Calma

## Overview

**Creative North Star: “NamiO Calma”.**

Una interfaz de correo minimalista, inspirada en macOS: superficies neutras, herramientas discretas y jerarquía basada en texto y espacio. El contenido del mensaje concentra la atención. La propuesta aprobada reemplaza Veloce sin cambiar el motor de correo.

La implementación vive en `src/renderer/src/styles/tokens.css`, `app.css` y los componentes del renderer. Los tokens son normativos; esta guía describe su aplicación. Configuración, diálogos y redacción comparten las superficies planas y la jerarquía de Calma, conservando sus funciones.

Características: lista plana, detalles bajo demanda, selección suave, navegación de tres columnas y lectura enfocada.

## Colors

### Primary

El índigo primario indica selección, foco, enlaces y acciones principales. La superficie de selección aporta un fondo suave; no necesita un contorno adicional. La marca original conserva sus colores.

### Secondary

Los tonos secundarios existentes siguen disponibles para selección de texto, chips y avatares. La lista y el lector muestran el avatar del remitente para reconocerlo; las etiquetas decorativas no vuelven a la lista principal.

### Tertiary

Los tonos terciarios comunican operaciones pendientes y adjuntos. Los errores y las acciones destructivas usan la familia de error; la importancia alta conserva el tratamiento semántico existente del correo.

### Neutral

El lector y la lista comparten la superficie base. La navegación lateral usa su propia superficie gris. Los niveles de contenedor separan campos y menús; Configuración agrupa sus secciones con espacio y divisores finos, sin tarjetas rellenas. El velo compartido `overlay-scrim` atenúa el fondo de overlays, paleta y diálogos de destinatarios y movimiento, sin blur. La dedicatoria conserva su backdrop específico de superficie base con opacidad.

**La regla de la atención.** Reservar el acento para estados y acciones; no colorear cada fila ni cada sección.

Claro, Oscuro y Sistema se resuelven con `light-dark()` y `color-scheme`. El tema del correo HTML es independiente: no inferirlo de la apariencia de la aplicación.

## Typography

Texto de sistema en macOS, con Inter Variable empaquetada como alternativa. Los nombres, fechas y contadores de la lista usan sans; JetBrains Mono queda disponible para atajos y datos en las superficies existentes que lo requieren.

- Título de carpeta: rol `title`.
- Asunto abierto: rol `headline`; en anchos de hasta 1520 px usa el ajuste existente a 24/32 px.
- Lista: remitente (13 px), asunto (14/20 px, hasta dos líneas), vista previa (12/19 px), fecha (11 px). Los no leídos refuerzan remitente y asunto con peso 650 y un punto de estado accesible.
- Cuerpo de texto propio: lectura (15/27 px). El HTML recibido conserva su contenido y formato, sujeto al tratamiento de seguridad y tema del lector.
- Botones y campos de configuración/cuenta: sans (13 px); etiquetas de cuenta (12 px). Evitar añadir etiquetas técnicas o atajos permanentes al lector.
- Configuración: título de pantalla (26/34 px), títulos de sección (16/24 px), descripciones (13/20 px).
- Diálogo de cuenta: título (20/28 px), descripción (13/20 px).

## Layout

En escritorio: navegación lateral (184 px), lista (320 px; 360 px desde 1600 px de ventana) y lector flexible. La barra superior (62 px) pertenece al área de trabajo y reúne búsqueda, Redactar y el menú de acciones. La lista baja a 300 px en anchos de hasta 1280 px.

La navegación se colapsa por defecto a 64 px en ventanas de hasta 960 px; el usuario puede expandirla. En ese ancho se alterna lista y lector, con Volver disponible en el mensaje. Hasta 520 px, Redactar conserva su icono y nombre accesible y oculta solo el texto visible.

El mensaje tiene una medida máxima de 760 px. La lectura enfocada oculta navegación, lista y contexto y mantiene una salida visible en la barra del lector. El panel contextual de demostración inicia cerrado salvo preferencia guardada; no aparece para cuentas reales.

La barra de estado (36 px) aparece para operaciones pendientes, progreso y avisos de actualización. En reposo se oculta. La desconexión conserva su aviso específico y sus acciones de recuperación.

Configuración tiene un ancho máximo de 1120 px, padding de 32 × 36 px y una rejilla de navegación (190 px) y contenido flexible, separados por 40 px. Las secciones usan un stack de 28 px, con divisor y 28 px de espacio superior entre secciones. Hasta 960 px pasa a una columna con navegación en tres columnas y padding de 24 × 20 px; hasta 520 px la navegación usa dos columnas y el padding es de 24 × 16 px.

Los diálogos de cuenta y remapeo usan padding de 28 px, reducido a 20 px hasta 520 px. El diálogo de cuenta separa sus grupos por 24 px y conserva scroll vertical cuando crece el formulario.

## Elevation & Depth

La navegación y lectura son planas. El fondo seleccionado y los cambios de superficie dan jerarquía; no añadir sombras a los mensajes. Los tokens de sombra existentes se conservan para capas flotantes, paleta y diálogos. Sus valores y los de movimiento están en el sidecar.

Las transiciones de estado usan los tiempos existentes (120 y 180 ms). Respetar `prefers-reduced-motion`; no introducir animación decorativa continua.

## Shapes

Filas y botones con curvas suaves (radio `lg`); campos y menús usan los radios compartidos. Los mensajes del visor se delimitan con un borde de 1 px atenuado y radio `xl`, sin sombras. La cabecera usa una superficie neutra suave con padding de 16/20 px; los adjuntos ocupan una franja intermedia con su propio divisor. El cuerpo conserva el fondo de la app y padding de 20 px. Los diálogos mantienen el radio `xl`; las secciones de ajustes son planas, sin radio ni superficie propia. Evitar convertir cada dato en una píldora.

## Components

### Navigation and toolbar

La navegación conserva marca, cambio de cuenta, carpetas y acceso a configuración. Los contadores solo se renderizan cuando son mayores que cero. Redactar está en la barra superior. El menú de esa barra conserva comandos, sincronización y preferencias; idioma sigue en Configuración.

### Message list

Avatar del remitente, nombre, asunto, una línea de vista previa y fecha, sin organizaciones ni filas de etiquetas. El avatar de la lista conserva el tamaño base (28 px); la casilla aparece sobre el avatar al pasar el puntero y permanece visible mientras está seleccionada o tiene foco de teclado. En pantallas táctiles la casilla permanece disponible. Siguen disponibles las acciones masivas y las conversaciones desplegables. Los filtros y el orden se abren desde herramientas compactas; un filtro activo aparece con una acción para volver a Todos.

### Reader

Asunto, avatar del remitente (36 px), nombre y fecha conducen al contenido. Ver detalles abre el diálogo con De, Para y CC; cada dirección puede copiarse y Copiar todos sigue copiando destinatarios.

Los avatares reutilizan `SenderAvatar`: iniciales como alternativa, imagen solo cuando la preferencia de imágenes remotas lo permite, sin solicitudes en spam ni en la demostración. Si falla una imagen se recuperan las iniciales. No introducir nuevas consultas de imágenes para completar la identidad visual.

Los adjuntos permanecen cerrados por defecto. El resumen muestra cantidad, los dos primeros nombres y «+N más», manteniendo visible el contador al truncar los nombres; al desplegarse, los nombres del resumen se ocultan y aparecen los archivos en una rejilla adaptable. Cada columna tiene un mínimo de 240 px, limitado al ancho disponible para no desbordar ventanas estrechas. Las tarjetas suaves usan padding de 12 px y radio `lg`, nombre sans (13 px/500) y detalle sans (12 px). El nombre puede partirse si es largo.

Cada archivo distingue la vista previa (imagen, PDF o texto) de la descarga mediante icono y nombre accesible que incluye el archivo. Conservar los estados de preparación, deshabilitado y progreso, y las vistas previas y descargas existentes.

Las carpetas especiales usan el idioma de la aplicación; las carpetas personales conservan su nombre.

La barra mantiene las acciones principales, navegación entre mensajes y lectura enfocada. Las acciones secundarias permanecen en el menú existente del mensaje. No mostrar afirmaciones técnicas de cifrado sin evidencia real.

Las reglas de correo muestran una sola acción principal cuando no hay reglas: Nueva regla. El estado vacío desaparece durante la edición; Aplicar a los existentes aparece con reglas guardadas. Las explicaciones de ejecución local, cola y alcance de la caché permanecen en Cómo funcionan las reglas.

### Buttons and fields

Herramientas transparentes con superficie suave al pasar el puntero; botones primarios con índigo y texto de contraste. Cada botón de icono tiene nombre accesible y tooltip. Conservar estados deshabilitados, foco y progreso. La búsqueda usa un campo de bajo contraste sobre la superficie base.

### Settings

General reúne apariencia, idioma, hora y segundo plano. Lectura agrupa el tema del correo, imágenes remotas y descarga sin conexión; Notificaciones contiene los avisos, sonido y privacidad. Cuentas reúne la gestión, caché y firma de la cuenta activa. Reglas, atajos y Acerca de conservan sus secciones.

Título simple y navegación sin contadores. La selección de sección usa la superficie suave compartida; el contenido se organiza en bloques transparentes con divisores. Evitar el encabezado técnico del motor y el perfil duplicado. Los campos y controles segmentados usan sans; los estados de error, guardado y operaciones mantienen sus mensajes y acciones.

### Dialogs

Cuenta y remapeo usan la superficie base y sombra compartida. El pie de cuenta separa sus acciones con un divisor y padding superior de 20 px. Los fieldsets de cuenta son planos, con divisores en las opciones avanzadas. El diálogo de destinatarios usa una lista transparente. La paleta mantiene su superficie base, sin gradiente ni blur, con búsqueda y navegación por teclado.

Conservar las validaciones, contraseñas protegidas, OAuth, foco inicial, cierre y recuperación de errores de los componentes existentes. La dedicatoria conserva su contenido e imagen; su contenedor comparte la superficie de Calma.

### Composer

Reutilizar el editor y los selectores del proyecto. Cabecera, campos, editor y pie comparten la superficie base; los divisores separan grupos y la barra de formato usa un gris suave. La redacción conserva adjuntos, borradores, formato y opciones de envío. Los cambios se propagan por tokens sin modificar el HTML enviado ni añadir recursos externos.

## Do's and Don'ts

- **Do** dejar el contenido como elemento dominante y desplazar metadatos al diálogo correspondiente.
- **Do** mantener visibles errores, colas y avances cuando requieren atención.
- **Do** conservar teclado, foco, nombres accesibles y traducciones en español e inglés.
- **Do** usar Material Symbols Outlined empaquetados; conservar el mapache original sin recolorearlo.
- **Don't** restaurar filtros duplicados, el pie permanente de atajos ni tarjetas para cada mensaje.
- **Don't** eliminar validaciones o funciones al reducir etiquetas visibles.
- **Don't** volver a envolver cada sección de Configuración en una tarjeta ni añadir gradientes o blur a la paleta.
- **Don't** extender la paleta con valores locales o cargar fuentes e iconos desde CDN.

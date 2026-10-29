# Identidad visual de NamiO

Sistema **Veloce**: índigo sobre una superficie casi negra, tipografía Inter para contenido,
JetBrains Mono para metadatos y atajos, y Material Symbols por ligadura. Está implementado en
`src/renderer/src/styles/tokens.css` (tokens) y `app.css` (componentes). Este documento es la
referencia: si un valor no está acá ni en los tokens, no debería existir.

---

## 1. Principios

1. **La interfaz desaparece.** Superficies oscuras y de bajo contraste entre sí, para que el
   contenido (y el correo, sobre papel claro) sea lo único que compite por la atención.
2. **Densidad con aire.** Filas compactas, pero con `--sp-md` (12 px) de respiro interno; nada de
   bloques apretados.
3. **El teclado es de primera clase.** Cada acción importante tiene atajo, y el atajo se muestra
   donde se usa (toolbar, pie) —y desaparece antes que el texto cuando falta ancho.
4. **Mono para lo que se lee como dato.** Versiones, rutas, correos, contadores y combinaciones de
   teclas van en JetBrains Mono; el contenido va en Inter.
5. **Nada de red.** Fuentes e iconos se empaquetan; la CSP de producción lo prohíbe explícitamente.

---

## 2. Marca

El logo es un **mapache** índigo: la mascota da nombre y carácter a la app (NamiO → *nami* +
raccoon), y funciona mejor que una letra porque se reconoce a 30 px y a 512 px por igual.

| Pieza | Archivo | Uso |
| --- | --- | --- |
| Original de app | `build/icon-source.png` (1024², alfa) | mapache sobre fondo cuadrado redondeado |
| Original de notificaciones | `build/notification-source.png` (1024², alfa) | mapache con campana |
| Original de marca | `build/logo-source.png` (2000², alfa) | mapache con contorno blanco |
| Icono de app | `build/icon.png` (512²) · `build/icon-1024.png` | `electron-builder` (Linux y Windows) |
| Notificaciones | `build/notification.png` (256²) | avisos nativos de correo nuevo |
| Marca en la UI | `src/renderer/src/assets/logo.png` (256²) | rail, bienvenida, inicio y Acerca de |

Reglas de uso:

- Se usa **tal cual**: sin recolorear, sin rotar, sin contorno ni sombra dura. El único efecto
  admitido es un `drop-shadow` índigo muy tenue para separarlo de un fondo oscuro.
- Se conserva la transparencia y el diseño de cada original, incluido el fondo del icono de app.
- Tamaños: 30 px en el rail, 512/1024 en el sistema. No hay versión monocroma: el contraste lo dan
  las franjas claras del hocico y las cejas.
- Los tamaños se regeneran con `python scripts/make-icons.py` (requiere Pillow); el script recorta
  el alfa de cada original y deja 4 % de respiro.

## 3. Paleta

Cinco familias. El valor entre paréntesis es el contraste medido contra `--surface` (`#0f131c`),
calculado con la fórmula WCAG.

### Superficies (de la más profunda a la más elevada)

| Token | Valor | Uso |
| --- | --- | --- |
| `--surface-container-lowest` | `#0a0e16` | rail, barra de estado |
| `--surface` | `#0f131c` | fondo de la app y del lector |
| `--surface-container-low` | `#181c24` | tarjetas de ajustes, campos |
| `--surface-container` | `#1c2028` | controles en reposo |
| `--surface-container-high` | `#262a33` | chips, botones suaves, hover de teclas |
| `--surface-container-highest` | `#31353e` | bordes, divisor de 1 px |

Regla: **la elevación se expresa con superficie, no con sombra.** Las sombras
(`--shadow-sm/md/lg`) son solo para lo que flota sobre el layout (diálogos, paleta, toasts).

### Texto y trazos

| Token | Valor | Uso | Contraste |
| --- | --- | --- | --- |
| `--on-surface` | `#dfe2ee` | texto principal | 14.38 : 1 |
| `--on-surface-variant` | `#c7c4d7` | texto secundario, descripciones | 10.89 : 1 |
| `--outline` | `#908fa0` | metadatos, placeholders, texto terciario | 5.86 : 1 |
| `--outline-variant` | `#464554` | bordes de chips fantasma | — |

Todo el texto de la app pasa AA (≥ 4.5 : 1). El texto de `--outline` sobre
`--surface-container-low` sigue pasando (5.38 : 1); no bajarlo más.

### Acentos

| Token | Valor | Uso |
| --- | --- | --- |
| `--primary` | `#c0c1ff` | acción principal, selección, enlaces de UI |
| `--on-primary` | `#1000a9` | texto sobre `--primary` (7.72 : 1) |
| `--primary-container` | `#8083ff` | marca (logo), acentos de fondo |
| `--secondary` / `--secondary-container` | `#bdc2ff` / `#2f3aa3` | avatares, chip primario, selección de texto |
| `--tertiary` | `#b8c4ff` | estado "en cola", iconos de adjunto, estado offline |
| `--tertiary-container` | `#3f4a8a` | fondo de avatar terciario (al 40 %) |

### Error / destructivo

| Token | Valor | Uso |
| --- | --- | --- |
| `--error` | `#ffb4ab` | icono y texto destructivo (10.94 : 1) |
| `--error-container` | `#93000a` | fondo de acciones destructivas en hover |
| `--on-error-container` | `#ffdad6` | texto sobre ese fondo |

### Semántica de color (no negociable)

- **Índigo (`--primary`)** = acción o selección. Nunca decoración.
- **Terciario (`--tertiary`)** = algo pendiente o fuera de línea (cola, caché, adjuntos).
- **Rojo (`--error`)** = destructivo o falla. Un rojo nunca se usa para "importante" a secas.
- **Verde**: no existe en la paleta. El éxito se comunica con icono (`check_circle`) y texto, no con
  color —evita el falso verde/rojo en daltonismo.

---

## 4. Tipografía

Familias empaquetadas (`@fontsource-variable`), sin CDN:

- **Inter Variable** — contenido, títulos, botones. `letter-spacing` ligeramente negativa.
- **JetBrains Mono Variable** — metadatos, contadores, `kbd`, rutas, versiones, correos.
- **Material Symbols Outlined** — iconos por ligadura (no SVG en línea).

Escala (definida como clases utilitarias en `tokens.css`):

| Clase | Tamaño / interlínea | Peso | Uso |
| --- | --- | --- | --- |
| `.t-headline-lg` | 28 / 36 | 600 | título del mensaje abierto |
| `.t-headline-md` | 20 / 28 | 600 | títulos de pantalla |
| `.t-headline-sm` | 16 / 24 | 600 | nombre del remitente |
| `.t-body-lg` | 15 / 24 | 400 | cuerpo de lectura |
| `.t-body-md` | 14 / 22 | 400 | base de la app |
| `.t-body-sm` | 13 / 20 | 400 | listas, descripciones |
| `.t-label` | 11 / 14 mono, `+0.04em` | 500 | etiquetas en mayúsculas |
| `.t-kbd` | 11 / 12 mono, `+0.05em` | 600 | combinaciones de teclas |

Reglas:

- **Nunca** más de dos pesos en un mismo bloque (400/500 + 600 de énfasis).
- Las etiquetas de sección van en mono, mayúsculas, 10–11 px y `letter-spacing` positivo.
- Los números de contadores y tiempos van en mono: alinean entre filas.

---

## 5. Espaciado, radios y sombras

```
espaciado:  --sp-xs 4 · --sp-sm 6 · --sp-md 12 · --sp-lg 20 · --sp-xl 28
radios:     --r-sm 2 · --r-md 6 · --r-lg 8 · --r-xl 12 · --r-full 999
sombras:    --shadow-sm/md/lg (solo capas flotantes)
```

- Ritmo base **4 px**; los componentes usan 6/8/12.
- Radios: **6 px** para chips y `kbd`, **8 px** para botones y filas, **12 px** para tarjetas,
  el marco del correo y diálogos.
- Bordes: **1 px** con `color-mix(...)` entre `--surface-container-highest` y transparente, para que
  no compitan con el texto.

---

## 6. Layout

Rejilla de una sola fila y tres columnas dentro del `shell`:

```
┌──── rail 224 ────┬──── lista 380 ────┬──── lectura (flex) ────┬── contexto 320 ──┐
│ marca, carpetas  │ filtros + filas   │ toolbar + mensaje      │ IA (solo demo)   │
└──────────────────┴───────────────────┴────────────────────────┴──────────────────┘
 topbar 48 px · barra de estado 36 px
```

| Medida | Token | Valor |
| --- | --- | --- |
| rail | `--rail-w` | 224 px |
| lista | `--list-w` | 380 px |
| panel de contexto | `--context-w` | 320 px (colapsable, oculto ≤ 1280) |
| topbar | `--topbar-h` | 48 px |
| barra de estado | `--status-h` | 36 px |

### Adaptación (mobile last, no "responsive" de teléfono)

La app es de escritorio: en vez de apilar, **quita** lo prescindible en este orden.

| Ancho | Qué cambia |
| --- | --- |
| ≤ 1560 | la cabecera del mensaje pasa a dos líneas |
| ≤ 1520 | se ocultan los `kbd` de la toolbar y la leyenda secundaria del pie |
| ≤ 1400 | la búsqueda se angosta |
| ≤ 1280 | se oculta el panel de contexto y la lista baja a 360 px |
| ≤ 1180 | ajustes y diagnóstico pasan a una columna |
| ≤ 1080 | rail 200 / lista 330, se ocultan filtros inactivos y contadores |

Regla: **el texto nunca se corta antes que un atajo o un adorno**; primero desaparece el adorno.

---

## 7. Componentes

### Botones (`.btn`)

Altura 28 px, radio 8 px, 13 px/500. Variantes: `--primary` (fondo índigo, texto `--on-primary`),
`--surface`, `--quiet`, `--ghost`, `--danger` (el rojo aparece **solo en hover**, nunca en reposo).
`disabled` = opacidad 0.5 + `cursor: not-allowed`, sin cambiar de color.

### Botón de icono (`.icon-btn`)

32×32, radio 8, transparente; en hover toma `--surface-container`. Siempre con `title` y
`aria-label`.

### Herramientas de lectura (`.tool-btn`)

28 px de alto, 12–13 px, 500; el `kbd` a la derecha del texto. En ≤ 1520 el `kbd` se oculta:
la acción sigue dictada por el pie de página.

### Teclas (`.kbd`)

Mono 11 px, fondo `--surface-container-high`, radio 2 px, `min-width` 16 px. Variantes `--quiet`,
`--accent`, `--danger`.

### Chips (`.chip`)

Mono 11 px, radio 6, fondo alto. `--primary` para lo seleccionado, `--accent` para lo activo,
`--outline` para lo neutro. Un chip nunca es un botón: si es clickeable, es `.seg__btn` o `.btn`.

### Avatares (`.avatar`)

Círculo con iniciales, 28/36/40 px. `--accent` (índigo) para el remitente activo, `--tertiary` para
el resto, fondo de superficie como fallback. Las iniciales se derivan del nombre o del correo,
descartando partes numéricas (`testuser@127.0.0.1` → `T`, no `T1`).

### Punto de estado (`.dot`)

6 px. Índigo = activo, terciario = sincronizado/en cola, rojo = sin conexión, `--idle` = apagado.
Con `pulse` solo cuando hay actividad real.

### Campos

`input`/`textarea` sin borde propio: el contenedor es el campo. Foco = `:focus-within` con
`outline` de 1 px en `--primary` al 45 %. Placeholder en `--outline`, nunca en `--on-surface`.

### Tarjetas de ajustes

Fondo `--surface-container-low`, radio 12, padding `--sp-xl`, título 16/600 y subtítulo 13 en
`--on-surface-variant`. Una tarjeta = una decisión.

### Lista de mensajes

Fila de 76 px: avatar, remitente (16/600), hora en mono, asunto (14/500) y preview de una línea.
No leído = remitente y asunto en peso 650 y `--on-surface`, sobre índigo junto a la hora;
leído = peso 500 y asunto en `--on-surface-variant`. Fila activa = fondo con índigo al 12 %
sobre `--surface-container-lowest` y contorno interior de 1 px con índigo al 55 %.

### Lector

Cabecera con remitente, destinatarios, fecha y "Cifrado TLS 1.3"; luego el cuerpo. Título a 28/600
(24 en ≤ 1520). La toolbar está arriba y no se mueve al scrollear el cuerpo.

### Compositor

Overlay centrado de 1180×900 máx. Barra de formato en mono, cuerpo en Inter 15/24, adjuntos como
pills. Con cuenta real **no** se muestra el panel de copiloto ni adjuntos de ejemplo: esas piezas
son de la demo.

### Diálogos flotantes (paleta, cuenta)

Fondo `--surface-container`, radio 12, `--shadow-lg`, entrada de 160 ms con `dialog-in`. El fondo se
atenúa con un velo negro al 40 %, nunca con blur (cuesta GPU en equipos modestos).

---

## 8. Iconografía

- **Material Symbols Outlined** por ligadura: `<Icon name="inbox" />` → `<span class="icon">inbox</span>`.
- Tamaños: 14/15/16/18/20/22 px (`font-size`), trazo 400. `fill` solo para estados activos
  (estrella marcada, carpeta seleccionada).
- Un icono **nunca** va solo si la acción es destructiva o poco frecuente: siempre con `title`.
- No se mezclan iconos de otra familia ni SVG sueltos. Si falta un glifo, se usa el más cercano y
  se anota; no se dibuja un SVG a mano.

---

## 9. Movimiento

```
--fast 120ms · --normal 180ms · --ease cubic-bezier(0.2, 0, 0.2, 1)
```

| Animación | Duración | Uso |
| --- | --- | --- |
| `fade-in` | 120 ms | aparición de contenido |
| `view-in` / `content-in` | 180–220 ms | cambio de vista (bandeja ↔ ajustes) |
| `dialog-in` / `dialog-out` | 160 ms | paleta, cuenta, compositor |
| `toast-in` | 160 ms | avisos |
| `pulse` | 2 s, infinito | sincronización activa |
| `spin` | 800 ms, lineal | carga |

Reglas:

- El movimiento **acompaña un cambio de estado**, no decora. Nada de parallax ni rebotes.
- Todo se desactiva con `prefers-reduced-motion: reduce` (duración 0.001 ms).
- Los paneles colapsables animan `width`/`opacity` a 180 ms; el contenido no se reacomoda con
  saltos.

---

## 10. El correo es papel

El HTML ajeno se dibuja en un iframe **sobre blanco** (`#ffffff`), con radio 12 px y borde de 1 px
negro al 14 %, dentro de la UI oscura.

- No se invierte ni se "tematiza" el correo: el 90 % de los correos asume fondo claro.
- Imágenes remotas bloqueadas por defecto (política global en Ajustes, override por mensaje).
- Links se abren en el navegador del sistema.
- El iframe mide su contenido y crece; no hay scroll anidado.

---

## 11. Accesibilidad

- **Contraste**: pares de texto validados (ver tabla). Ningún texto por debajo de 4.5 : 1.
- **Foco**: visible en campos y controles (`:focus-within`/`:focus-visible`); la navegación por
  teclado no depende del ratón.
- **Semántica**: `button` para acciones, `role="tab"`/`aria-selected` en filtros, `aria-label` en
  botones de icono, `sr-only` para texto solo de lector.
- **Estado por más de un canal**: no leído = color + punto; error = rojo + icono + texto.
- **Sin hover como única vía**: toda acción tiene atajo y/o botón visible.

---

## 12. Voz y microcopy

- **Español de México (tuteo)**: "Presiona", "Elige", "Puedes". Inglés neutro en la variante `en`.
- Frases cortas, en presente, sin signos de exclamación.
- Se nombra lo que pasa: "Sin conexión · mostrando la última copia guardada" en lugar de "Error de
  red". Los errores dicen qué falló y qué se puede hacer.
- Los ids técnicos (correo, versión, ruta) van en mono y entre comillas angulares si son literales.
- Nunca se traduce el contenido del correo; solo la interfaz.

---

## 13. Implementación

- **Tokens primero**: un color, radio o duración nueva se agrega en `tokens.css`; los componentes no
  inventan valores.
- **Cero red**: fuentes e iconos son dependencias empaquetadas. La CSP de producción bloquea
  `style-src`/`font-src` externos.
- **Verificación**: `pnpm run css:audit` cruza el CSS con el JSX y falla si hay una variable sin
  definir, una clase usada sin regla, un `url()` roto o un asset faltante en el bundle.
- **Deuda conocida**: 8 variables (`--surface-dim`, `--surface-bright`, `--inverse-on-surface`,
  `--on-secondary`, `--on-tertiary`, `--on-error`, `--gutter`, `--margin`) y 15 clases
  (`t-headline-*`, `kbd--quiet/accent/danger`, `chip--tertiary/error`, `btn--surface/quiet/ghost`,
  etc.) que vienen de los mockups y no se usan. El auditor las lista con `--verbose`.

### Checklist para cambios visuales

- [ ] ¿Usa solo tokens existentes? Si no, ¿agregaste el token a `tokens.css`?
- [ ] ¿El texto nuevo pasa 4.5 : 1 sobre su fondo?
- [ ] ¿Funciona con teclado y con `prefers-reduced-motion`?
- [ ] ¿Sobrevive a 1280 px y a 1080 px sin cortar el texto?
- [ ] ¿`pnpm run css:audit` sigue en verde?
- [ ] ¿La cadena nueva está en `es.ts` y `en.ts` (mismo largo aproximado)?

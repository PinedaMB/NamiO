# NamiO

<!-- impeccable:product-schema 1 -->

## Platform

web

Interfaz web de escritorio empaquetada en Electron; no es una aplicación GTK ni una web pública. El repositorio dispone de empaquetado para Linux y Windows. La compatibilidad efectiva de cada publicación depende de sus pruebas y artefactos de lanzamiento.

## Product Purpose

Cliente de correo para leer, redactar y organizar mensajes de varias cuentas IMAP/SMTP, con copias locales para lectura sin conexión. El usuario pidió reducir la carga visual y aprobó la propuesta NamiO Calma antes de su implementación.

## Capabilities and Constraints

Hechos del producto documentados en README.md y el código:

- Cuentas múltiples, OAuth según proveedor, borradores, adjuntos, búsqueda local, reglas, acciones por mensaje y selección múltiple.
- Cola persistente para envíos y operaciones pendientes; los errores y avances de estas operaciones deben seguir siendo visibles.
- Español de México e inglés; los mensajes recibidos conservan su idioma y contenido originales.
- Electron, React y TypeScript. El rediseño conserva la arquitectura y los flujos de correo existentes.
- Fuentes, iconos y recursos de interfaz empaquetados; no introducir CDN en la aplicación.
- La apariencia de la aplicación admite Claro, Oscuro y Sistema; el cuerpo del correo mantiene una preferencia independiente.

## Brand Commitments

Nombre NamiO y mapache original de `src/renderer/src/assets/logo.png`. Conservar los recursos originales de marca sin recolorearlos ni sustituirlos. La dirección visual aprobada es minimalista, inspirada en macOS; sus valores y componentes se documentan en DESIGN.md.

## Product Principles

- Priorizar lectura, búsqueda, redacción y organización del correo.
- Mostrar detalles secundarios cuando el usuario los solicita.
- Conservar acciones, validaciones y recuperación ante errores al simplificar su presentación.
- Mantener acceso por teclado y nombres accesibles en acciones representadas por iconos.

## Evidence on Hand

README.md describe capacidades y límites; `src/renderer/src/data/demo.ts` contiene contenido de demostración. Las capturas en `docs/` pueden representar versiones anteriores: la implementación actual es la referencia para documentar el rediseño.

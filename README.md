# NamiO · Landing

Sitio de presentación de NamiO, creado con Astro y basado en el diseño HTML de referencia. Esta rama contiene únicamente la landing; la aplicación de escritorio vive en `master`.

## Desarrollo

```bash
pnpm install
pnpm dev
```

Abrí la URL que imprime Astro, incluyendo `/NamiO/`.

```bash
pnpm build
pnpm test
pnpm preview
```

## GitHub Pages

La configuración apunta a `https://pinedamb.github.io/NamiO/`.

En el repositorio, elegí **Settings → Pages → Source → GitHub Actions**. Si el entorno `github-pages` restringe las ramas, permití `gh-pages` en **Settings → Environments → github-pages**.

El workflow `deploy-pages.yml` compila, verifica y publica al subir cambios a `gh-pages`. Si el botón de ejecución manual no aparece porque el workflow está en una rama distinta de la predeterminada, iniciá el despliegue con un push a `gh-pages`.

## Contenido

- `src/pages/index.astro`: presentación, vista ilustrativa, funciones, privacidad y plataformas.
- `src/styles/global.css`: estilos responsivos y fuentes locales.
- `tailwind.config.mjs`: paleta y tipografía conservadas de la referencia.
- `public/`: logo, fuentes y sus licencias.

Las descargas enlazan a las publicaciones del proyecto, sin anunciar instaladores que aún no estén publicados. Los mensajes de la vista ilustrativa son datos de demostración.

## Licencia

El sitio conserva la [licencia MIT](LICENSE) de NamiO. Inter y JetBrains Mono se distribuyen bajo SIL OFL 1.1; Material Symbols, bajo Apache 2.0. Sus textos están en `public/licenses/`.

## Versión y descargas automáticas

Al abrir la página, se consulta la última release pública de `PinedaMB/NamiO`. La versión y los enlaces directos a AppImage, .deb y .exe se actualizan con los archivos publicados, sin reconstruir la página. No se usan credenciales en el navegador.

Publica una release estable y adjunta sus instaladores: aparecerán en la siguiente visita o al recargar. Los borradores y las versiones preliminares no se muestran. Si falta un instalador o GitHub no responde, se conserva el enlace a la release para consultar disponibilidad.

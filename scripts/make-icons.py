"""Genera los tamaños del logo a partir del master y reporta el bbox del contenido.

- build/icon.png  512x512  (icono de la app, con margen de seguridad)
- build/icon-1024.png      (master para electron-builder / futuros targets)
- src/renderer/src/assets/logo.png  256x256 (rail y marca en la UI)
"""

from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
source = root / "build" / "logo-source.png"
image = Image.open(source).convert("RGBA")

bbox = image.getbbox()
alpha = image.getchannel("A")
alpha_bbox = alpha.getbbox()
print(f"origen: {image.size[0]}x{image.size[1]} · bbox contenido: {alpha_bbox}")

# Recorte al contenido real (sin márgenes transparentes), con un respiro del 4 %.
content = image.crop(alpha_bbox) if alpha_bbox else image
pad = int(max(content.size) * 0.04)
side = max(content.size) + pad * 2
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(content, ((side - content.size[0]) // 2, (side - content.size[1]) // 2), content)


def render(size: int, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.resize((size, size), Image.LANCZOS).save(target, "PNG", optimize=True)
    print(f"{target.relative_to(root)}: {size}x{size} · {target.stat().st_size // 1024} kB")


render(1024, root / "build" / "icon-1024.png")
render(512, root / "build" / "icon.png")
render(256, root / "src" / "renderer" / "src" / "assets" / "logo.png")

"""Genera iconos y logo desde sus originales transparentes en build/ (requiere Pillow)."""

from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent


def render(source: str, outputs: list[tuple[int, str]]) -> None:
    image = Image.open(root / 'build' / source).convert('RGBA')
    bbox = image.getchannel('A').getbbox()
    assert bbox, f'{source}: imagen vacía'
    content = image.crop(bbox)
    pad = round(max(content.size) * 0.04)
    side = max(content.size) + pad * 2
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    # Copiar el alfa original evita oscurecer los bordes semitransparentes.
    canvas.paste(content, ((side - content.width) // 2, (side - content.height) // 2))
    for size, relative in outputs:
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        canvas.resize((size, size), Image.Resampling.LANCZOS).save(target, 'PNG', optimize=True)
        with Image.open(target) as result:
            assert result.size == (size, size) and result.getchannel('A').getextrema() == (0, 255)
        print(f'{relative}: {size}x{size} · {target.stat().st_size // 1024} kB')


render('icon-source.png', [(1024, 'build/icon-1024.png'), (512, 'build/icon.png')])
render('notification-source.png', [(256, 'build/notification.png')])
render('logo-source.png', [(256, 'src/renderer/src/assets/logo.png')])

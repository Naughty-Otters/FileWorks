#!/usr/bin/env python3
"""Rasterize the FileWorks blossom into favicon, app, and social icons."""

from __future__ import annotations

import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "icons"
APP = ROOT / "src" / "app"

CREAM = (243, 239, 230, 255)
TEAL = (15, 110, 86, 255)
TEAL_BRIGHT = (62, 207, 154, 255)
DARK = (13, 20, 17, 255)
INK = (28, 36, 32, 255)
MUTED = (90, 103, 95, 255)

MARK_R = 9.15
MARK_STROKE = 1.7
MARK_VIEW = 48
ANGLES = [0, 60, 120, 180, 240, 300]


def _font(size: int, serif: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        [
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/Library/Fonts/Georgia.ttf",
            "/System/Library/Fonts/NewYork.ttf",
        ]
        if serif
        else [
            "/System/Library/Fonts/SFNS.ttf",
            "/System/Library/Fonts/SFNSText.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_mark(canvas: Image.Image, cx: float, cy: float, scale: float, color: tuple[int, int, int, int]) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    r = MARK_R * scale
    sw = max(1, round(MARK_STROKE * scale))
    for deg in ANGLES:
        rad = math.radians(deg - 90)
        x = cx + math.cos(rad) * r
        y = cy + math.sin(rad) * r
        bbox = [x - r, y - r, x + r, y + r]
        draw.ellipse(bbox, outline=color, width=sw)
    canvas.alpha_composite(overlay)


def render_square(
    size: int,
    *,
    background: tuple[int, int, int, int] | None,
    color: tuple[int, int, int, int],
    pad: float,
    radius_ratio: float = 0.22,
    supersample: int = 4,
) -> Image.Image:
    s = size * supersample
    img = Image.new("RGBA", (s, s), background if background else (0, 0, 0, 0))
    if background and radius_ratio > 0:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=round(s * radius_ratio), fill=255)
        filled = Image.new("RGBA", (s, s), background)
        rounded = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        rounded.paste(filled, mask=mask)
        img = rounded
    inner = s * (1 - 2 * pad)
    scale = inner / MARK_VIEW
    draw_mark(img, s / 2, s / 2, scale, color)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def render_og(width: int = 1200, height: int = 630) -> Image.Image:
    img = Image.new("RGBA", (width, height), CREAM)
    mark_box = 320
    mark = render_square(mark_box, background=None, color=TEAL, pad=0.02, radius_ratio=0, supersample=3)
    img.alpha_composite(mark, (96, (height - mark_box) // 2))
    draw = ImageDraw.Draw(img)
    title = _font(72, serif=True)
    sub = _font(32, serif=False)
    url = _font(24, serif=False)
    x = 96 + mark_box + 48
    draw.text((x, 210), "FileWorks", font=title, fill=INK)
    draw.text((x, 310), "Convert any format", font=sub, fill=MUTED)
    draw.text((x, 370), "fileworks.ai", font=url, fill=TEAL)
    return img


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    print(f"wrote {path.relative_to(ROOT)}")


def main() -> None:
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    PUBLIC.mkdir(parents=True)

    variants = {
        "favicon-16.png": render_square(16, background=None, color=TEAL, pad=0.04, radius_ratio=0),
        "favicon-32.png": render_square(32, background=None, color=TEAL, pad=0.04, radius_ratio=0),
        "favicon-48.png": render_square(48, background=None, color=TEAL, pad=0.04, radius_ratio=0),
        "apple-touch-icon.png": render_square(180, background=CREAM, color=TEAL, pad=0.16, radius_ratio=0.22),
        "icon-192.png": render_square(192, background=CREAM, color=TEAL, pad=0.16, radius_ratio=0.22),
        "icon-512.png": render_square(512, background=CREAM, color=TEAL, pad=0.16, radius_ratio=0.22),
        "icon-512-maskable.png": render_square(512, background=CREAM, color=TEAL, pad=0.22, radius_ratio=0),
        "icon-512-dark.png": render_square(512, background=DARK, color=TEAL_BRIGHT, pad=0.16, radius_ratio=0.22),
        "mstile-150.png": render_square(150, background=CREAM, color=TEAL, pad=0.16, radius_ratio=0),
    }
    for name, image in variants.items():
        save(image, PUBLIC / name)

    ico_path = ROOT / "src" / "app" / "favicon.ico"
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    variants["favicon-48.png"].save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    shutil.copy2(ico_path, ROOT / "public" / "favicon.ico")
    print("wrote src/app/favicon.ico")

    apple = variants["apple-touch-icon.png"]
    save(apple, APP / "apple-icon.png")
    og = render_og()
    save(og, APP / "opengraph-image.png")
    save(og, APP / "twitter-image.png")
    save(og, PUBLIC / "og.png")

    svg = APP / "apple-icon.svg"
    if svg.exists():
        svg.unlink()
        print("removed src/app/apple-icon.svg")


if __name__ == "__main__":
    main()

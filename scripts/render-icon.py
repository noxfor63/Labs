#!/usr/bin/env python3
"""
Отрисовка SVG в PNG через headless Chromium.

Размер третьим аргументом: «1024» для квадрата, «1590x400» для баннера.

Зачем свой скрипт: в окружении нет ни rsvg-convert, ни ImageMagick, ни
Pillow. Chromium снимает кадр размером с окно, а вьюпорт меньше окна на
постоянную величину, поэтому снимок берётся с запасом по высоте и потом
обрезается до квадрата — разбором PNG на стандартном zlib.
"""
import struct
import subprocess
import sys
import zlib
from pathlib import Path

CHROME = "/opt/pw-browsers/chromium"
# Разница между высотой окна и высотой вьюпорта в этой сборке Chromium.
CHROME_VIEWPORT_OFFSET = 88


def read_png(data: bytes) -> tuple[int, int, int, list[bytearray]]:
    """Возвращает (ширина, высота, байт на пиксель, распакованные строки)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "это не PNG"
    pos, idat, width, height, channels = 8, bytearray(), 0, 0, 0
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
            assert depth == 8, f"поддерживается только 8 бит на канал, тут {depth}"
            channels = {0: 1, 2: 3, 4: 2, 6: 4}[colour]
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + length

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    rows: list[bytearray] = []
    previous = bytearray(stride)
    at = 0
    for _ in range(height):
        filter_type = raw[at]
        line = bytearray(raw[at + 1 : at + 1 + stride])
        at += 1 + stride
        # Обратные фильтры PNG, спецификация RFC 2083, раздел 6.
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = previous[i]
            c = previous[i - channels] if i >= channels else 0
            if filter_type == 1:
                line[i] = (line[i] + a) & 0xFF
            elif filter_type == 2:
                line[i] = (line[i] + b) & 0xFF
            elif filter_type == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif filter_type == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        rows.append(line)
        previous = line
    return width, height, channels, rows


def write_png(path: Path, width: int, rows: list[bytearray], channels: int) -> None:
    colour = {1: 0, 2: 4, 3: 2, 4: 6}[channels]
    raw = bytearray()
    for line in rows:
        raw.append(0)  # фильтр None: картинка небольшая, сжатие и так хорошее
        raw += line

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, len(rows), 8, colour, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def parse_size(raw: str) -> tuple[int, int]:
    """«1024» → квадрат, «1590x400» → прямоугольник."""
    if "x" in raw:
        width, height = raw.split("x", 1)
        return int(width), int(height)
    side = int(raw)
    return side, side


def main() -> int:
    svg = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    want_width, want_height = parse_size(sys.argv[3]) if len(sys.argv) > 3 else (1024, 1024)

    page = svg.with_name("_render.html")
    page.write_text(
        "<!doctype html><meta charset='utf-8'>"
        "<style>html,body{margin:0;padding:0}"
        f"img{{position:fixed;top:0;left:0;width:{want_width}px;height:{want_height}px;display:block}}</style>"
        f"<img src='{svg.name}'>",
        encoding="utf-8",
    )
    shot = out.with_suffix(".raw.png")
    try:
        subprocess.run(
            [
                CHROME, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                f"--screenshot={shot}",
                f"--window-size={want_width},{want_height + CHROME_VIEWPORT_OFFSET}",
                page.as_uri(),
            ],
            check=True, capture_output=True,
        )
        width, height, channels, rows = read_png(shot.read_bytes())
        if width != want_width or height < want_height:
            print(f"неожиданный снимок {width}x{height}", file=sys.stderr)
            return 1
        write_png(out, width, rows[:want_height], channels)
    finally:
        page.unlink(missing_ok=True)
        shot.unlink(missing_ok=True)

    print(f"{out} — {want_width}x{want_height}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

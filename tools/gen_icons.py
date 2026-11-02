#!/usr/bin/env python3
"""生成插件图标(纯 stdlib,无第三方依赖)。

设计:红色圆角方块背景 + 白色"录制"圆点(经典 REC 按钮)。
"""
import zlib
import struct
from pathlib import Path

ICON_DIR = Path(__file__).resolve().parent.parent / "icons"
BG = (217, 48, 37, 255)      # #d93025 红
FG = (255, 255, 255, 255)    # 白


def rounded_rect_mask(x, y, w, h, radius):
    """点 (x, y) 是否在圆角矩形内(左上角为原点)。"""
    cx = min(max(x, radius), w - radius)
    cy = min(max(y, radius), h - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def gen(size):
    buf = bytearray()
    cx = cy = size / 2.0
    corner = size * 0.22          # 圆角半径
    dot_r = size * 0.26           # 中心实心圆半径
    for y in range(size):
        buf.append(0)  # PNG 行过滤器:None
        for x in range(size):
            inside = rounded_rect_mask(x + 0.5, y + 0.5, size, size, corner)
            if inside:
                dist = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
                buf += bytes(FG if dist <= dot_r else BG)
            else:
                buf += bytes((0, 0, 0, 0))
    return bytes(buf)


def write_png(path, size, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"wrote {path} ({size}x{size}, {path.stat().st_size} bytes)")


def main():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(ICON_DIR / f"icon{s}.png", s, gen(s))


if __name__ == "__main__":
    main()

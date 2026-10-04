#!/usr/bin/env python3
"""img_compress.py IN OUT MAXW MAXKB  -> writes WebP <= MAXKB (first frame of animated inputs)."""
import sys, os
try:
    from PIL import Image
except Exception:
    sys.exit(3)
src, dst, maxw, maxkb = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src)
try:
    im.seek(0)
except Exception:
    pass
if im.mode in ("RGBA", "LA", "P"):
    bg = Image.new("RGB", im.size, (255, 255, 255))
    im = im.convert("RGBA"); bg.paste(im, mask=im.split()[-1]); im = bg
else:
    im = im.convert("RGB")
w = min(maxw, im.width)
while True:
    h = round(im.height * w / im.width)
    cur = im.resize((w, h), Image.LANCZOS) if w != im.width else im
    for q in (82, 74, 66, 58, 50, 42):
        cur.save(dst, "WEBP", quality=q, method=6)
        if os.path.getsize(dst) <= maxkb * 1024:
            print(os.path.getsize(dst), w, h); sys.exit(0)
    if w <= 320:
        print(os.path.getsize(dst), w, h); sys.exit(0)
    w = int(w * 0.85)

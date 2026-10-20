"""Pixel-exact re-pack of the 20-frame 1133x433 select-screen strips (22660 px wide, too wide for
WebGL max texture size) into a 3-column grid (<=4096 px). No resampling: frames are copied 1:1."""
from PIL import Image
import os
SRC = 'public/assets/select'
COLS = 3
for name in ['car34_bounce_body_sheet', 'car34_bounce_rear_engine_sheet', 'car34_bounce_front_gear_sheet', 'seek_car_placeholder_sheet']:
    im = Image.open(f'{SRC}/{name}.png')
    im.load()
    fw, fh, n = 1133, 433, 20
    assert im.size == (fw * n, fh), im.size
    rows = (n + COLS - 1) // COLS
    out = Image.new(im.mode, (fw * COLS, fh * rows), (0, 0, 0, 0) if im.mode == 'RGBA' else 0)
    for i in range(n):
        fr = im.crop((i * fw, 0, (i + 1) * fw, fh))
        out.paste(fr, ((i % COLS) * fw, (i // COLS) * fh))
    os.makedirs(f'{SRC}/grid', exist_ok=True)
    out.save(f'{SRC}/grid/{name}_grid.png', optimize=True)
    # verify exactness
    chk = Image.open(f'{SRC}/grid/{name}_grid.png').convert(im.mode)
    for i in range(n):
        a = im.crop((i * fw, 0, (i + 1) * fw, fh)).tobytes()
        b = chk.crop(((i % COLS) * fw, (i // COLS) * fh, (i % COLS + 1) * fw, (i // COLS + 1) * fh)).tobytes()
        assert a == b
    print(name, im.mode, out.size, 'exact')

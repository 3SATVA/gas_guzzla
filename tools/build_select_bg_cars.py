"""Half-size background cars for the side-by-side select screen.
Source: the approved 1:1 bounce layers (Fade: original strips, Seek: 1:1 regrid of the approved front34 layers).
Per frame: composite body -> rear_engine -> front_gear (approved order), pad to even size, 2x2 box reduce in
premultiplied alpha (exact 1/2, no fractional resampling), pack 5x4. Characters are never touched."""
from PIL import Image
import numpy as np, json
S = 'public/assets/select/'
def frames_strip(path, fw, fh, n):
    im = Image.open(path).convert('RGBA'); return [im.crop((i*fw, 0, (i+1)*fw, fh)) for i in range(n)]
def frames_grid(path, fw, fh, n, cols=3):
    im = Image.open(path).convert('RGBA'); return [im.crop(((i%cols)*fw, (i//cols)*fh, (i%cols+1)*fw, (i//cols+1)*fh)) for i in range(n)]
def half(im):
    a = np.array(im).astype(np.float64); h, w = a.shape[:2]
    a = np.pad(a, ((0, h % 2), (0, w % 2), (0, 0)))
    al = a[..., 3:4] / 255.0; rgb = a[..., :3] * al
    r = lambda x: (x[0::2, 0::2] + x[1::2, 0::2] + x[0::2, 1::2] + x[1::2, 1::2]) / 4
    rgb2, al2 = r(rgb), r(al)
    out = np.where(al2 > 0, rgb2 / np.maximum(al2, 1e-6), 0)
    return Image.fromarray(np.concatenate([out, al2 * 255], -1).round().clip(0, 255).astype(np.uint8))
meta = {}
for name, layers, loader, fw, fh in [
    ('fade', [S+'car34_bounce_body_sheet.png', S+'car34_bounce_rear_engine_sheet.png', S+'car34_bounce_front_gear_sheet.png'], frames_strip, 1133, 433),
    ('seek', [S+'grid/seek_car34_bounce_body_sheet_grid.png', S+'grid/seek_car34_bounce_rear_engine_sheet_grid.png', S+'grid/seek_car34_bounce_front_gear_sheet_grid.png'], frames_grid, 1205, 523)]:
    L = [loader(p, fw, fh, 20) for p in layers]
    out = []
    for i in range(20):
        c = L[0][i].copy(); c.alpha_composite(L[1][i]); c.alpha_composite(L[2][i]); out.append(half(c))
    w, h = out[0].size; sheet = Image.new('RGBA', (w*5, h*4))
    for i, f in enumerate(out): sheet.paste(f, ((i%5)*w, (i//5)*h))
    sheet.save(S + f'v2/{name}_car_half_sheet.png', optimize=True)
    bb = out[0].getbbox(); meta[name] = {'frame': [w, h], 'frames': 20, 'cols': 5, 'bbox_f0': bb}
    print(name, w, h, bb)
json.dump(meta, open(S + 'v2/car_half.json', 'w'), indent=1)

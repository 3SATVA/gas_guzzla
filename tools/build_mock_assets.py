"""Pack the Seek mock-level art into public/assets/mock/ (pixel exact, no resampling).

  seek/<full|lite>/  atlas of the always-needed clips (idle_a, walk_loop, guard, pocket, cam + fwd spray) holding ONLY the unique frames Michael kept in his Premiere edit (tools/seek_edl.py); reverse / ping-pong / freeze are frame-key lists in clips.json
                     (frames, fps, loop, anchor, and the can-nozzle 'tip' per frame for the spray clips).
                     lite = every 2nd frame of the 24 fps clips (phones, about half the GPU memory).
  seek_wall/<full|lite>/ the graffiti clips built from his kept segments (turn_to_wall, wall_shake, wall_squat_dn/hold/up, wall_spray_mid, turn_away_toss): about half of Seek's street memory, so the game
                     loads it in the background only while a wall is near and unloads it after the tag
  seek_fwd/<full|lite>/  just the 3 forward-spray clips (the fight scene loads this instead of the whole street atlas)
  props/             camera (angle, ledoff, smash, broken) and CYLO drone (hover, hit, destroy) atlas + props.json
  tags/              the approved SEEK tags (seek_throwup_mike, seek_3d_v3), copied unchanged
  wall_panel.png     blank dirty concrete panel the tags are sprayed on (placeholder art, procedural)
"""
import json, os, hashlib, shutil, sys
import numpy as np
from PIL import Image
import rectpack

B = '/workspace/gasguzla/brawler/v1'
S4 = B + '/seek_sprites_v4'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'mock')
PAGE = 2048


def trim(path):
    a = np.array(Image.open(path).convert('RGBA'))
    ys, xs = np.nonzero(a[..., 3])
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    c = a[y0:y1, x0:x1].copy(); c[c[..., 3] == 0] = 0
    return dict(px=c, off=(int(x0), int(y0)), src=(a.shape[1], a.shape[0]), full=a)


def pack(imgs, od, name):
    """imgs: key -> trimmed dict. writes od/atlas.json + pages; returns gpu MB"""
    os.makedirs(od, exist_ok=True)
    items = list(imgs.items())
    packer = rectpack.newPacker(rotation=False, pack_algo=rectpack.MaxRectsBssf, sort_algo=rectpack.SORT_AREA)
    for i, (k, t) in enumerate(items):
        h, w = t['px'].shape[:2]; packer.add_rect(w + 2, h + 2, rid=i)
    for _ in range(60): packer.add_bin(PAGE, PAGE)
    packer.pack()
    pages = {}
    for b, x, y, w, h, rid in packer.rect_list(): pages.setdefault(b, []).append((x, y, rid))
    assert sum(len(v) for v in pages.values()) == len(items)
    textures, tot = [], 0
    for pi, (b, lst) in enumerate(sorted(pages.items())):
        W = max(x + items[r][1]['px'].shape[1] + 2 for x, y, r in lst); H = max(y + items[r][1]['px'].shape[0] + 2 for x, y, r in lst)
        W, H = (W + 3) // 4 * 4, (H + 3) // 4 * 4
        page = np.zeros((H, W, 4), np.uint8); fr = []
        for x, y, r in lst:
            k, t = items[r]; h, w = t['px'].shape[:2]
            page[y + 1:y + 1 + h, x + 1:x + 1 + w] = t['px']
            fr.append(dict(filename=k, frame=dict(x=x + 1, y=y + 1, w=w, h=h), rotated=False, trimmed=True,
                           spriteSourceSize=dict(x=t['off'][0], y=t['off'][1], w=w, h=h), sourceSize=dict(w=t['src'][0], h=t['src'][1])))
        fn = f'{name}_{pi}.png'; Image.fromarray(page).save(f'{od}/{fn}', optimize=True)
        textures.append(dict(image=fn, format='RGBA8888', size=dict(w=W, h=H), scale=1, frames=fr)); tot += W * H
    json.dump(dict(textures=textures, meta=dict(app='build_mock_assets.py')), open(f'{od}/atlas.json', 'w'))
    return round(tot * 4 / 1e6, 1)


def tip_of(a, mode):
    al = a[..., 3] > 0
    ys, xs = np.nonzero(al)
    if mode == 'right':   # can lying on its side / arm outstretched to the right: furthest right pixels
        xm = xs.max(); sel = xs >= xm - 3; return [int(xm), int(ys[sel].mean())]
    if mode == 'up':      # can held up: top-most pixels
        ym = ys.min(); sel = ys <= ym + 3; return [int(xs[sel].mean()), int(ym)]
    if mode == 'can':     # long squat spray (back view, can in her right hand = screen right): warm skin/can pixels; the can is the highest point when the arm is overhead, else the furthest right
        rgb = a[..., :3].astype(int)
        hair = al & (rgb[..., 1] > rgb[..., 0] + 25)         # the teal braids
        hy = np.nonzero(hair)[0].min() if hair.any() else ys.min()
        lo = ys > ys.min() + 0.55 * (ys.max() - ys.min())
        cxb = float(xs[lo].mean()) if lo.any() else float(xs.mean())     # body centre from the legs
        over = ys < hy - 6
        if over.any() and (xs[over] > cxb - 25).any():       # arm overhead: the can is the highest thing
            k = over & (xs > cxb - 25); ym = ys[k].min(); sel = k & (ys <= ym + 4)
            return [int(xs[sel].mean()), int(ym)]
        xm = xs.max(); sel = xs >= xm - 4                     # otherwise the hand/can is the furthest right pixel of her
        return [int(xs[sel].mean()), int(ys[sel].mean())]
    return None


def smooth_tips(tips, k=2):
    """5-frame median over the per-frame detections, so a stray pixel cluster can't throw the nozzle across the body"""
    out = []
    for i in range(len(tips)):
        w = [t for t in tips[max(0, i - k): i + k + 1] if t]
        out.append([int(np.median([t[0] for t in w])), int(np.median([t[1] for t in w]))] if w else None)
    return out


TIP = {'cam_spray_raise': 'up', 'fwd_spray_raise': 'right', 'turn_to_wall': 'right', 'wall_spray_long': 'can'}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seek_edl import KEEP, PLAY, WALL, FWD   # noqa: E402  (Michael's Premiere edit: only kept frames are packed; playback order lives in clips.json)


def playback(base, mode):
    """positions into the kept source frames -> the frame order a clip plays (keys may repeat: reverse / ping-pong cost no textures)"""
    b = list(base)
    if mode == 'fwd' or mode == 'hold': return b
    if mode == 'rev': return b[::-1]
    if mode == 'pp': return b + b[-2:0:-1]
    if mode == 'shake': return b + b[-2::-1] + b[1:]
    raise ValueError(mode)


def build_seek(mode, names, sub='seek'):
    man = json.load(open(S4 + '/manifest.json'))['clips']
    imgs, cache, clips, smooth = {}, {}, {}, {}
    def frame(src, i):
        p = man[src]['files'][i]; p = f'{S4}/{p}' if not p.startswith('/') else p
        if p not in cache:
            t = trim(p); h = hashlib.sha1(t['px'].tobytes() + repr((t['off'], t['px'].shape)).encode()).hexdigest()
            if h not in imgs: imgs[h] = (f'f{len(imgs):04d}', t)
            cache[p] = (imgs[h][0], t['full'])
        return cache[p][0]
    def tip(src, i):
        if src not in TIP: return None
        if src == 'wall_spray_long':          # smoothed over the ORIGINAL contiguous frames, then picked
            if src not in smooth:
                raws = []
                for j in range(len(man[src]['files'])):
                    frame(src, j); p = man[src]['files'][j]; p = f'{S4}/{p}' if not p.startswith('/') else p
                    raws.append(tip_of(cache[p][1], 'can'))
                smooth[src] = smooth_tips(raws)
            return smooth[src][i]
        frame(src, i); p = man[src]['files'][i]; p = f'{S4}/{p}' if not p.startswith('/') else p
        return tip_of(cache[p][1], TIP[src])
    for name in names:
        sp = PLAY[name]; src = sp['src']; c = man[src]
        base = list(sp['base']); fps = sp['fps'] or c['fps']
        if mode == 'lite' and fps >= 20 and len(base) > 20:
            base = base[::2] + ([base[-1]] if (len(base) - 1) % 2 else []); fps = fps / 2
        seq = playback(base, sp['mode'])
        clips[name] = dict(frames=[frame(src, i) for i in seq], fps=fps, loop=sp['loop'], anchor=c['anchor'], canvas=c['canvas'],
                           tips=[tip(src, i) for i in seq] if src in TIP else None)
    od = f'{OUT}/{sub}/{mode}'
    shutil.rmtree(od, ignore_errors=True)
    used = {k for cl in clips.values() for k in cl['frames']}
    mb = pack({k: t for k, t in imgs.values() if k in used}, od, 'mlwall' if sub == 'seek_wall' else 'mlseek')
    json.dump(dict(clips=clips, gpu_mb=mb), open(f'{od}/clips.json', 'w'))
    print(sub, mode, 'unique frames', len(used), 'GPU MB', mb)


def build_props():
    cm = json.load(open(B + '/camera/meta.json')); dm = json.load(open(B + '/drone/meta.json'))
    imgs, props = {}, {}
    def add(group, key, d, files, anchor, fps_ms, loop):
        ks = []
        for f in files:
            k = f[:-4]
            imgs[k] = trim(d + '/' + f); ks.append(k)
        props[key] = dict(frames=ks, anchor=anchor, ms=fps_ms, loop=loop)
    cam_a = cm['anchor']['mount']
    for g, key, ms, loop in [('angle', 'cam_angle', 50, False), ('angle_off', 'cam_ledoff', 50, False), ('smash', 'cam_smash', 50, False), ('broken', 'cam_broken', 120, True)]:
        add(g, key, B + '/camera/frames', [x['file'] for x in cm['groups'][g]], cam_a, ms, loop)
    for g in ('hover', 'hit', 'destroy'):
        v = dm['groups'][g]; add(g, 'drone_' + g, B + '/drone/frames', [x['file'] for x in v['frames']], v['anchor'], v['ms_per_frame'], v['loop'])
    od = OUT + '/props'; shutil.rmtree(od, ignore_errors=True)
    mb = pack(imgs, od, 'mlprops'); json.dump(dict(props=props, gpu_mb=mb), open(od + '/props.json', 'w'))
    print('props GPU MB', mb)


def wall_panel():
    """blank plastered / concrete wall: smooth low-contrast grain, panel seams, a light top ledge, soot toward the street"""
    rng = np.random.default_rng(7)
    W, H = 1040, 460
    base = np.zeros((H, W, 3), np.float32); base[:] = (118, 108, 98)
    for sc, amp in [(64, 7), (16, 5), (4, 3.5), (1, 4)]:
        n = rng.normal(0, amp, (H // sc + 1, W // sc + 1, 1)).astype(np.float32)
        n = np.kron(n, np.ones((sc, sc, 1), np.float32))[:H, :W]; base += n
    yy = np.linspace(0, 1, H)[:, None, None]
    base *= (1.06 - 0.28 * yy)
    img = np.clip(base, 0, 255).astype(np.uint8)
    for x in range(208, W, 208): img[:, x:x + 2] = (70, 64, 58); img[:, x + 2:x + 3] = (146, 136, 124)
    for y in (115, 230, 345): img[y:y + 2] = (74, 68, 62); img[y + 2:y + 3] = (140, 130, 120)
    img[:10] = (150, 140, 128); img[10:14] = (60, 55, 50)           # top ledge + shadow line
    img[-8:] = (40, 37, 34); img[:, :4] = (58, 53, 48); img[:, -4:] = (58, 53, 48)
    for _ in range(40):                                             # rain streaks
        x = int(rng.integers(8, W - 8)); l = int(rng.integers(30, 220)); y0 = int(rng.integers(14, H - l))
        img[y0:y0 + l, x] = (img[y0:y0 + l, x] * 0.82).astype(np.uint8)
    a = np.full((H, W, 1), 255, np.uint8)
    Image.fromarray(np.concatenate([img, a], 2)).save(OUT + '/wall_panel.png', optimize=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    if '--wall-only' not in __import__('sys').argv:
        for m in ('full', 'lite'):
            build_seek(m, [n for n in PLAY if n not in WALL])
            build_seek(m, list(WALL), sub='seek_wall')
            build_seek(m, list(FWD), sub='seek_fwd')   # the FIGHT scene only needs the forward spray
        build_props()
    os.makedirs(OUT + '/tags', exist_ok=True)
    for t in ('seek_throwup_mike', 'seek_3d_v3'):
        shutil.copy(f'{B}/tags_v2/{t}/{t}.png', f'{OUT}/tags/{t}.png')
    wall_panel()

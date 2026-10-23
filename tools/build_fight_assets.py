"""Pack the approved fight assets into public/assets/fight/ (pixel exact, no resampling).

Per fighter: every move frame is trimmed to its alpha bbox, identical frames are deduped,
and the frames are packed into 2048x2048 Phaser multiatlas pages (rectpack MaxRects).
Two sets are written:
  full/  every frame (desktop)
  lite/  phones: pairs of neighbouring non-active, non-hold frames merged (ticks summed, root motion summed),
         about half the texture memory. Active (hitbox) frames, hold frames and frame 0 of every move are kept.
moves.json holds the per-frame timing, anchor-relative hit/hurtboxes, invulnerability, walk advance and get-up end_dx.
Also copies stage v6, wind v2, bags, and splits the select v2 idles into even/odd half sheets.
"""
import json, os, hashlib, shutil, sys
import numpy as np
from PIL import Image
import rectpack

FT = '/workspace/gasguzla/fight'
SEL = '/workspace/gasguzla/select/v2'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'fight')
PAGE = 2048

CHARS = {
    'fade': {'dir': FT + '/fade/v4', 'moves': {
        'idle': 'idle', 'walk_fwd': ('walk', 'walk_fwd'), 'walk_back': ('walk', 'walk_back'), 'jab': 'jab', 'kick': 'kick',
        'crouch': 'crouch', 'block': 'block', 'hit': 'hit', 'knockdown': 'knockdown', 'getup': 'getup'}},
    'seek': {'dir': FT + '/seek/v3', 'moves': {
        'idle': ('idle', 'idle'), 'walk_fwd': ('walk2', 'walk_fwd'), 'walk_back': ('walk2', 'walk_back'), 'kick_b': ('kick_b', 'kick'),
        'kick': ('kick', 'kick'), 'crouch': 'crouch', 'block': 'block', 'hit': 'hit', 'knockdown': 'knockdown', 'getup': 'getup'}},
    'cylo': {'dir': FT + '/cylobot/v1', 'moves': {
        'idle': 'idle', 'walk_fwd': ('walk', 'walk_fwd'), 'walk_back': ('walk', 'walk_back'), 'punch': 'punch',
        'hit': 'hit', 'knockdown': 'knockdown', 'getup': 'getup'}},
}


def load_move(cdir, spec):
    mv, anim = (spec, None) if isinstance(spec, str) else spec
    d = f'{cdir}/{mv}'
    m = json.load(open(d + '/meta.json'))
    fdir, sdir = d + '/frames', d + '/smoke'
    if 'frames' in m and anim is None:
        frames = m['frames']
    else:
        a = m['anims'][anim]
        frames = a['frames']
        if a.get('dir'):
            fdir = d + '/' + a['dir']
            sdir = os.path.dirname(fdir) + '/smoke'
    default_ticks = 3
    if 'phaser_ticks_at_60' in m:
        pt = m['phaser_ticks_at_60']
    else:
        pt = None
    out = []
    for i, f in enumerate(frames):
        t = f.get('ticks') or (pt[i] if pt else default_ticks)
        img = fdir + '/' + f['file']
        sm = (sdir + '/' + f['smoke']) if f.get('smoke') and os.path.exists(sdir + '/' + f['smoke']) else None
        if 'hurtbox' in f:
            hu = f['hurtbox']
        else:
            hu = f.get('bbox')
        if f.get('invulnerable'):
            hu = None
        out.append(dict(img=img, smoke=sm, ticks=int(t), hitbox=f.get('hitbox') if f.get('active', True) else None,
                        hurtbox=hu, inv=bool(f.get('invulnerable', False)), adv=f.get('advance_px', 0),
                        state=f.get('state') or f.get('segment') or f.get('seg') or f.get('phase'),
                        bcx=f.get('body_center_dx', 0), air=bool(f.get('airborne', False))))
    if not m.get('anchor'):
        raise SystemExit(f'no anchor in {d}')
    hold = m.get('hold_frame_index', m.get('hold_frame'))
    rm = m.get('root_motion', {})
    join = m.get('idle_join', {}) if isinstance(m.get('idle_join'), dict) else {}
    return dict(frames=out, anchor=m['anchor'], canvas=m['canvas'], hold=int(hold) if hold is not None else None,
                hold_loop=m.get('hold_loop_frames'), end_dx=rm.get('end_dx', 0) if isinstance(rm, dict) else 0,
                exit_idle=join.get('exit_to_idle_frame'), enter_idle=join.get('enter_from_idle_frame'),
                loop=bool(m.get('loop', False)) or mv.startswith('walk') or mv == 'idle')


def trim(path):
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    ys, xs = np.nonzero(a[..., 3])
    if len(xs) == 0:
        return None
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    crop = a[y0:y1, x0:x1].copy()
    crop[crop[..., 3] == 0] = 0
    return dict(px=crop, off=(int(x0), int(y0)), src=(im.width, im.height))


def lite_frames(mv):
    """merge pairs of neighbouring frames that are both inactive / not hold / same state."""
    fr = mv['frames']
    keep_hold = set()
    if mv['hold'] is not None:
        keep_hold.add(mv['hold'])
    out, mapping = [], {}
    i = 0
    while i < len(fr):
        f = dict(fr[i])
        mapping[i] = len(out)
        can = (i + 1 < len(fr) and i != 0 and f['hitbox'] is None and fr[i + 1]['hitbox'] is None
               and i not in keep_hold and (i + 1) not in keep_hold and fr[i + 1]['state'] == f['state']
               and fr[i + 1]['inv'] == f['inv'] and i + 1 != len(fr) - 1)
        if can:
            g = fr[i + 1]
            f['ticks'] += g['ticks']
            f['adv'] += g['adv']
            mapping[i + 1] = len(out)
            i += 2
        else:
            i += 1
        out.append(f)
    return out, mapping


def build_char(name, spec, mode):
    moves = {k: load_move(spec['dir'], v) for k, v in spec['moves'].items()}
    imgs = {}   # hash -> (key, trimmed)
    cache = {}
    def key_for(path, prefix):
        if path in cache:
            return cache[path]
        t = trim(path)
        if t is None:
            cache[path] = None
            return None
        h = hashlib.sha1(t['px'].tobytes() + repr((t['off'], t['src'], t['px'].shape)).encode()).hexdigest()
        if h not in imgs:
            imgs[h] = (f'{prefix}{len(imgs):03d}', t)
        cache[path] = imgs[h][0]
        return cache[path]
    mj = {}
    for mn, mv in moves.items():
        frames, mapping = (lite_frames(mv) if mode == 'lite' else (mv['frames'], {i: i for i in range(len(mv['frames']))}))
        ax, ay = mv['anchor']
        def rel(b):
            return None if not b else [int(b[0] - ax), int(b[1] - ay), int(b[2] - ax), int(b[3] - ay)]
        fl = []
        for f in frames:
            k = key_for(f['img'], 'f')
            sk = key_for(f['smoke'], 's') if f['smoke'] else None
            fl.append(dict(k=k, sk=sk, t=f['ticks'], hb=rel(f['hitbox']), hu=rel(f['hurtbox']), inv=f['inv'], adv=f['adv'],
                           st=f['state'], bcx=f['bcx'], air=f['air']))
        mj[mn] = dict(anchor=mv['anchor'], canvas=mv['canvas'], loop=mv['loop'], end_dx=mv['end_dx'],
                      hold=mapping.get(mv['hold']) if mv['hold'] is not None else None,
                      exit_idle=mv['exit_idle'], enter_idle=mv['enter_idle'], frames=fl)
    # idle frame indices referenced by exit_idle must be mapped into the (lite) idle list
    if mode == 'lite':
        _, imap = lite_frames(moves['idle'])
        for mn in mj:
            if mj[mn]['exit_idle'] is not None:
                mj[mn]['exit_idle'] = imap.get(mj[mn]['exit_idle'], 0)
    # pack
    items = list(imgs.values())
    packer = rectpack.newPacker(rotation=False, pack_algo=rectpack.MaxRectsBssf, sort_algo=rectpack.SORT_AREA)
    for i, (k, t) in enumerate(items):
        h, w = t['px'].shape[:2]
        packer.add_rect(w + 2, h + 2, rid=i)
    for _ in range(40):
        packer.add_bin(PAGE, PAGE)
    packer.pack()
    pages = {}
    placed = 0
    for b, x, y, w, h, rid in packer.rect_list():
        pages.setdefault(b, []).append((x, y, rid))
        placed += 1
    assert placed == len(items), (placed, len(items))
    od = f'{OUT}/{name}/{mode}'
    shutil.rmtree(od, ignore_errors=True)
    os.makedirs(od)
    textures = []
    total_px = 0
    for pi, (b, lst) in enumerate(sorted(pages.items())):
        W = max(x + items[r][1]['px'].shape[1] + 2 for x, y, r in lst)
        H = max(y + items[r][1]['px'].shape[0] + 2 for x, y, r in lst)
        W, H = (W + 3) // 4 * 4, (H + 3) // 4 * 4
        page = np.zeros((H, W, 4), np.uint8)
        frames = []
        for x, y, r in lst:
            k, t = items[r]
            h, w = t['px'].shape[:2]
            page[y + 1:y + 1 + h, x + 1:x + 1 + w] = t['px']
            frames.append(dict(filename=k, frame=dict(x=x + 1, y=y + 1, w=w, h=h), rotated=False, trimmed=True,
                               spriteSourceSize=dict(x=t['off'][0], y=t['off'][1], w=w, h=h),
                               sourceSize=dict(w=t['src'][0], h=t['src'][1])))
        fn = f'{name}_{pi}.png'
        Image.fromarray(page).save(f'{od}/{fn}', optimize=True)
        textures.append(dict(image=fn, format='RGBA8888', size=dict(w=W, h=H), scale=1, frames=frames))
        total_px += W * H
    json.dump(dict(textures=textures, meta=dict(app='build_fight_assets.py')), open(f'{od}/atlas.json', 'w'))
    json.dump(dict(fighter=name, moves=mj, gpu_mb=round(total_px * 4 / 1e6, 1)), open(f'{od}/moves.json', 'w'))
    print(name, mode, 'frames', len(items), 'pages', len(textures), 'GPU MB', round(total_px * 4 / 1e6, 1))


def copy_fx():
    W = FT + '/stage/wind/out'
    d = OUT + '/stage'
    os.makedirs(d, exist_ok=True)
    shutil.copy(FT + '/stage/v6/alley_v6.png', d)
    shutil.copy(FT + '/stage/v6/stage_v6.json', d)
    shutil.copy(W + '/wind/wind_spec.json', d)
    shutil.copy(W + '/bags/bag_spawner_spec.json', d)
    shutil.copy(W + '/bags/bags_meta.json', d)
    for f in ['wind_far.png', 'wind_mid.png', 'wind_near.png']:
        shutil.copy(W + '/wind/' + f, d)
    for i in range(6):
        shutil.copy(f'{W}/wind/streaks/streak{i}_sheet_2x.png', d)
    for b in range(4):
        for t in 'SMLX':
            tier = 'XL' if t == 'X' else t
            shutil.copy(f'{W}/bags/bag{b}_{tier}_sheet.png', d)


def select_halves():
    d = OUT + '/../select/v2'
    os.makedirs(d, exist_ok=True)
    info = {}
    for c in ['fade', 'seek']:
        m = json.load(open(f'{SEL}/{c}/meta.json'))
        fs = sorted(f for f in os.listdir(f'{SEL}/{c}/frames') if f.endswith('.png'))
        assert len(fs) == m['frames'], (c, len(fs))
        cw, ch = m['canvas']
        for half, sl in (('a', fs[0::2]), ('b', fs[1::2])):
            cols = 6
            rows = (len(sl) + cols - 1) // cols
            sheet = Image.new('RGBA', (cols * cw, rows * ch), (0, 0, 0, 0))
            for i, f in enumerate(sl):
                im = Image.open(f'{SEL}/{c}/frames/{f}').convert('RGBA')
                assert im.size == (cw, ch)
                sheet.paste(im, ((i % cols) * cw, (i // cols) * ch))
            sheet.save(f'{d}/{c}_select_idle_{half}.png', optimize=True)
        info[c] = dict(frame=[cw, ch], frames=m['frames'], frame_ms=m['frame_ms'], screen_pos=m['screen_pos'],
                       feet_anchor_screen=m['feet_anchor_screen'], half_frames=len(fs[0::2]),
                       note='a = even frames, b = odd frames; desktop interleaves a/b at frame_ms, phones play a only at 2*frame_ms')
    json.dump(info, open(f'{d}/select_v2.json', 'w'), indent=1)
    print('select halves', info)


if __name__ == '__main__':
    for n, s in CHARS.items():
        for mode in ('full', 'lite'):
            build_char(n, s, mode)
    copy_fx()
    select_halves()

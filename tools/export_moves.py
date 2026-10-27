"""Render ALL of Seek's game moves in a row (EDL rebuild: the clips AS THE GAME PLAYS THEM, i.e. kept frames + forward/reverse/ping-pong/shake order).

  out: <OUT>/seek_all_moves_24fps.mp4          H.264, constant 24 fps, 1280x720, yuv420p, grey background
       <OUT>/seek_all_moves_24fps_alpha.mov    ProRes 4444 with alpha (transparent background), same frames
       <OUT>/seek_moves_timeline.csv           move, group, start/end frame (0-based, inclusive), timecodes, source fps ...
  One solid #FF7A00 frame sits BETWEEN each pair of moves (not at the very start/end).
  Sprites are 1:1 game pixels, placed by their own anchor (feet) at (640,660), nearest-neighbour (no scaling at all).
  Timing: each source frame keeps its real display time on the 24 fps grid:
     street clips (source fps f): video frame m shows source frame floor(m*f/24); video frames = round(N*24/f)
        24 fps -> 1:1, 12 fps -> every frame held x2, 21.176 fps (walk_loop) -> 30 frames over 34 video frames (some held x2)
     fight moves (60 Hz ticks, 2-6 ticks per frame): each source frame is held for round(cumulative ticks*24/60) - previous end video frames, minimum 1,
        so no source frame is ever skipped and the move's total length stays within about half a video frame of the real game time
  Every clip plays once, start to end, in its playback order (reverse / ping-pong / shake are already in the frame list; a 1-frame freeze clip shows its single frame; loops are NOT repeated).
"""
import json, os, subprocess, sys, csv
import numpy as np
from PIL import Image

B = '/workspace/gasguzla/brawler/v1'
S4 = B + '/seek_sprites_v4'
G = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/gasguzla/seek_moves_export'
os.makedirs(OUT, exist_ok=True)
W, H, AX, AY, FPS = 1280, 720, 640, 660, 24
BG = (110, 110, 110)
ORANGE = (0xFF, 0x7A, 0x00)

FIGHT = ['idle', 'walk_fwd', 'walk_back', 'kick_b', 'kick', 'crouch', 'block', 'hit', 'knockdown', 'getup']
NICE = {'kick_b': 'punch (kick_b)', 'kick': 'kick', 'hit': 'hurt (first section of knockdown, then reverse)'}
STREET_GROUPS = [('seek', 'mock_seek'), ('seek_wall', 'mock_seek_wall')]

def place(px, anchor):
    """px: RGBA canvas array -> full 1280x720 RGBA layer, anchor at (AX,AY)"""
    h, w = px.shape[:2]; L = np.zeros((H, W, 4), np.uint8)
    x0, y0 = AX - anchor[0], AY - anchor[1]
    assert x0 >= 0 and y0 >= 0 and x0 + w <= W and y0 + h <= H, (x0, y0, w, h)
    L[y0:y0 + h, x0:x0 + w] = px
    return L

def load_atlas(d):
    at = json.load(open(d + '/atlas.json')); fr = {}
    for t in at['textures']:
        pg = np.array(Image.open(f"{d}/{t['image']}").convert('RGBA'))
        for f in t['frames']: fr[f['filename']] = (pg, f)
    return fr
def atlas_canvas(fr, k, canvas):
    pg, f = fr[k]; r = f['frame']; s = f['spriteSourceSize']
    cv = np.zeros((canvas[1], canvas[0], 4), np.uint8)
    cv[s['y']:s['y'] + r['h'], s['x']:s['x'] + r['w']] = pg[r['y']:r['y'] + r['h'], r['x']:r['x'] + r['w']]
    return cv

segments = []   # (name, group, source_fps, n_src, layers, note)
for g, grp in STREET_GROUPS:
    d = G + f'/public/assets/mock/{g}/full'
    clips = json.load(open(d + '/clips.json'))['clips']; fr = load_atlas(d)
    for n, c in clips.items():
        keys = c['frames']; fps = c['fps']
        cache = {}
        def img(k):
            if k not in cache: cache[k] = place(atlas_canvas(fr, k, c['canvas']), c['anchor'])
            return cache[k]
        nv = max(1, int(round(len(keys) * FPS / fps)))
        seq = [img(keys[min(len(keys) - 1, int(np.floor(m * fps / FPS + 1e-9)))]) for m in range(nv)]
        note = ('loop clip (plays once here); ' if c['loop'] else '') + f'{len(set(keys))} unique atlas frames in a {len(keys)}-frame playback list'
        if len(keys) == 1: note = 'single frame: the game freezes on this pose while spraying / as the K.O. pose'
        segments.append((n, grp, fps, len(set(keys)), seq, note))

fd = G + '/public/assets/fight/seek/full'
mv = json.load(open(fd + '/moves.json'))['moves']; fra = load_atlas(fd)
for n in FIGHT:
    m = mv[n]; frames = m['frames']; ticks = [f['t'] for f in frames]; tot = sum(ticks)
    imgs = [place(atlas_canvas(fra, f['k'], m['canvas']), m['anchor']) for f in frames]
    seq, prev, cum = [], 0, 0
    for im, t in zip(imgs, ticks):
        cum += t; end = max(prev + 1, int(round(cum * FPS / 60.0 + 1e-9)))
        seq += [im] * (end - prev); prev = end
    uniq = len(set(f['k'] for f in frames))
    segments.append(('fight_' + n, 'fight', round(len(frames) * 60 / tot, 3), uniq, seq, f'{uniq} unique atlas frames in a {len(frames)}-step list; 60Hz ticks/frame {min(ticks)}-{max(ticks)}; real game time {tot/60:.3f}s, video {len(seq)/FPS:.3f}s' + (f'; in-game hold at list index {m["hold"]} skipped' if m.get('hold') is not None else '') + ('; ' + NICE[n] if n in NICE else '')))

total = sum(len(s[4]) for s in segments) + len(segments) - 1
print('moves', len(segments), 'video frames', total, 'duration s', total / FPS)

def ff(args):
    return subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-'] + args, stdin=subprocess.PIPE)
mp4 = ff(['-vf', 'format=gbrp,scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '8', '-profile:v', 'high', '-r', str(FPS), '-fps_mode', 'cfr',
          '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', OUT + '/seek_all_moves_24fps.mp4'])
mov = ff(['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-r', str(FPS), OUT + '/seek_all_moves_24fps_alpha.mov'])
bg = np.zeros((H, W, 4), np.uint8); bg[..., :3] = BG; bg[..., 3] = 255
org = np.zeros((H, W, 4), np.uint8); org[..., :3] = ORANGE; org[..., 3] = 255
def emit(layer_rgba, composite):
    mov.stdin.write(layer_rgba.tobytes())
    if composite:
        a = layer_rgba[..., 3:4].astype(np.uint16)
        rgb = (layer_rgba[..., :3].astype(np.uint16) * a + np.array(BG, np.uint16) * (255 - a) + 127) // 255
        out = np.concatenate([rgb.astype(np.uint8), np.full((H, W, 1), 255, np.uint8)], 2)
    else: out = layer_rgba
    mp4.stdin.write(out.tobytes())
rows, f = [], 0
tc = lambda i: f'{i // (FPS * 3600):02d}:{i // (FPS * 60) % 60:02d}:{i // FPS % 60:02d}:{i % FPS:02d}'
for si, (name, grp, sfps, nsrc, seq, note) in enumerate(segments):
    start = f
    for L in seq:
        emit(L, True); f += 1
    rows.append([name, grp, start, f - 1, tc(start), tc(f - 1), len(seq), sfps, nsrc, (f - 1 + 1) if si < len(segments) - 1 else '', note])
    if si < len(segments) - 1:
        emit(org, False); f += 1
mp4.stdin.close(); mov.stdin.close(); mp4.wait(); mov.wait()
with open(OUT + '/seek_moves_timeline.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['move', 'group', 'start_frame', 'end_frame', 'start_timecode_24fps', 'end_timecode_24fps', 'video_frames', 'source_fps', 'source_frames', 'orange_frame_after', 'note'])
    w.writerows(rows)
json.dump(dict(total_frames=f, fps=FPS, size=[W, H], anchor=[AX, AY], bg=BG, orange=ORANGE), open(OUT + '/seek_moves_timeline.json', 'w'))
print('frames written', f)

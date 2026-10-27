"""Seek's animation set after Michael's Premiere edit (EDL in tools/seek_edl.json / .csv).

Only the frames he kept are packed into the atlases. Direction, ping-pong, freeze, speed-ups and loops are PLAYBACK data
(clips.json lists atlas keys; a key can repeat in a list), so reversing or repeating a clip costs no extra texture memory.

STREET (24 fps source frames; the 12 fps idle plays at 24 fps = his 200 %):
  KEEP[clip]   = the source frame numbers kept (in order)
  PLAY[name]   = (clip, mode, fps_override, loop)   mode: fwd | rev | pp (ping-pong) | hold (last frame) | shake | seg:<a>-<b>:<mode>
"""

def rng(a, b): return list(range(a, b + 1))

KEEP = {
    'idle_a': rng(0, 16),
    'walk_loop': rng(0, 29),
    'guard_up': rng(9, 36),
    'guard_down': [17, 18, 20, 21, 23, 24, 26, 27, 29, 30, 32, 33, 35],
    'pocket_draw': rng(0, 32) + rng(43, 46),
    'cam_spray_raise': [0, 4, 8, 12, 16, 20],            # 400 %
    'fwd_spray_raise': [3, 7, 11, 15, 19, 23, 27],       # 400 %
    'turn_to_wall': rng(6, 38),
    'wall_spray_long': rng(23, 49) + rng(102, 125) + rng(155, 172) + rng(198, 203),
    'turn_away_toss': rng(0, 92) + rng(115, 130),
}

# playback clips: name -> dict(src, base (source frame numbers), mode)
def P(src, base=None, mode='fwd', loop=False, fps=None):
    return dict(src=src, base=base if base is not None else KEEP[src], mode=mode, loop=loop, fps=fps)

PLAY = {
    'idle_a': P('idle_a', mode='pp', loop=True, fps=24),
    'walk_loop': P('walk_loop', loop=True),
    'guard_up': P('guard_up'),
    'guard_down': P('guard_down'),
    'pocket_draw': P('pocket_draw'),
    'pocket_stow': P('pocket_draw', mode='rev'),
    'cam_spray_raise': P('cam_spray_raise'),
    'cam_spray_hold': P('cam_spray_raise', base=[20], mode='hold', loop=True),     # frozen on the final raise frame
    'cam_spray_return': P('cam_spray_raise', mode='rev'),
    'fwd_spray_raise': P('fwd_spray_raise'),
    'fwd_spray_hold': P('fwd_spray_raise', base=[27], mode='hold', loop=True),
    'fwd_spray_return': P('fwd_spray_raise', mode='rev'),
    # wall graffiti, built from his kept segments (see README of this change: seam-checked order)
    'turn_to_wall': P('turn_to_wall'),
    'wall_shake': P('wall_spray_long', base=rng(23, 49), mode='shake'),              # A: fwd, back, fwd (ends can overhead)
    'wall_squat_dn': P('wall_spray_long', base=rng(155, 172), mode='rev'),           # C reversed: stand -> squat
    'wall_squat_hold': P('wall_spray_long', base=rng(155, 158), mode='pp', loop=True),
    'wall_squat_up': P('wall_spray_long', base=rng(102, 125), mode='rev'),           # B reversed: squat -> arm up spraying high
    'wall_spray_mid': P('wall_spray_long', base=rng(198, 203), mode='pp', loop=True),
    'turn_away_toss': P('turn_away_toss'),
}
WALL = ('turn_to_wall', 'wall_shake', 'wall_squat_dn', 'wall_squat_hold', 'wall_squat_up', 'wall_spray_mid', 'turn_away_toss')
FWD = ('fwd_spray_raise', 'fwd_spray_hold', 'fwd_spray_return')

# FIGHT (indices into the moves.json frame list of fight/seek): kept frames
FIGHT = dict(idle=rng(0, 9), walk_fwd=rng(0, 33), kick_b=rng(0, 15), kick=rng(0, 13), crouch=rng(12, 25), block=[0, 1, 3, 5],
             knockdown=rng(0, 30), getup=rng(1, 29), hurt=rng(0, 4))     # hurt = first section of the knockdown

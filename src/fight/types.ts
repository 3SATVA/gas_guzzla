/** Data written by tools/build_fight_assets.py (public/assets/fight/<fighter>/<full|lite>/moves.json). */
export type Box = [number, number, number, number]; // x0,y0,x1,y1 relative to the feet anchor, facing right
export interface Frame {
  k: string; sk: string | null; t: number;
  hb: Box | null; hu: Box | null; inv: boolean; adv: number; st: string | null; bcx: number; air: boolean;
}
export interface Move {
  anchor: [number, number]; canvas: [number, number]; loop: boolean; end_dx: number;
  hold: number | null; exit_idle: number | null; enter_idle: number | null; frames: Frame[];
}
export interface MoveSet { fighter: string; moves: Record<string, Move>; gpu_mb: number }

export interface Inp { fwd: boolean; back: boolean; down: boolean; block: boolean; punch: boolean; kick: boolean }
export const NO_INPUT: Inp = { fwd: false, back: false, down: false, block: false, punch: false, kick: false };

export type FighterId = 'fade' | 'seek' | 'cylo';
export interface FighterDef {
  name: string; punch: string; kick: string | null; block: string | null; crouch: string | null;
  push: number; shadowW: number; dmg: Record<string, number>; stag: Record<string, number>;
}
export const DEFS: Record<FighterId, FighterDef> = {
  // Fade: 1-2 jab combo (two hit windows) + mid kick
  fade: { name: 'FADE', punch: 'jab', kick: 'kick', block: 'block', crouch: 'crouch', push: 100, shadowW: 150,
    dmg: { jab: 6, kick: 10 }, stag: { jab: 1, kick: 2 } },
  // Seek has no punch art: PUNCH = her horizontal kick (kick_b), KICK = her high side kick
  seek: { name: 'SEEK', punch: 'kick_b', kick: 'kick', block: 'block', crouch: 'crouch', push: 95, shadowW: 136,
    dmg: { kick_b: 9, kick: 11 }, stag: { kick_b: 1, kick: 2 } },
  // Heavy Cylobot: fast lunge punch only (no kick, no guns, no block art)
  cylo: { name: 'HEAVY CYLOBOT', punch: 'punch', kick: null, block: null, crouch: null, push: 125, shadowW: 210,
    dmg: { punch: 12 }, stag: { punch: 2 } },
};

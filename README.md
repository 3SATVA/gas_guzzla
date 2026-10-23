# GAS GUZZLA – Level 1 prototype

A playable browser prototype of a strictly 2D, side-view, pixel-art flying-car side-scroller.
It's built with Phaser 3 (3.90), Vite and TypeScript. There's no music, sound, weapons or cassettes yet.
This build is for working out the parallax, the smashing and the car's movement.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + static build -> dist/
npm run preview    # serve dist/ at http://localhost:4173
```

You can add these URL parameters for testing:
- `?scene=level` skips the select screen.
- `?seed=123` gives a repeatable course.
- `?noenemies=1` turns off enemies.
- `?nospawn=1` turns off obstacles and enemies.

### Deploy (Vercel)
`vercel.json` sets the framework to Vite, the build command to `npm run build` and the output to `dist/`.
The output is fully static, and Vite uses `base: './'`, so it works from any path.

## Controls

| | Keyboard | Touch / mouse |
|---|---|---|
| Select: browse drivers | ← → / A D | swipe, or tap the left/right screen edge |
| Select: choose | Enter / Space | tap the middle |
| Fly | Arrows / WASD (up/down freely, some forward/back) | hold and drag; the car steers toward your finger |
| Restart level | R | tap after TOTALED |
| Damage debug HUD + hitboxes | D | – |
| Back to select | Esc | – |

### Fight mode (main menu → FIGHT, or `?fight=1`)

Pick Fade or Seek, then fight the CPU Heavy Cylobot, best of 3 (99 s rounds).

| | Keyboard | Touch |
|---|---|---|
| Walk forward / back | ← → / A D | ◀ ▶ pad |
| Crouch (ducks the Cylobot's high punch) | ↓ / S (hold) | ▼ |
| Punch (Fade: jab combo; Seek: horizontal kick) | J / Z | PUNCH / KICK |
| Kick (Fade: kick; Seek: high kick) | K / X | KICK / HIGH |
| Block (hold) | L / C / Shift | BLOCK |
| Rematch on the win screen | R / Enter | REMATCH |
| Back to pick | Esc | PICK ↩ |

URL flags: `?scene=fight&fighter=fade|seek` jumps straight in, `?lite=1` / `?full=1` force the phone/desktop texture set, `?touch=1` shows the touch buttons on desktop, `?bag=front` spawns the rare front bag early.

## How it is put together

- **One 1280×720 canvas.** The select screen is native 1280×720. Gameplay is authored at 640×360 and drawn with camera zoom 2.
- **Integer scaling.** The canvas is scaled by whole steps (1×, 2×, 3×…) with `image-rendering: pixelated`. Windows smaller than 1280×720 fall back to 0.5×, which is still pixel-exact for gameplay.
- **Art comes from `public/assets/`** (a copy of `level1/`) and is used unchanged. All sizes, frames, timings, anchors, hitboxes, parallax speeds, collision pieces and select-screen positions are read from `public/assets/manifest.json`.
  - **The 22660 px select sheets are too wide for GPUs** (max texture size is usually 8192 or 16384). `tools/regrid.py` re-packs the 20 frames of each 1133×433 strip into a 3-column grid in `public/assets/select/grid/`, pixel for pixel, and verifies every frame matches exactly.
  - **No TileSprites.** Phaser 3 TileSprites resample non-power-of-two textures, so the parallax and ground layers are plain 1:1 image copies placed on integer pixels.
  - **Tilting the car.** The car is composed and tilted at 1× into a small render target, which is then drawn at 2×, so the tilt never breaks the pixel grid.
- **Car layers:** per the README, each section draws one layer, either `body_sections/<sec>_0` or `damage/<sec>_<lvl>`, ordered from least to most damaged. Then the flame, `rear_engine` and `front_gear`. `body.png` is never drawn.
- **Damage** (`src/game/damage.ts`) tracks back, middle and front at levels 0–3. The contact point's x on the car decides which section is hit.
  - A hit raises that section by one.
  - Once the hit section is at 2 or more, the hit also spills one level into its neighbour. So a second front hit gives front 2 and middle 1.
  - A section already at 3 passes the damage on to the next one.
  - The car is TOTALED only when all three sections are at 3.
- **Collision** uses pixel masks built from the approved PNGs' alpha for the car, the solid pieces and the breakables. The ground uses the manifest height map, and enemies use their manifest hitboxes.
- **Obstacle generation** is procedural from the collision pieces. It always keeps an open vertical gap of at least 128 px. The soak test measured the smallest gap at 148 px.

## Tools
- `tools/play.mjs`: headless Chromium play-through that saves screenshots to `shots/`. Add `--video` to record `shots/gameplay.webm`, then convert it to mp4 with ffmpeg.
- `tools/soak.mjs`: passability soak with an avoid-only autopilot and no enemies.
- `tools/regrid.py`: the pixel-exact re-pack of the wide select sheets.

Run these against `npm run preview` (port 4173). They need `/usr/bin/google-chrome` or `CHROME=...`.

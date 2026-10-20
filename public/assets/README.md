# GAS GUZZLA – Level 1 art assets
manifest.json is the source of truth: sizes, frames, timings, anchors, hitboxes, parallax factors and draw orders.
- bg/        4 parallax layers: a=smoggy sky (opaque, 0.1), b=far (0.25), c=mid (0.5), d=near decor (0.8, 1600 wide). Seamless repeat-x, orange smog haze.
- collision/ BLACK SILHOUETTE collision layer (parallax 1.0): solid_bldg_1-5 (rise from bottom), solid_overhang_1-5 (hang from top), breakables (billboard, antenna mast, hanging sign, thin wall, signal tower, street sign, cable span) each with a 6-frame break sheet, ground_strip (1280 seamless), black_shards_sheet. Polygons/bbox/tags in manifest.json -> collision_layer.
- car_fade/  Fade's side car at in-game size (~161 px wide, 172x97 canvas), downscaled one step from cars/fade/side/fullres. Includes body, sections, damage 1-3, gear, engine, flame_sheet_half.png (nozzle anchor) and flame_sheet_native.png for the 343x193 originals. damage_preview_ingame_2x.png shows the damage states stacked.
- enemies/   drone (4 rotor frames), white and black hover cars. Each has a smashed still and a 6-frame break-apart sheet. All face left.
- fx/        explosion (10 frames, 96x96), spark/shard burst (8 frames, 56x56), debris (16 pieces, 12x12 cells).
- select/    SELECT SCREEN IS 1280x720 (native density of the approved originals). bg, logo (approved sprite + x2 copy), Fade/Seek idle sheets (unresampled, character only), Seek locked sheet, padlock_x4, LOCKED/name/title text, Fade car front3/4 bounce as 3 registered sheets, Seek placeholder Trans Am silhouette sheet + label, spotlight. Carousel positions + swipe timing in manifest.json -> select_screen.
- preview.png (gameplay mock @2x), select_preview.png, select_preview_seek.png (1280x720), select_swipe_preview.gif.
- _src/ generated masters on chroma green; _tools/ build scripts (rerun to rebuild).

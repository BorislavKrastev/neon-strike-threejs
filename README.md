# Strike Force 1.6

A browser tactical shooter in the spirit of Counter-Strike 1.6, built with **Three.js**.
It has rounds, economy, a bomb, a buy menu, bots, and GoldSrc-style movement.
Everything is generated procedurally: the map, textures, models, and sounds. There are no external assets.

![genre](https://img.shields.io/badge/genre-tactical%20FPS-orange) ![engine](https://img.shields.io/badge/engine-three.js%20r160-black)

## Play

This is a static site with no build step. Serve it from any HTTP server:

```bash
npx http-server .   # or: python3 -m http.server
```

Then open the address in Chrome, Edge, or Firefox. Choose a team, difficulty, and graphics quality, then click **ИГРАЙ** ("Play").
It also works on GitHub Pages: Settings → Pages → Deploy from branch.

> Three.js loads from jsDelivr, so the first launch needs internet access.

## Controls

| Key | Action |
|---|---|
| WASD | Movement |
| Mouse / LMB | Aim / fire |
| RMB | AWP scope (2 zoom levels), heavy knife stab |
| Space | Jump (bunny hopping and air strafing work) |
| Ctrl / C | Crouch (crouch-jump onto crates) |
| Shift | Walk silently (no footsteps) |
| R | Reload |
| 1–5, Q, wheel | Switch weapons (Q = previous) |
| B | Buy menu (in the spawn zone, first 20 seconds of the round) |
| F3 / F4 | Autobuy / rebuy |
| E | Plant the C4 on a site / defuse it |
| G | Drop a weapon or the bomb |
| Tab | Scoreboard |
| Esc | Pause |

## What's inside

**Gameplay**
- 5v5 (or 3v3 / 4v4) with bots on your team and on the enemy team
- Bomb scenario: Ts plant the C4 on A or B, and CTs defend and defuse it. Defusing takes 10 s, or 5 s with a kit
- Round structure: freeze time, 1:55 per round, buy time, MVP, and a match to 5, 8, or 16 wins
- 1.6-style economy: $800 start, win/loss bonuses with a loss streak, per-weapon kill rewards, and a $16,000 cap
- Weapons: Knife, Glock-18, USP .45, Desert Eagle, MP5, M3, AK-47, M4A1, AWP, HE, flashbang, smoke, and armor with a helmet
- Recoil patterns (spray control), spread from movement and jumping, and crouch accuracy
- Hitboxes: head ×4, stomach ×1.25, legs ×0.75. Armor and helmets use per-weapon armor penetration
- Wallbangs through wooden crates and barrels
- Weapons drop on death and can be picked up. The bomb drops too

**Physics**
- GoldSrc movement: acceleration, friction, air acceleration (strafe jumping and bhop), crouch-jumping, and step-up onto stairs and edges
- Dynamic barrels and crates that react to bullets, explosions, and pushes. Red barrels explode in chain reactions
- Grenades bounce off walls and the floor, and smoke settles when the grenade stops
- Knockback and slowdown when hit (tagging), plus fall damage

**Bot AI**
- Field of view, line of sight, and blocking by smoke and flashbangs
- Hearing for shots and footsteps, reaction time, aim error, and recoil compensation
- Strategies: Ts pick a site and a route (long, mid, or tunnels). CTs split between A, B, and mid
- Carrying and planting the bomb, rotating after the plant, defusing, picking up a dropped C4, and hunting at the end of the round
- 4 difficulty levels (Easy to Expert)

**Graphics**
- PBR materials with procedurally generated albedo, normal, and roughness maps (sandstone, plaster, sand, tiles, wood, metal)
- Physically based sky, an environment map for reflections, a sun with soft shadows, and ACES tone mapping
- Fake ambient occlusion baked into vertex colors and ground textures, plus GTAO on "Ultra"
- Bloom, color grading, vignette, film grain, and chromatic aberration when hurt
- Muzzle flashes with dynamic lights, tracers, shell casings, bullet holes, blood, dust, sparks, explosions, and volumetric-looking smoke
- Viewmodel with arms, weapon bob and sway, recoil, reload, and draw animations
- Desert town map with domes, minarets, palm trees, awnings, cables, and lamp-lit tunnels

**Sound**
- Every sound is synthesized with the Web Audio API: shots per weapon, reverb, positional panning, distance attenuation, and occlusion through walls
- Radio messages ("Bomb has been planted", "Terrorists win"…) through speechSynthesis

## Map "de_sandstone"

```
        CT spawn
   B ─── ┼ ─── A
   │    mid     │
tunnels  │    long
   │    doors   │
   └── T spawn ─┘
```

## Code structure

```
index.html, style.css     UI, HUD, menus
src/main.js               loading, menu, main loop
src/engine.js             renderer, sky, lights, post-processing, materials
src/textures.js           procedural PBR textures
src/map.js                map geometry, props, gameplay zones, radar
src/physics.js            AABB world, swept bodies, props, ray casts
src/nav.js                A* navigation grid for bots
src/combatant.js          player/bot: movement, inventory, shooting, recoil
src/bot.js                bot AI
src/game.js               rounds, economy, bomb, damage, grenades, camera
src/weapons.js            weapon stats + procedural models
src/viewmodel.js          first-person weapon and arms
src/character.js          3D soldier model and animations
src/effects.js            particles, decals, tracers, explosions, smoke
src/audio.js              synthesized audio
src/controls.js           keyboard/mouse input (Pointer Lock)
src/hud.js                HUD, radar, buy menu, scoreboard
```

## License

MIT. This is a non-commercial fan tribute. It uses no Valve assets.

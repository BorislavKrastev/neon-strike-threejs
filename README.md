# Neon Strike: Arena Protocol

An original, browser-based tactical FPS inspired by the fast readability and weapon feel of classic arena shooters. Built with Three.js and procedural geometry; no copied maps, models, textures, sounds, or branding.

## Play

Open `index.html` in a modern desktop browser while connected to the internet. Three.js is loaded from jsDelivr. Click **Enter Arena**, then click the game to lock the mouse.

For the most reliable local experience, run it through any static server:

```bash
npx serve .
```

Then open the address shown in the terminal. The project is also ready for GitHub Pages.

## Controls

- `WASD`: move
- Mouse: aim
- Left mouse: fire
- Right mouse: scope with the Nova Rail
- `Shift`: sprint
- `Space`: jump
- `R`: reload
- `1`–`4` or `Q`: switch weapons
- Mouse wheel: switch weapons
- `G`: throw a frag grenade

Touch controls are included for mobile browsers.

## Features

- Four distinct weapons: sidearm, automatic carbine, shotgun, and scoped rail rifle
- Reactive combat bots with patrol, line-of-sight, strafing, firing, death, and respawn behavior
- Headshots, armor, reloads, recoil, spread, sprinting, jumping, and collision
- Procedural tactical arena with cover lanes and spawn pads
- Procedural industrial materials, colored arena lights, emissive trims, film grain, and ACES tone mapping
- Tracers, muzzle flashes, persistent impact marks, sparks, smoke, shell casings, explosions, screen shake, hit markers, damage vignette, kill feed, and synthetic audio
- Physics barrels that react to bullets and grenades, explode, and push nearby props
- High-quality/performance toggle and adaptive pixel ratio
- Zero build step; static-hosting friendly

## Technology

- Three.js r160
- Vanilla JavaScript, HTML, and CSS
- WebGL, Pointer Lock API, Web Audio API

## License

MIT

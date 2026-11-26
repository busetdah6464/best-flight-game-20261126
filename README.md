[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057/rank)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057/score)](https://make.fun/bounty/best-flight-game-20261126-0057)

# Sky Courier — a 3D flight game

A complete, original 3D flight game that runs offline in a desktop browser
from static files. You are a courier pilot at Merapi Valley Airfield: take
off from the runway, fly the ring course over valleys, lake and ridges, mind
your fuel and your stall speed, then bring the plane home and land it clean.

## Play

- **W / S** — throttle up / down (also **Shift** / **Ctrl**)
- **Arrow Up / Down** — pitch (elevator)
- **Arrow Left / Right** or **A / D** — roll (ailerons)
- **Q / E** — rudder (yaw)
- **Mouse** — gentle steering: move the mouse to nudge pitch and roll
- **C** — switch chase camera / cockpit camera
- **M** — mute sound
- **Enter** — start the selected mission / restart after landing or crash
- **1 / 2 / 3** — pick a mission on the start screen

## Missions

1. **Valley Ring Run** — 8 rings low over the valley and the lake.
2. **Ridge Delivery** — 10 rings, higher and tighter, over the mountain ridge.
3. **Storm Dusk** — 8 rings at dusk with stronger wind and less fuel.

Fly through every ring in order, then land back on the runway. Rings are
worth 100 points each, a clean landing pays up to 500, and the time bonus
rewards a fast, smooth flight. Run out of fuel, stall too low, or hit the
ground and the sortie ends.

## Flying model

A simple but honest model: lift grows with speed, so a slow plane sinks and
stalls; banking turns the plane; drag grows with throttle and with hard
manoeuvres; wind pushes you sideways. Take off at about 30 m/s, keep your
speed up in the turns, and come in low and slow — but not too slow — for
the landing.

## Run it

Serve `game/` with any static server and open `game/index.html` in desktop
Chrome, for example:

```sh
node serve.ts
# open http://localhost:8080
```

No network request, no library, no build step: the 3D engine is a custom
software renderer drawn on a 2D canvas, and every sound is synthesised
live with WebAudio.

## Layout

- `game/index.html` — the page, canvas and HUD shell
- `game/src/config.js` — tuning, missions, seeded random
- `game/src/math3d.js` — vectors, matrices, camera projection
- `game/src/world.js` — terrain, lake, runway, rings, trees, clouds
- `game/src/plane.js` — the aircraft mesh and the flight physics
- `game/src/render.js` — the painter's-algorithm renderer, HUD and instruments
- `game/src/input.js` — keyboard and mouse
- `game/src/audio.js` — procedural engine, wind and chime sounds
- `game/src/shots.js` — deterministic screenshot scenes
- `game/src/main.js` — game loop, states, scoring, missions
- `main.ts` — the make.fun hand-in program (Node 22, standard library only)
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged
- `screenshots/` — real renders of the game's own code

Built for the [make.fun best flight game bounty](https://make.fun/bounty/best-flight-game-20261126-0057).

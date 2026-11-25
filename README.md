# JHA City

A procedural **neon-sunset open world** for Android, written from scratch in JavaScript with
[Three.js](https://threejs.org). No Rockstar/GTA assets, names or music — everything (city,
vehicles, people, sound) is generated in code at runtime.

## Run locally

```sh
pnpm install
pnpm run dev
```

Open the URL shown by Vite. Keyboard + touch controls both work.

## Build the APK

Push to `main` (or trigger **Build JHA City APK** manually in the Actions tab) and download the
`jha-city-apk` artifact. Install it on the phone with `termux-open <apk>` or your file manager.

To build an Android platform locally you need the Android SDK + JDK 21; the CI does this for you.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move / steer | WASD / arrows | left joystick |
| Accelerate | W | GAS |
| Brake / reverse | S | BRAKE |
| Handbrake (drift) | Space | HB |
| Boost | Shift | BOOST |
| Enter / exit vehicle | E | E |
| Job board / story | J | JOBS |
| Garage / shop / safehouse | G nearby | SHOP nearby |
| Jump (on foot) | Space | JUMP |
| Sprint (on foot) | Shift | BOOST |
| Camera | C | CAM |
| Toggle day / night | N | D/N |
| City map (zoom, pan, waypoint) | Tap minimap | Tap minimap |
| Quality / FPS meter | ⚙ button | ⚙ button |
| Bribe police ($500) | P | — |

Quality starts on **AUTO**; it drops pixel density, bloom and shadows when the frame rate
sags, and slowly raises them again when there is headroom. Pick HIGH / MEDIUM / LOW in the
⚙ panel to lock a level. Settings are saved automatically.

## Police & wanted level

Reckless driving or hitting a pedestrian starts a chase. Stars escalate with repeated crimes:

- **1–2 stars:** one or two cruisers follow and cut you off; slow down and officers deploy on foot.
- **3 stars:** roadblocks appear ahead on the road, with barriers and waiting officers.
- **4–5 stars:** an air unit joins with a searchlight; more cruisers and a second roadblock at 5.

Break line of sight and stay hidden to drain the search meter and lose a star. On foot you
lose heat faster than inside a car. The map shows the last-known search circle, cruiser dots
and foot-officer dots. `P` pays a $500 bribe when you have enough cash.

Getting caught shows a **BUSTED** screen, deducts a fine based on your stars and respawns you
at the downtown precinct. Sirens are distance-based and pan with the nearest cruiser; the
helicopter adds a low rotor hum.

## Jobs, story and economy

Press **J** (or the JOBS touch button) for the job board. A four-chapter story chain plays short
radio dialog before each chapter. Side jobs are delivery, street race, taxi, courier, VIP drive,
suspect chase and time trial. Courier and time trial add time bonuses; VIP runs fail if you speed
or wreck the car; the chase spawns a fleeing suspect that you must catch. Damage reduces payouts.

The map marks three businesses:

- **Garage** — buy a bike or coupe, install an engine tune or reinforced body, repaint, and spawn
  your owned vehicle.
- **Supply shop** — buy health and armor. Free health/armor crates also respawn around the city.
- **Safehouse** — rest for full health and manage three save slots.

Save slots are also available in the ⚙ panel. Loading a slot restores cash, story progress,
location, owned vehicles and graphics settings. Armor absorbs impact damage before health, and
upgraded bodies take less collision damage.

## Goals

- Bike, car and on-foot play from the first playable build
- Procedural city with day/night, traffic, pedestrians and dynamic police pursuit
- Story chain, seven job types, garage economy and three save slots
- 30 FPS target on mid-range phones (DPR cap, instancing, quality tiers)

## License

Original code, MIT. Third-party libraries keep their own licenses (Three.js MIT, Vite MIT,
Capacitor Apache-2.0).

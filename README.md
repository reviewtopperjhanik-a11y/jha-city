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
| Jump (on foot) | Space | JUMP |
| Sprint (on foot) | Shift | BOOST |
| Camera | C | CAM |
| Toggle day / night | N | D/N |
| Bribe police ($500) | P | — |

## Goals

- Bike, car and on-foot play from the first playable build
- Procedural city with day/night, traffic, pedestrians, wanted stars and police
- Delivery, street race and taxi missions
- 30 FPS target on mid-range phones (DPR cap, instancing, quality tiers)

## License

Original code, MIT. Third-party libraries keep their own licenses (Three.js MIT, Vite MIT,
Capacitor Apache-2.0).

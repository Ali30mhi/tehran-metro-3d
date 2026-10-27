# Tehran Metro 3D

Interactive 3D map of the Tehran Metro network, built with Three.js and OpenStreetMap data.

**Live demo:** https://ali30mhi.github.io/tehran-metro-3d/

![screenshot](screenshot.png)

## Features

- All metro lines rendered in 3D, each on its own layer (layer spacing is adjustable)
- Animated trains running along the lines
- Station search (press `/` to jump to it)
- Click a station to see its name in Persian and English, plus the lines that serve it
- Hover over a station to see its name
- Dark base map of Tehran that can be hidden or faded
- Adjustable bloom/glow effect
- Auto-rotate and a reset view button

The interface is in Persian (RTL).

## Controls

| Action | Input |
|---|---|
| Rotate | Left click + drag |
| Pan | Right click + drag |
| Zoom | Scroll |
| Station details | Click on a station |
| Search | `/` |
| Close panel | `Esc` |

## Running locally

```bash
npm install
npm run dev
```

Station and line data is already included in `public/data`. To refresh it from OpenStreetMap:

```bash
npm run fetch-data
```

## Build and deploy

```bash
npm run build    # production build in dist/
npm run deploy   # build and publish to GitHub Pages
```

## Built with

- [Three.js](https://threejs.org/)
- [Vite](https://vitejs.dev/)
- [OpenStreetMap](https://www.openstreetmap.org/) (Overpass API and map tiles)

## Data

Map and metro data © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/).

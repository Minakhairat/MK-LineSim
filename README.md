# MK LineSim — MK Tech

Industrial Layout Design, Digital Factory Modeling & Real-Time Discrete-Event Production Simulation Platform.

## Features

- **Synchronized 2D SVG & 3D Three.js Workspaces**: Shared physical coordinate system in meters (`m`, `cm`, `mm`).
- **Discrete Event Simulation (DES) Engine**: Deterministic min-heap priority queue running in a Web Worker, enforcing finite buffers, conveyor spacing/speed, worker travel times, shift breaks, and optional machine breakdowns.
- **Factory & Automatic Line Layout Generator**: Supports Straight, U-Shaped, L-Shaped, Parallel, and Loop production lines with constraint checking.
- **Offline-First Persistence**: IndexedDB project and custom equipment storage + versioned JSON import/export.
- **Analytics, What-If Scenarios, CAD & Reports**: Chart.js dashboards, side-by-side scenario testing, 2D AutoCAD DXF, 3D SolidWorks/Autodesk Inventor STL & OBJ CAD exports, PDF engineering reports, 3D PNG snapshots, and CSV event traces.
- **Bilingual UI**: Full English (LTR) and Arabic (RTL) interface with Light & Dark themes.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

## Deploying to GitHub Pages

1. Push this repository to GitHub with `main` as the default branch.
2. In your GitHub repository go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. The included `.github/workflows/deploy.yml` workflow builds `dist/` and publishes the app automatically on every push to `main`.

---
© 2026 **MK Tech — MK LineSim**. Eng. Mina Khairat. All rights reserved.

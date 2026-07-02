# SwarmFix Viewer

Three.js/Vite viewer for exported SwarmFix `scene_trace.json` artifacts.

The viewer is an explanation layer only. It loads JSON produced by the Python
pipeline and does not run localisation, generate measurements, or invent solver
states in the browser.

## Commands

```powershell
npm install
npm run dev
npm test
npm run build
```

The default example is loaded from:

```text
viewer/public/examples/full_workflow_demo.json
```

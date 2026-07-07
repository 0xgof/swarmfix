# SwarmFix Viewer

Vite/Three.js viewer for SwarmFix scene traces, live solver responses, and UI
diagnostics.

The viewer loads exported scene JSON from the Python pipeline, animates the
current swarm state, builds live solve requests, and can call the Python live
solver at `http://127.0.0.1:8765/solve`. It also exposes a UI catalog for the
viewer controls and rendering primitives.

## Commands

Install dependencies from this directory:

```powershell
npm install
```

Run the development server:

```powershell
npm run dev
```

Run tests:

```powershell
npm run test -- --run
```

Build the viewer:

```powershell
npm run build
```

## Routes

The main viewer is served at `/`.

The UI catalog is served at:

```text
/ui_catalog
```

The default example is loaded from:

```text
viewer/public/examples/full_workflow_demo.json
```

Additional example scenes live in:

```text
viewer/public/examples/
```

## Live Solver

Start the Python live solver from the repository root before using live solve
diagnostics:

```powershell
python -m swarmfix.live.server --host 127.0.0.1 --port 8765
```

The viewer also checks live solver health at:

```text
http://127.0.0.1:8765/health
```

If the live solver is unavailable, the viewer keeps rendering the latest local
scene state and marks the connection as stale or unavailable.

## Features

- Three.js rendering for truth, GNSS, fused, corrected, reference, residual,
  cost, UWB, and position-error layers.
- Live estimation frames generated from the loaded scene trace.
- Mission action controls for formation and motion modes.
- Adaptive UWB link selection with per-agent caps and diagnostics.
- Live solver request/response handling with connection status and viewport
  badge feedback.
- GNSS uncertainty visuals, UWB cord links, residual vectors, position-error
  lines, and inspector summaries.
- Catalog sections for visual tokens, renderers, controls, panels, and live
  connection states.

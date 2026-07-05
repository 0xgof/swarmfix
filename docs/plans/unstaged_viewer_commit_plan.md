# Unstaged Viewer Commit Plan

Date: 2026-07-05
State: Draft

## Purpose

Group the current unstaged viewer changes into coherent commits and provide a
complete commit message for each commit.

This plan is based on the current dirty worktree. Several files contain changes
from more than one topic, so use patch staging for `App.ts`, `App.test.ts`, and
`controlsProps.test.ts`.

## Current Dirty Areas

Tracked modified files:

```text
viewer/src/app/App.test.ts
viewer/src/app/App.ts
viewer/src/app/ViewerState.test.ts
viewer/src/app/ViewerState.ts
viewer/src/app/entryRoute.test.ts
viewer/src/app/entryRoute.ts
viewer/src/live/liveSolveTypes.test.ts
viewer/src/main.ts
viewer/src/scene/createScene.test.ts
viewer/src/scene/createScene.ts
viewer/src/simulation/liveEstimation.test.ts
viewer/src/simulation/liveEstimation.ts
viewer/src/styles.css
viewer/src/ui/IterationSlider.ts
viewer/src/ui/LayerControls.ts
viewer/src/ui/MissionActionControls.ts
viewer/src/ui/controlsProps.test.ts
```

Untracked files:

```text
viewer/src/app/layerControlModel.test.ts
viewer/src/app/layerControlModel.ts
viewer/src/newton/
```

## Recommended Commit Order

1. Viewer layer-control semantics and control explanations.
2. Viewer-controlled mission drone count and live GNSS rendering.
3. Camera-follow manual zoom preservation.
4. Newton diagnostic route, shared state, and normal-system UI.

This order keeps small UI/control semantics before the broader live-frame
behavior, then isolates camera behavior, then lands the new diagnostic page.

## Commit 1 - Viewer Layer-Control Semantics

### Topic

Make viewer layer handles data-aware and clearer by deriving labels, groups,
disabled state, and explanations from the active scene data.

### Stage These Changes

Stage all of:

```text
viewer/src/app/layerControlModel.ts
viewer/src/app/layerControlModel.test.ts
viewer/src/ui/LayerControls.ts
viewer/src/ui/IterationSlider.ts
viewer/src/styles.css
```

Stage only the layer-control and iteration-slider hunks from:

```text
viewer/src/app/App.ts
viewer/src/ui/controlsProps.test.ts
```

In `App.ts`, include the hunks that:

- import `buildIterationControlModel` and `buildLayerControlItems`;
- remove the old hard-coded `layerLabels`;
- call `buildIterationControlModel(...)` for the iteration slider;
- call `buildLayerControlItems(...)` in `layerControlItems()`.

In `controlsProps.test.ts`, include the hunks that:

- expect custom iteration labels/reasons;
- expect disabled layer controls to show reasons and avoid emitting changes.

Do not include drone-count hunks from `MissionActionControls` or
`controlsProps.test.ts` in this commit.

### Commit Message

```text
Make viewer layer controls data-aware

Replace the viewer's hard-coded layer labels with a small layer-control view
model that derives labels, grouping, disabled state, and user-facing reasons
from the active SceneTrace and current layer visibility. This keeps useful
scenario-dependent handles such as corrected estimates and references visible,
but disables them when the scene has no data for those layers.

The iteration slider is also made explicit in live mode: it is labeled as an
exported trace inspection control and carries explanatory text so it is not
confused with the latest live solver frame.

Updated the reusable control primitives to render grouped layer sections,
disabled handles, reason text, and configurable iteration labels without
coupling the controls to ViewerState.

Tests:
- npm test -- --run src/app/layerControlModel.test.ts src/ui/controlsProps.test.ts src/app/App.test.ts
- npm test
- npm run build
```

## Commit 2 - Viewer-Controlled Mission Drone Count

### Topic

Let the user choose the active mission drone count from the viewer, generate
stable mission agent ids, request backend mission positions for that active set,
and keep GNSS measurement/sigma rendering aligned with generated live agents.

### Stage These Changes

Stage all of:

```text
viewer/src/app/ViewerState.ts
viewer/src/app/ViewerState.test.ts
viewer/src/live/liveSolveTypes.test.ts
viewer/src/scene/createScene.ts
viewer/src/scene/createScene.test.ts
viewer/src/simulation/liveEstimation.ts
viewer/src/simulation/liveEstimation.test.ts
viewer/src/ui/MissionActionControls.ts
```

Stage only the mission drone-count hunks from:

```text
viewer/src/app/App.ts
viewer/src/app/App.test.ts
viewer/src/ui/controlsProps.test.ts
```

In `App.ts`, include the hunks that:

- import `createMissionAgentIds`;
- pass `droneCount` and `onDroneCountChange` to mission-action controls;
- clear backend mission-position cache when mission action or drone count changes;
- use generated active mission agent ids for backend and fallback mission positions;
- include `missionDroneCount` in the mission-action cache key;
- add `mission_drone_count` to observability fields.

In `App.test.ts`, include the test named:

```text
requests backend mission positions for the user-selected drone count
```

In `controlsProps.test.ts`, include the test named:

```text
MissionActionControls emits bounded drone-count changes without changing action state
```

### Commit Message

```text
Add viewer-controlled mission drone count

Add a bounded mission drone-count setting to ViewerState and expose it through
the mission-action controls as a drones menu. The viewer now generates stable
mission agent ids from the selected count and uses those ids when requesting
backend mission positions and when falling back to local mission geometry.

Changing the count preserves the selected formation and motion settings, but
clears stale backend mission positions, previous UWB selected links, and cached
mission-position request state so the next frame reflects the new active swarm.
The mission-action cache key and observability fields now include the selected
drone count.

Update live estimation so supplied mission positions define the active live
agent set, including generated agents that are absent from the exported scene.
Generated agents receive deterministic visible GNSS offsets plus a median
exported GNSS sigma fallback, and GNSS measurement/sigma rendering now iterates
the active live frame instead of only exported GNSS records.

The live solve request tests now cover generated mission agents so future
changes do not silently drop active drones before the Python solver boundary.

Tests:
- npm test -- --run src/app/ViewerState.test.ts src/ui/controlsProps.test.ts src/simulation/liveEstimation.test.ts src/scene/createScene.test.ts src/live/liveSolveTypes.test.ts src/app/App.test.ts
- npm test
- npm run build
```

## Commit 3 - Camera Follow Manual Zoom

### Topic

Preserve user-controlled zoom distance while camera-follow is active, and let
the follow toggle reset ownership when the user turns follow off and on again.

### Stage These Changes

Stage only the camera-follow hunks from:

```text
viewer/src/app/App.ts
viewer/src/app/App.test.ts
```

In `App.ts`, include the hunks that:

- add `cameraFollowZoomReleasedByManualInput`;
- reset that field on mount, destroy, disabled follow, and follow-toggle changes;
- detect when the current camera distance has diverged from the stored follow
  distance;
- preserve manual camera distance while follow remains active.

In `App.test.ts`, include the tests named:

```text
keeps a manual zoom distance while following the barycenter
lets the follow toggle take charge of zoom again after manual zoom
```

Also include the small adjustment to the earlier follow smoothing test that
removes the forced initial camera position if it belongs to the same camera
behavior change.

### Commit Message

```text
Preserve manual zoom while following the swarm

Teach the camera-follow logic to distinguish automatic follow zoom from a user
manual zoom. When the camera distance diverges from the stored follow distance,
the viewer now treats the current distance as user-owned and keeps that distance
while continuing to follow the swarm barycenter.

Turning camera follow off and back on resets that manual ownership so the
automatic fit distance can take control again. This keeps repeated follow frames
from snapping the camera back after a manual zoom, while preserving an explicit
way to return to automatic framing.

Tests:
- npm test -- --run src/app/App.test.ts
- npm test
- npm run build
```

## Commit 4 - Newton Diagnostic Page

### Topic

Add a Newton diagnostic route that can receive live solve state from the main
viewer, reconstruct a local normal-system snapshot, and visualize the formation,
Jacobian, normal matrix, residual vector, gradient, right-hand side, and update
step.

### Stage These Changes

Stage all of:

```text
viewer/src/newton/
viewer/src/app/entryRoute.ts
viewer/src/app/entryRoute.test.ts
viewer/src/main.ts
```

Stage only the Newton shared-state hunks from:

```text
viewer/src/app/App.ts
```

In `App.ts`, include the hunks that:

- import `publishNewtonSharedState`;
- import the `LiveSolveRequest` type;
- add `latestLiveSolveRequest`;
- publish Newton shared state after live solve request construction and when a
  new solver frame arrives.

Do not include mission drone-count or camera-follow hunks in this commit.

### Commit Message

```text
Add Newton diagnostic page for live solve state

Add a `/newton` entry route and lazy-loaded Newton diagnostic page. The main
viewer publishes the latest live solve request, latest solver response, selected
UWB links, solver backend name, schema version, timestamp, and mission action
over a BroadcastChannel so the Newton page can inspect the current live solve
without changing the `/solve` API.

The new Newton model reconstructs a labeled residual vector, Jacobian, normal
matrix, damped normal matrix, gradient, right-hand side, and candidate update
from a live solve request. It labels GNSS residual rows, UWB residual rows, and
position-variable columns so selecting a drone, GNSS marker, or UWB link can
highlight the relevant rows and columns.

The page renders a formation panel, selectable drones/GNSS/UWB elements,
normal-system equation, matrices, vectors, summary metrics, and update outcome.
It falls back to a small fixture request when no live shared state has arrived,
so the diagnostic surface can be opened directly during development.

Tests:
- npm test -- --run src/app/entryRoute.test.ts src/newton/normalSystemModel.test.ts src/newton/formationSelection.test.ts src/newton/newtonSharedState.test.ts src/newton/NewtonPage.test.ts
- npm test
- npm run build
```

## Validation Observed Before This Plan

The current dirty tree has been validated during recent work with:

```text
cd viewer
npm test
npm run build
```

Observed results:

- Full viewer suite passed: 44 files, 221 tests.
- TypeScript check and Vite build passed.
- Vite still reports the existing large-chunk warning for the
  `ConnectionStatusPanel` chunk.

Re-run validation after splitting commits, because patch staging can accidentally
omit a hunk from a topic.

## Staging Notes

- `App.ts` contains changes for all four topics. Stage it by patch, not as a
  whole file.
- `App.test.ts` contains both mission-count and camera-follow tests. Stage it by
  patch.
- `controlsProps.test.ts` contains layer-control tests and mission drone-count
  tests. Stage it by patch.
- `MissionActionControls.ts` belongs to the mission-count commit.
- The untracked `viewer/src/newton/` directory belongs entirely to the Newton
  diagnostic commit.
- The new plan/ticket docs under `docs/` may be ignored by Git in this repo;
  verify with `git check-ignore -v` if they do not appear in `git status`.

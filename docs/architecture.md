# Flowline architecture

## Boundary

Flowline is a static, local-first React application. It has no backend, database, login, external API, analytics, or real-world side effect. The browser owns the authoritative game state for the current session.

The package is self-contained on purpose: it builds, tests, and deploys on its own, with no
dependency on a sibling project, a shared library, or any build step outside its own
`package.json`.

## Layers

```text
fixtures.ts
    ↓
domain/model.ts  ← deterministic rules, simulator, state transitions
    ↓
tools/webmcp.ts  ← native registration + local invocation adapter
    ↓
App.tsx          ← human controls, panels, proposal/confirmation UI
    ├── DOM/CSS 2.5D overview ← playable source of truth + universal fallback
    └── scene-model.ts
            ↓
      flowline-3d.ts ← optional lazy WebGL explanation layer
```

### `src/data/fixtures.ts`

Defines one reproducible scenario: four jobs, two stations, an eight-slot horizon, deadlines, and one deterministic disruption. The fixture contains no personal or external data.

### `src/domain/model.ts`

Pure domain functions calculate the schedule and enforce transitions. The simulator uses:

- one global job order;
- one non-preemptive preparation lane;
- two dispatch lanes before the disruption;
- one dispatch lane after the disruption;
- precedence from preparation completion to dispatch start;
- deadline tardiness, waiting, makespan, on-time count, and critical-job status.

There are only `4! = 24` possible orders, which makes exhaustive deterministic regression testing practical. The model never asks an LLM to calculate the outcome.

### `src/tools/webmcp.ts`

Registers six narrow tools when `document.modelContext` exists. The same dispatch path is used by native WebMCP and the local guide fallback, so the visible UI and tool result operate on one state object.

Read/simulation tools may expose an audit focus and visible audit result, but they never commit a schedule. `stage_schedule` and `undo_schedule` create a pending proposal with an expected revision. Confirmation remains a React human action and is not exposed as a tool.

The runtime rejects read/simulation calls during setup, invalid schedules, stale revisions, duplicate pending proposals, and cancellation before dispatch. The domain layer rejects wrong-phase mutations as a second boundary rather than trusting UI button state alone.

### `src/App.tsx`

The UI reads the current state and derives the active, normal, and stressed evaluations. The center timeline is the shared artifact: the player, local guide, and native agent all refer to the same schedule, revision, lanes, and deadline rail.

`ScheduleStage` derives one `SceneModel` from that evaluation. `FocusView` loads
`flowline-3d.ts` only after the player opens the focus layer. The renderer receives
semantic station/job snapshots, never raw DOM selectors, score rules, or mesh data.
The 2.5D timeline remains complete when WebGL is unavailable, the tab is hidden, or
the focus layer is closed.

The proposal panel clearly separates:

1. agent proposal;
2. editable human reason;
3. human confirmation;
4. committed receipt;
5. exact undo proposal.

### `src/visual/scene-model.ts`

This is a pure adapter from `GameState` plus the already-computed
`ScheduleEvaluation` to station/job/focus/causal-path data. It does not simulate a
second schedule. Pending proposals are evaluated by the same domain simulator and
exposed as ghost jobs without changing the committed schedule.

### `src/visual/flowline-3d.ts`

This module is the only Three.js boundary. It owns one renderer, one scene, one camera
with four fixed vantage points and five zoom steps, reusable low-poly objects, capped
pixel ratio, and full cleanup. The camera never pans or yaws freely: every word on the
floor is DOM text positioned from projected world anchors, and that projection only
stays legible while the eye and target share an x, so each preset re-aims along that
axis and re-projects every anchor rather than sweeping between them.
Focus is therefore expressed by highlighting, locking, routing and naming the causal
slice rather than by flying to it. Its render loop is demand-driven: it renders on a
state/resize/focus transition and stops while idle, hidden, offscreen, or disposed. No
React state is updated per frame. Three.js is dynamically imported, so the initial
route does not request its chunk.

### `src/base.css`, `src/pages.css`, `src/plan.css`, and other styles

The presentation uses a dark operations-deck system with CSS-native 2.5D visual
layers, a deep operations dock, lane cards, animated job bars, disruption striping,
and responsive stacking. The optional focus layer is visually consistent with this
system but does not replace the semantic DOM surface.

### `tests/evals/`

A local eval harness that scores the tool surface rather than a model. A solver is handed
exactly what a WebMCP client is handed — the six names, sentences and schemas from
`TOOL_SPECS`, and one `call` function — and nothing else: not the scenario, not the
evaluator, not the fixture. Tasks are sentences a person would type, and they are scored on
the board that results and on the trace the runtime wrote, never on the solver's wording, so
two agents that take different routes to the same board both pass.

Nothing calls a model, which is the point: the numbers reproduce on a laptop with no key and
no network, and what they measure is whether the surface is workable blind. The invariants
are where the teeth are — one trace line per call, no call moves the committed revision, a
refusal changes nothing, no plan is staged that this run has not compared, and a per-task
call budget so a brute-force sweep over 24 orders cannot pass by exhaustion. The suite also
keeps a solver that is *supposed* to fail: `hopeful` compares candidates properly but reads
the normal shift, where this board offers no signal, so it keeps a brittle order. If the
robustness task ever accepts it, that task has stopped measuring anything.

This is also how the surface's one real hole was found: `undo_schedule` required a receipt id
that no tool reported, so it was listed, typed, annotated, callable, and impossible to call
correctly. `inspect_board` now reports the active receipt, and a guard asserts that every
value a write tool requires appeared in an earlier read — checked on values, not key names.

## State machine

```text
setup
  → planning
  → awaiting_review
  → applied
  → disrupted
  → awaiting_review
  → disrupted
  → awaiting_review (exact undo)
  → disrupted
```

`resetRound` returns to `setup` with an incremented round number. Every reorder, disruption, confirmation, and rollback increments the revision. A pending proposal stores the expected revision and cannot silently overwrite a later board state.

## Trust boundary

```text
untrusted agent input
        ↓ typed schema + parse + revision check
deterministic domain transition
        ↓ pending proposal only
human review and editable reason
        ↓ explicit button
confirmed schedule + receipt
```

There is no auto-confirm, auto-publish, network write, external message, or claim that the simulation is an optimal real-world schedule.

## 3D lifecycle and performance boundary

```text
open focus
  → dynamic import
  → create renderer/scene/camera once
  → derive semantic snapshot
  → render during visible transition
  → pause when idle/hidden/offscreen
  → dispose on close/unmount
```

The renderer uses procedural low-poly geometry only. Geometry/material collections,
observers, visibility listeners, animation handles, render lists, and the WebGL
context are disposed at teardown. The opt-in `?flowline-capture=1` query is only a
local evidence aid that preserves the drawing buffer for screenshots; normal
production rendering leaves that option disabled.

The internal performance budget is measured separately from correctness. Current
headless Chromium evidence meets the median-FPS and long-task targets, but desktop
p95 frame time remains an environment-specific risk and is not presented as a
release guarantee. A real-device/target-client run is still required before making
a final Adopt decision for the 3D layer.

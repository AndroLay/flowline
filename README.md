# Flowline

Flowline is a small WebMCP learning game about operational scheduling.

> A schedule can look efficient until the floor changes.

The player orders four fictional jobs through a preparation bay and a dispatch bay. A page-aware Operations Auditor reads the live board, finds the bottleneck, runs a deterministic disruption test, and stages a recovery proposal. The player owns the trade-off: only the human can confirm or undo a plan.

## Status

This is an isolated V2 deterministic spike and the Flowline submission track. It is
separate from `../withheld`; the old `needs-and-means` placeholder is not an active
submission. The Flowline name and final publication status remain subject to the owner's
final decision.

Completed in this spike:

- playable setup → planning → confirmation → disruption → recovery → exact undo flow;
- deterministic two-machine schedule simulator;
- six page-state and revision-aware WebMCP tools;
- strict human confirmation boundary;
- stale, invalid, duplicate, wrong-phase, and recovery guards;
- skippable boot screen and operations control-room entry dashboard;
- responsive dark arena UI with a visible shared timeline;
- optional lazy-loaded Three.js focus layer with one reusable low-poly scene;
- state-parity adapter for the 2.5D timeline, semantic inspector, ghost proposal,
  disruption overlay, guided focus, and WebGL fallback;
- guide modal with keyboard focus handling;
- model, tool contract, and scene-model parity tests;
- local Chromium evidence for lazy loading, responsive layout, renderer cleanup,
  and repeated active-frame samples.

Not claimed yet:

- hosted public URL;
- agent-native natural-language replay on a target client;
- user-learning study or adoption validation;
- final Devpost submission.

## Run locally

From the root of this repository:

```bash
pnpm install
pnpm dev
```

The Vite development server uses `http://127.0.0.1:4178/` by default. When this
package is checked out inside the parent WebMCP workspace, the equivalent command
is `pnpm --filter flowline dev`.

Validation commands:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Game loop

1. Enter the operations floor.
2. Order Pantry, Archive, Beacon, and Relay.
3. Ask the Operations Auditor to inspect the board, find a bottleneck, and stress-test the current order.
4. Stage a plan with a human reason; the proposal remains pending.
5. Confirm the plan yourself.
6. Reveal the deterministic event: Dispatch Bay loses one berth.
7. Move the deadline-critical Beacon earlier, stage a recovery plan, and confirm it.
8. Inspect the visible outcome and optionally prepare an exact rollback.

The learning objective is narrow and observable: explain why an order that is on time in the normal shift can fail after a capacity disruption, then identify one trade-off in a more robust order.

## Visual layers

The 2.5D DOM/CSS overview is the actual game surface. It shows the queue, two
stations, timeline, deadlines, metrics, audit trail, proposal, confirmation, and
recovery controls. The full 3D view is an optional explanation layer opened from
the floor map; it magnifies the focused station, queue, handoff, deadline, and
disruption using the same `ScheduleEvaluation`.

Three.js is dynamically imported only when the focus view opens. The renderer uses
one scene/camera/renderer, procedural geometry, capped pixel ratio, demand-driven
rendering, and teardown disposal. If WebGL cannot be created, the focus panel
reports a 2D fallback and the complete timeline remains playable. The optional
`?flowline-capture=1` URL flag is only for local screenshot evidence and is not
needed for normal operation.

## WebMCP surface

| Tool | Role | State effect |
| --- | --- | --- |
| `inspect_board` | read the active schedule, phase, and revision | focus only |
| `find_bottleneck` | audit the active condition | stores visible audit |
| `simulate_disruption` | compare normal and one-berth-offline conditions | stores visible audit |
| `compare_plans` | compare a proposed order without committing it | stores visible audit |
| `stage_schedule` | prepare a schedule proposal | pending proposal only |
| `undo_schedule` | prepare an exact rollback | pending proposal only |

The agent cannot confirm a proposal. All state-changing proposals require the human-only confirmation control.

Tool responses remain semantic: revision, phase, job/station IDs, metrics, causal
path, violations, and available actions. They never accept mesh vertices, texture
IDs, camera matrices, or arbitrary DOM selectors.

## Design and evidence docs

- [Architecture](./docs/architecture.md)
- [Game design](./docs/game-design.md)
- [Challenge adaptation and purpose](./docs/challenge-adaptation.md)
- [Progress and verification](./docs/progress.md)
- [Rendering and performance plan](./docs/rendering-and-performance-plan.md)
- [Rendering performance evidence](./docs/rendering-performance-evidence-2026-09-02.md)
- [Demo and evidence plan](./docs/demo-and-evidence.md)
- [Decision log](./docs/decision-log.md)
- [Visual reference audit](./docs/visual-reference-audit.md)
- [Target visual images](./docs/target-images/README.md)

## Originality and data boundary

The implementation uses standard scheduling concepts only: ordered jobs, sequential preparation, parallel dispatch capacity, deadlines, waiting, makespan, and a deterministic capacity disruption. It does not use another project's code, solver, challenge input/output, API, visual assets, narrative, or copy. All jobs, constraints, metrics, and outcomes in this package are fictional and local-only.

The game is a learning simulation, not an operational recommendation, fairness oracle, emergency system, or production scheduler.

## Verification boundary

The package has local deterministic tests and Chromium browser evidence. Native
tool registration is separate from genuine natural-language agent replay; the
latter remains `UNKNOWN` until an authorized target client runs it. Public hosting,
learner validation, and final submission are also not claimed by this package.

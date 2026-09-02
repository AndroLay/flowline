# Flowline demo and evidence plan

## 90-second judge path

| Time | Screen action | Point proved |
| ---: | --- | --- |
| 0–10s | enter the operations floor | the problem is a short scheduling game, not a generic chat surface |
| 10–25s | show the four jobs and live timeline | the player owns the order; both stations share one visible state |
| 25–38s | ask the auditor to inspect and stress-test | WebMCP reads structured page context and returns a causal audit |
| 38–50s | write a reason, stage, and open proposal | the agent proposes; the human reviews the exact order |
| 50–62s | confirm and start the shift | human-only confirmation creates the first receipt |
| 62–73s | reveal berth offline | the previously clear order becomes visibly late |
| 73–84s | move Beacon first, stage and confirm recovery | the player learns and owns the robustness trade-off |
| 84–90s | show receipt and exact undo | state, reason, revision, and recovery remain auditable |

## Evidence matrix

| Claim | Artifact or test | Current status |
| --- | --- | --- |
| WebMCP tools are real and structured | `src/tools/webmcp.ts`, native registration harness | local PASS; native client replay UNKNOWN |
| agent and human share state | `GameState`, revision-bound tool results, center timeline | local PASS |
| mutation is human-gated | `stage_schedule`, `undo_schedule`, proposal panel, model tests | local PASS |
| schedule outcomes are deterministic | `evaluateSchedule`, exhaustive 24-order test | PASS |
| disruption changes the outcome | fixture plus audit test and browser flow | PASS |
| recovery is exact and reversible | `prepareUndo`, receipt history, lifecycle test | PASS |
| 3D focus is a projection of the live state | `deriveSceneModel`, `flowline-3d.ts`, scene-model parity tests | local PASS; visual capture uses an opt-in audit flag |
| 3D is lazy and disposable | production resource trace, renderer stats, 20 open/close cycles | local PASS; real-device memory evidence UNKNOWN |
| problem has a credible learning use | persona and learning objective in `game-design.md` | design claim; learner evidence UNKNOWN |
| application is reproducible | package scripts, README, lockfile workspace, MIT license | local PASS; public release UNKNOWN |
| hosted submission works | public URL smoke test | UNKNOWN |

## What the video must not imply

- The simulator is not an optimizer or universal scheduling oracle.
- The synthetic metrics are not a production SLA.
- The agent does not confirm, publish, message, or change a real operation.
- Native WebMCP should only be shown if the recorded client actually discovered and invoked the tools.
- A local fallback should be labeled honestly if native WebMCP is unavailable.
- The focus canvas is an explanation layer; the DOM timeline and semantic scene
  description remain the accessible source of truth.

## Release checklist

- [ ] clean hosted URL opens without credentials;
- [ ] public repository contains source, instructions, and license;
- [ ] video is under three minutes, public, and matches the hosted build;
- [ ] native tool discovery/replay is recorded or clearly labeled unavailable;
- [ ] real-device performance confirms the desktop p95 frame-time gate before 3D is
  treated as a release requirement;
- [ ] the demo includes one success, one disruption, and one human-gated recovery;
- [ ] no external asset or copied participant code is included;
- [ ] submission title, description, URL, repository, and video are reviewed by the owner before publishing.

# Flowline progress and verification

Last checked: 2026-09-02.

## Current status

| Area | Status | Evidence |
| --- | --- | --- |
| isolated package | PASS | `submissions/flowline` has its own manifest, Vite entry, source, tests, docs, and license |
| deterministic simulator | PASS | four jobs, two stations, normal/stress evaluation, and 24-order exhaustive test |
| state transitions | PASS | stage, confirmation, disruption, recovery, stale guard, proposal guard, and exact undo tests |
| WebMCP contract | PASS locally | six definitions, strict schedule parsing, native registration harness, local invocation path |
| human approval boundary | PASS locally | state-changing tools only stage proposals; confirmation is not a registered tool |
| visual gameplay | PASS in local browser | target-aligned objective rail, 2.5D floor map, shared timeline, auditor rail, decision bar, incident, audit, recovery, receipt, and undo rendered |
| lazy 3D focus layer | PASS in production preview | Three.js is dynamically requested only after focus opens; one renderer, scene, camera, semantic inspector, ghost state, guided camera, and WebGL fallback are implemented |
| 2.5D/3D state parity | PASS locally | `deriveSceneModel` maps the same `ScheduleEvaluation`; scene-model tests cover IDs, revision, metrics, disruption, and uncommitted ghost plans |
| renderer lifecycle | PASS in local Chromium | demand-driven frame loop, capped pixel ratio, hidden/offscreen pause, and geometry/material/observer/context disposal are implemented; 20 open/close cycles leave no canvas or exception |
| entry boot/dashboard | PASS in local browser | short skippable boot sequence plus a three-role landing command center: planner thesis, interactive CSS/DOM floor preview, and page-aware Operations Auditor |
| responsive layout | PASS in local browser | latest 1440px and 390px checks had no document horizontal overflow; the arena timeline keeps an intentional internal scroll on narrow screens |
| keyboard guide | PASS in local browser | modal focus, Escape close, focus restoration, and reduced-motion check |
| public hosting | UNKNOWN | no provider or deployment was authorized in this isolated creation step |
| agent-native natural-language replay | UNKNOWN | requires an authorized target client/session, not a direct handler call |
| learner validation | UNKNOWN | no human comprehension sample has been collected |
| final submission | NOT STARTED | final title, repository publication, URL, video, and Devpost entry remain owner decisions |

## Commands that passed

```text
pnpm --filter flowline typecheck   PASS
pnpm --filter flowline test        PASS (3 test modules, 10 test cases)
pnpm --filter flowline build       PASS
```

Latest production build output:

```text
initial entry:      265.98 kB raw / 80.71 kB gzip
initial CSS:        180.22 kB raw / 31.85 kB gzip
lazy 3D chunk:      487.74 kB raw / 124.22 kB gzip
```

The 3D chunk is separate from the initial entry. A fresh browser navigation
requested no `flowline-3d` or Three.js resource before the focus button was opened.

The browser acceptance flow passed in Chromium. The latest visual run used
`http://127.0.0.1:4179/` because the package's default `4178` port was occupied;
the package default remains `4178`:

```text
setup → planning → audit → stage → human confirm
→ deterministic berth disruption → reorder Beacon
→ stage recovery → human confirm → exact undo
```

Observed browser evidence:

- boot screen was visible on a fresh load and reached the dashboard after its short
  progress sequence;
- document width remained equal to viewport width at 1440px and 390px;
- the entry dashboard, mobile layout, reduced-motion mode, and existing arena were
  visually inspected;
- no page errors or console errors during the acceptance flow;
- the timeline changed from `4/4 on time` to `2/4 on time` after the disruption;
- the recovery order returned the critical job to `SAFE`;
- rollback produced a new receipt and restored the prior order;
- the guide dialog trapped focus and restored focus after Escape;
- reduced-motion mode removed animation and nearly all transition duration.
- the opt-in screenshot route used `?flowline-capture=1`; normal production
  rendering uses `preserveDrawingBuffer: false`.
- target arena composition was checked at 1440 × 900 and 390 × 844: objective,
  timeline, floor map, auditor, and decision regions followed the supplied target
  geometry; the outer document had no horizontal overflow.
- landing dashboard pass was rendered at desktop and mobile: Normal / Shock Test
  controls, job focus controls, deadline watch, agent trace, and the existing entry
  CTA are present in the DOM and visual composition without page or console errors.
- dark command deck pass was rendered again in Chromium at 1440 × 900 and 390 ×
  844: the page canvas, navigation, progress rail, planner, live floor, auditor,
  signal strip, and method section now use one dark-first navy system. This latest
  fallback render is visual/DOM evidence; a full Playwright console and interaction
  run remains unavailable in the current environment.
- arena-wide dark theme was rendered through the full local UI path at 1440 × 900
  and 390 × 844: planning, guide, proposal, confirmed-plan, disruption, recovery
  receipt, and exact-undo proposal states now share the same navy/cyan system. The
  browser path completed without console errors or uncaught exceptions; the mobile
  document had zero horizontal overflow. Chromium CDP was used because the local
  Playwright CLI and Python module are unavailable in this environment.
- player sequence placement was refined: the reorder surface now sits above the
  shared timeline in the central column, while the left rail contains mission
  context and operating rules. Chromium measured the desktop rail at 819 × 108px
  and the mobile rail at 351 × 199px; job names remained readable and the mobile
  document had zero horizontal overflow.

### Rendering performance sample

The following is an internal measurement, not a public performance claim. It used
the production preview, Chromium 151 headless with SwiftShader, one visible focus
scene, and five independent 10-second active samples per viewport. Each sample
alternated station focus to keep the guided transition active. The renderer scene
was 26 draw calls, 910 triangles, 24 geometries, and 0 textures in the committed
state.

| Viewport | Samples | Median FPS (all samples) | p95 frame time (all samples) | Long tasks >50ms | Layout overflow |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1440 × 900 | 5 × 10s | 59.88 | 33.30 ms | 0 | 0 |
| 390 × 844 | 5 × 10s | 59.88 | 16.80 ms | 0 | 0 |

The desktop median meets the internal 55 FPS target and mobile p95 meets the 20 ms
target. Desktop p95 does not meet the internal 20 ms target in this headless
SwiftShader environment; the repeated 33.3 ms sample indicates compositor cadence,
not a high triangle or texture workload, but it remains a release risk until a real
hardware run confirms it. No desktop performance pass is claimed from this result.

Temporary screenshots were used for visual inspection and removed after verification;
they are not release evidence or product assets.

## Remaining gates

1. Repeat the production performance suite on a real laptop and a real 390px-class
   mobile/browser profile, including cold and warm cache, before adopting 3D as a
   release requirement.
2. Rehearse native tool discovery and natural-language selection on the chosen client.
3. Select and authorize a zero-cost static host and public repository.
4. Record a truthful sub-three-minute demo from the hosted build.
5. Decide whether the resulting evidence is sufficient for a separate submission.

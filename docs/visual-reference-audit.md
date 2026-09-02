# Visual reference audit: Cora → Flowline

**Date:** 2026-09-02
**Status:** implemented visual direction, not a copy of the reference
**Scope:** entry experience, dashboard shell, and target-aligned arena composition;
scheduling logic remains in the existing domain layer.

## Sources reviewed

- [CORA live demo](https://cora-gamefi.vercel.app/) — rendered landing experience and visible navigation.
- [CORA public repository](https://github.com/ahmdtrdi/Cora) — product framing, architecture, and documented stack.

The live page was inspected in Chromium at a desktop viewport. The repository README
was used only to understand the product boundary and the reasons its visual choices
are not transferable to Flowline.

## What Cora does well

| Strength | Why it works | Flowline translation |
| --- | --- | --- |
| Immediate world-building | The first viewport establishes a distinct arena rather than opening as a generic dashboard. | Use an operations control room with a clear visual language, not a decorative card grid. |
| Strong identity | Logo, illustrated environment, characters, and copy all reinforce one product fantasy. | Make the floor, stations, jobs, and handoff the identity of Flowline. |
| Clear entry point | The navigation and repeated arena CTA make the next action obvious. | Add compact Brief / How it works / Arena navigation and one primary entry action. |
| Progressive explanation | Roster, battle flow, queue, replay, and final CTA explain the product in layers. | Add a short three-step operating idea below the hero without hiding the actual game. |
| Memorable visual anchors | The large central arena scene is easier to remember than a conventional admin screen. | Use station depth, a handoff core, moving job rail, deadline alert, and live readout as the memorable scene. |
| Product-level status | Arena, queue, and battle states are presented as one coherent system. | Present shift, stations, horizon, capacity shock, and deadline watch as one coherent system. |

## What should not be copied

| Risk or weakness | Why it is a problem for Flowline | Decision |
| --- | --- | --- |
| Asset-heavy illustrated background | It creates atmosphere, but adds asset rights, loading weight, and a dependency Flowline does not need. | Build the room from CSS primitives and semantic HTML. |
| Wallet, wagering, and chain dependency | Cora's README describes wallet, escrow, realtime, and on-chain layers. Those dependencies would destroy Flowline's local-first deterministic boundary. | Do not add wallets, money, network calls, or external services. |
| Character roster as the main mechanic | Scientists and bases are specific to Cora's battle fantasy and would make Flowline feel like a reskin. | Use stations and jobs because they are native to scheduling. |
| Long landing-page journey | A rich landing can delay the core interaction if the visitor must scroll before understanding the task. | Keep the entry dashboard compact; the CTA enters the existing game in one click. |
| Full-bleed art as the only explanation | Important state may become inaccessible or ambiguous if it exists only in an image/canvas. | Keep the timeline, labels, metrics, and controls in semantic DOM. |
| Exact visual composition or copy | Reusing the reference's wording, illustration style, or layout would weaken originality and create rights/perception risk. | Use an original operations language with different objects, copy, and geometry. |

## Loading-screen decision

A separate loading screen was not reliably observable in the captured Cora landing
page. Flowline adds a short original boot sequence because the scheduling game benefits
from a small “shared floor is coming online” transition. It lasts about 1.25 seconds,
has a visible skip control, exposes progress semantics, and respects reduced motion.
It is an entry affordance, not a fake network or model-loading claim.

## Flowline before this pass

- The initial screen was clean and readable, but it looked like a static design spike.
- The right-side preview had generous unused space and did not communicate enough
  operational motion or system status.
- There was no loading/entry ritual, no product-level navigation, and no compact
  explanation of the operating idea before entering the floor.
- The game already had the important foundations: a deterministic model, shared
  timeline, human confirmation boundary, and local WebMCP fallback.

## What was adopted

1. **Boot sequence:** scenario, timeline, and agent bridge progress states with skip.
2. **Dashboard entry:** a deliberate Brief / How it works / Arena shell.
3. **Operations control room:** two station blocks, isometric grid, handoff core,
   job rail, deadline alert, axis labels, and system readout.
4. **Progressive story:** hero statement, scenario facts, then Build → Stress → Decide.
5. **Visual hierarchy:** one primary CTA, one supporting anchor, one operational
   preview, and compact facts below it.
6. **Responsive translation:** the control room collapses to a readable vertical
   composition on narrow screens; no information is placed only in decoration.

## Landing dashboard pass — 2026-09-02

The first viewport was revised after a direct browser comparison with the supplied
references. The entry surface now behaves as an operations command center instead of
an editorial brief with a static preview.

### Improvements applied

- The thesis is now concise and product-specific: **Make the shift hold.**
- The first viewport has three explicit roles: planner, live floor, and Operations
  Auditor.
- The center floor is interactive without changing the game state: Normal / Shock
  Test switches the deterministic preview condition, and job tokens expose a
  keyboard-accessible focus state.
- The floor contains visible station depth, handoff node, moving route packets,
  queue tokens, deadline watch, horizon readout, and live metrics.
- The agent panel shows a page-aware trace, available tools, a specific agent role,
  and the human-only confirmation boundary before the player enters the game.
- The main CTA enters the existing `enterArena` transition; the preview cannot
  commit a schedule or alter the domain revision.
- The mobile layout keeps the same narrative order: thesis → floor → auditor →
  scenario signals → operating idea.

### Trade-offs recorded

| Gain | Limitation kept intentionally |
| --- | --- |
| More memorable product identity than a generic dashboard | The scene is CSS/DOM geometry rather than borrowed illustration or external 3D assets. |
| Agent feels present before gameplay begins | The trace is a truthful preview of the role, not native natural-language agent evidence. |
| Normal versus shock comparison is understandable immediately | The preview uses the fixed fixture and does not attempt to represent real operations. |
| Job selection makes the floor feel inspectable | Selection is presentation-only until the player enters the actual arena. |
| High visual density without network or dependency risk | The entry page is intentionally information-rich; typography and spacing must continue to be checked at narrow widths. |

This pass takes the strongest interaction lessons from Cora and MCPencil—distinct
world-building, an immediate action, an agent-specific surface, and visible shared
state—while keeping Flowline's own scheduling subject, synthetic boundary, and
human approval model. It does not claim that Flowline is objectively superior to
those projects; superiority remains a product and judge evaluation question.

## What remains intentionally unchanged

- The domain state machine, simulator, metrics, and WebMCP tool names.
- The existing game journey after entering the floor.
- Human-only confirmation and recovery boundaries.
- Synthetic data disclosure and no-network architecture.
- Flowline's working-name status; this pass does not lock a final submission title.

## Dark command deck pass — 2026-09-02

The next visual review identified the remaining mismatch: the earlier entry pass
used a light shell around a dark floor. The landing experience now uses one
dark-first visual system from the page canvas through the dashboard panels.

### Improvements applied

- The page canvas, top navigation, progress rail, planner panel, signal strip,
  method section, and footer now share a deep navy surface instead of alternating
  between white and dark panels.
- Cyan, blue, coral, and gold are reserved for operational state: ready, active,
  disruption, and priority. Body copy remains muted blue-white for hierarchy.
- The primary CTA is a high-contrast cyan-to-blue launch control with a visible
  depth state, so the first action reads like entering a game command deck.
- The station scene receives a stronger blue atmosphere, horizon glow, floor grid,
  orbit rings, route packets, and layered panel shadows without adding external
  assets; the heavier WebGL focus layer remains lazy and outside the landing path.
- The planner, floor, and Operations Auditor now read as one connected product
  surface rather than three unrelated cards.
- The same dark treatment is retained at 390px; the mobile composition collapses
  the dashboard without introducing a second color system.

### Deliberate limits

- This is a CSS/DOM dashboard treatment, not a claim that the landing preview is a
  native 3D scene.
- The preview remains presentation-only: Normal / Shock Test and job focus do not
  mutate the committed game state.
- No Cora or MCPencil code, assets, fonts, wording, or product dependency was
  introduced. Their publicly visible interaction lessons remain inspiration only.

### Render check

Chromium rendered the current local route at 1440 × 900 and 390 × 844 after the
dark pass. Both captures show the landing dashboard in the intended dark-first
composition; the dashboard, floor, auditor panel, CTA, and mobile stacking are
present in the rendered DOM. The browser fallback used for this check did not
provide a console-inspection API, so this evidence is visual/render evidence, not
a replacement for a full Playwright interaction run.

The arena target is implemented as a presentation layer in
`src/arena-target.css`. It reorganizes the existing gameplay surface into the
target's objective rail, shared floor, auditor rail, and decision bar without
moving scheduling logic into visual components. The floor map is a CSS-built 2.5D
explanation layer; it reads the same evaluated job order as the timeline and does
not maintain a separate score or simulator.

## Flowline result: gains and remaining trade-offs

| Result after this pass | Gain | Remaining limitation / reason |
| --- | --- | --- |
| first impression | The player sees a deliberate boot-to-brief journey instead of an uncontextualized form or static spike. | The boot is a short local transition, not evidence of a real network/model load. |
| product identity | Stations, handoff, job rail, deadline watch, and shift readout give the game a recognizable operations language. | CSS geometry cannot match the richness of a bespoke illustrated world; adding external art would increase rights and delivery risk. |
| gameplay clarity | The entry surface explains Build → Stress → Decide before the player reaches the detailed arena. | The full scheduling interaction still begins after the CTA; the dashboard intentionally does not become a second game mode. |
| immersion | Depth, perspective grid, routes, moving jobs, and a capacity alert make the floor feel active without adding a heavy rendering dependency. | The entry preview is 2.5D decoration; the existing gameplay/FocusScene remains the source of interactive state. |
| accessibility | Semantic headings, real buttons/links, readable labels, and a DOM-backed explanation keep the visual layer understandable without pixels. | Narrow-screen gameplay retains an internal timeline scroll so time slots remain legible; this is a deliberate interaction cost. |
| delivery | No external fonts, images, audio, wallet, network, or Cora dependency was added. | The result is less theatrically asset-rich than Cora, but it remains local-first, reproducible, and easier to license. |

The supplied arena mockup was also checked against the local route after the target
layer was applied. Desktop and mobile preserve the target's main vertical rhythm,
flat palette, two-column/one-column composition, readable timeline, and human
decision boundary. The browser check does not establish hosted or native-agent
evidence.

The chosen balance is intentional: Flowline borrows the reference's product-level
clarity and visual confidence while spending complexity on the scheduling mechanic,
WebMCP state contract, recovery, and judgeable evidence.

## Unified arena color system — 2026-09-02

The gameplay pages now use the same dark command-deck language as the entry
dashboard. `src/arena-dark-theme.css` is a scoped visual layer over the existing
arena structure; it does not alter the simulator, state machine, or tool contracts.

Applied surfaces:

- top navigation, round progress, and footer;
- shift brief, job order, and operating rules;
- shared floor, 2.5D station map, timeline, deadline rail, and metrics;
- Operations Auditor, tool activity, audit finding, and human decision bar;
- incident, proposal, receipt, recovery, exact-undo, and notice states;
- the field guide modal in both entry and gameplay contexts.

The palette uses deep navy surfaces, cyan/mint action and success states, coral
deadline/disruption states, gold proposal/review states, and pale blue semantic text.
The contrast is intentionally state-driven: color is paired with labels, icons, or
text so it is not the only status signal. The timeline and 2.5D floor remain the
same DOM-backed source of truth, and mobile keeps the internal timeline scroll where
time slots need to remain legible.

## Arena render verification — 2026-09-02

The local Vite route was exercised in Chromium through the complete UI path at
1440 × 900 and 390 × 844:

```text
entry → planning → guide → inspect → bottleneck → stress-test → compare
→ stage → human confirmation → disruption → recovery proposal → recovery receipt
→ exact-undo proposal
```

The captured states all rendered the arena canvas as deep navy with the intended
cyan/coral/gold accents. The desktop document had no horizontal overflow beyond its
scrollbar, the 390px document had zero horizontal overflow, and no console error or
uncaught exception was observed. This is browser visual/DOM evidence; it is not
natural-language agent replay evidence.

## Sequence rail placement pass — 2026-09-02

The editable job order is intentionally retained, but it no longer sits as a
detached card deep below the left objective rail. `JobOrderPanel` now lives directly
above `ScheduleStage` in the central operations column. This establishes a clear
information hierarchy:

```text
left: mission context  →  center: player sequence + live timeline  →  right: auditor
```

The sequence surface is compact, labels itself `PLAYER SEQUENCE / LIVE PLAN`, and
keeps the four reorder controls keyboard-operable. The timeline remains the visible
result of the order, so the control and the affected artifact are adjacent. The
operating rules remain in the left rail instead of competing with the plan.

The placement was checked in Chromium: at 1440px the sequence rail measured 819px ×
108px directly above the 819px timeline; at 390px it measured 351px × 199px with a
two-column job list, and the document had zero horizontal overflow. No simulator or
WebMCP behavior was changed by this layout pass.

## Acceptance criteria for this visual pass

- The boot screen is visible on a fresh local load and can be skipped.
- The entry dashboard explains the premise and presents the next action without
  requiring the player to understand scheduling terminology first.
- The control-room preview is recognizably about two stations, four jobs, deadlines,
  and a capacity change.
- The entry CTA still calls the existing `enterArena` transition and does not alter
  domain state behind the player's back.
- Desktop and 390px layouts have no horizontal overflow.
- The game remains keyboard- and DOM-readable; visual decoration is not the source
  of truth.
- No Cora code, asset, solver, wording, or product dependency is introduced.

## Browser verification of the applied direction

The entry layer was checked in Chromium against the local Vite route. The default
package port was occupied during the latest run, so the verification server used
port `4179`; this does not change the package's documented default port.

| Check | Result | Evidence |
| --- | --- | --- |
| fresh-load boot | PASS | boot screen rendered before the dashboard, exposed progress semantics, and offered `Skip intro` |
| desktop dashboard | PASS | viewport 1440px; document `scrollWidth` and `clientWidth` both measured 1425px; no page-level horizontal overflow |
| mobile dashboard | PASS | viewport 390px; document `scrollWidth` and `clientWidth` both measured 390px |
| existing gameplay entry | PASS | the primary CTA reached the existing `#arena` journey without a page error |
| reduced motion | PASS | media query matched and decorative job animation resolved to `none` |
| console/page errors | PASS | no console error or uncaught exception was observed in the visual run |

The control-room preview and rotated brand mark still report clipped descendant
geometry internally because they intentionally use CSS transforms. They are contained
and do not enlarge the document or create a page scrollbar. The gameplay timeline's
horizontal scroll on narrow screens is intentional: it preserves readable time slots
inside the arena while the outer page remains within the viewport.

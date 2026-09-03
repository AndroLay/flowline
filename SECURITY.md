# Security notes

Flowline is a static single-page learning game with no server of its own. This file records the
boundary an agent operates inside, because the part of a page worth reviewing is the part that
hands tools to a model.

## Attack surface

- **No backend, no database, no accounts.** The build output is HTML, CSS, JS and one SVG.
- **No network calls at runtime.** `src/**` contains no `fetch`, no `XMLHttpRequest` and no
  third-party script tag, so the only requests a browser makes are for the page's own assets.
- **No storage.** No cookies, no `localStorage`, no `sessionStorage`, no IndexedDB. A reload
  discards everything, which is also why no session played in the game can be replayed.
- **No secrets, and nothing to configure.** The app reads no environment variable at runtime,
  and the repository holds no token, key or credential.
- **No dynamic code or markup.** No `eval`, no `innerHTML`, no `dangerouslySetInnerHTML`.
- **Three runtime dependencies, pinned to exact versions:** `react`, `react-dom`, `three`.
- **The data is fictional.** Four jobs and two stations from `src/data/fixtures.ts`. No real
  person, customer, facility or operational dataset is involved.

## The agent boundary

Eight tools are registered on `document.modelContext` from one exported list in
`src/tools/webmcp.ts`. What a caller can and cannot do with them:

- **Reads return semantic state only** — revision, phase, job and station ids, metrics, and the
  causal path. They neither accept nor return mesh vertices,
  texture ids, camera matrices, URLs, file paths, shell strings or DOM selectors, so nothing in
  the surface addresses anything outside the board's own model.
- **No tool advertises `readOnlyHint`, including the six that only read the board.** Every one
  of the eight is registered with `annotations: { readOnlyHint: false, destructiveHint: false }`,
  because all eight write something visible on the page and a host may use a read-only hint to skip
  its confirmation prompt. What is true of those six is narrower than the annotation would
  claim: `inspect_board`, `list_shifts`, `find_bottleneck`, `simulate_disruption`, `compare_plans`
  and `review_shift` never touch
  `schedule` or `revision`, but they do change the explanation around them — `agentFocus` and
  `focus`, `lastAudit` on the two audits, `lastComparison` on the comparison — because
  an answer the player cannot see on the floor is not worth much. That narrower claim is kept as
  `boardReadOnly` on each spec in `src/tools/webmcp.ts`, asserted in `tests/tools.test.mts`, and
  used by the eval harness; it is deliberately not sent to a host as `readOnlyHint`.
- **Writes cannot commit.** `stage_schedule` and `undo_schedule` only ever produce a pending
  proposal. Confirmation is a human control that is deliberately not registered as a tool, so
  no sequence of tool calls can move the revision. In one recorded 40-step session, 28 tool
  calls moved it zero times. Across three sessions in which a model chose the calls itself the
  same held: 27 calls, and the revision moved only when the human-only control was clicked.
- **Two controls are deliberately not tools.** Confirming a plan, and entering the operations
  floor. Both advance the board's own revision — `enterArena` increments it in
  `src/domain/model.ts` — so registering either would let a sequence of tool calls move state,
  which is the one thing this surface promises it cannot do. The cost is visible and
  intentional: on a clean load all eight tools refuse until a human has entered the floor, with
  the reason "Enter the operations floor before asking the auditor to inspect the board."
- **Arguments are parsed strictly.** Wrong types, unknown job ids, duplicates, an
  order of the wrong length, a stale revision, and a call in the wrong phase are each refused
  with a reason rather than coerced. Every input schema sets `additionalProperties: false`, and
  the runtime enforces the same allowlist itself rather than trusting the client to have
  validated: an unadvertised key refuses the call as `invalid_input` and names the field —
  `inspect_board received an unsupported field: hurry.` The trace still records it as
  `off-schema: hurry`, so the session shows what a client sent even though nothing ran.
  Sixteen refusals appear in that same session.
- **A caller is not trusted about the world.** No tool can add a job, change capacity, move the
  deadline or alter the disruption; the simulator recomputes every outcome from the fixtures
  and the order alone.

## Reporting

This repository is public and GitHub Pages is enabled on it, though what it serves is the
repository's documentation folder rather than a build of the app. Either way there is no service
of Flowline's own behind it: a Pages deployment is static files on a host neither
this code nor its owner runs, and nothing in the build accepts a request, so a deployment adds
no endpoint to report against. Raise anything you find with the repository owner through
whichever channel the repository is published under; this spike has no separate disclosure
address.

## What this file is not

It is not a penetration test, an audit, or a dependency review. Every claim above is a property
of this source tree that can be checked by reading it. None of them is a statement about the
host: what a Pages deployment serves, over which TLS configuration, under whose account
settings, is outside this file and was not reviewed here.

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

Six tools are registered on `document.modelContext` from one exported list in
`src/tools/webmcp.ts`. What a caller can and cannot do with them:

- **Reads return semantic state only** — revision, phase, job and station ids, metrics, and the
  causal path. They neither accept nor return mesh vertices,
  texture ids, camera matrices, URLs, file paths, shell strings or DOM selectors, so nothing in
  the surface addresses anything outside the board's own model.
- **Writes cannot commit.** `stage_schedule` and `undo_schedule` only ever produce a pending
  proposal. Confirmation is a human control that is deliberately not registered as a tool, so
  no sequence of tool calls can move the revision. In one recorded 38-step session, 28 tool
  calls moved it zero times.
- **Two controls are deliberately not tools.** Confirming a plan, and entering the operations
  floor. Both advance the board's own revision — `enterArena` increments it in
  `src/domain/model.ts` — so registering either would let a sequence of tool calls move state,
  which is the one thing this surface promises it cannot do. The cost is visible and
  intentional: on a clean load all six tools refuse until a human has entered the floor, with
  the reason "Enter the operations floor before asking the auditor to inspect the board."
- **Arguments are parsed strictly.** Wrong types, unknown job ids, duplicates, an
  order of the wrong length, a stale revision, and a call in the wrong phase are each refused
  with a reason rather than coerced. Every input schema sets `additionalProperties: false`, and
  the runtime then reads tolerantly: an unadvertised key does not fail the call, it is named in
  the trace (`off-schema: hurry`) so the session shows what a client sent. Fourteen refusals
  appear in that same session.
- **A caller is not trusted about the world.** No tool can add a job, change capacity, move the
  deadline or alter the disruption; the simulator recomputes every outcome from the fixtures
  and the order alone.

## Reporting

Nothing here is deployed, so there is no live service to report against. Raise anything you
find with the repository owner through whichever channel the repository is published under;
this spike has no separate disclosure address.

## What this file is not

It is not a penetration test, an audit, or a dependency review. Every claim above is a property
of this source tree that can be checked by reading it. None of them is evidence that a hosted
deployment of Flowline would be safe, because no such deployment exists.

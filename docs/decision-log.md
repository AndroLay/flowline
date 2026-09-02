# Flowline decision log

## Decisions made for this isolated spike

### Separate package

Flowline is maintained under `submissions/flowline`. `submissions/withheld` is the only
other active submission package; the former `needs-and-means` placeholder is not a
separate fallback or candidate.

### Working name

`Flowline` is the package and working product name for this spike. It is not a final publication or Devpost naming decision.

### Product shape

The product is a compact learning game, not a scheduling dashboard, chatbot, optimizer, multiplayer service, or production operations system.

### Agent role

The agent is an Operations Auditor. It inspects, simulates, compares, and stages. The player is the planner and owns the final acceptance decision.

### Technical scope

React + TypeScript + Vite + CSS-native timeline, with an optional lazy-loaded
Three.js/WebGL focus explanation layer. There is no backend, database, external API,
hardware, or paid service. The scope is intentionally small enough to make
deterministic evidence and recovery visible; 2.5D remains the playable source of
truth and fallback.

### Scenario model

The simulator models four jobs through one preparation lane and two dispatch berths, followed by one deterministic berth-offline disruption. This is a clean-room fictional scenario built from standard scheduling concepts.

### Local fallback

The UI remains playable when `document.modelContext` is unavailable. The fallback is labeled in the interface and does not pretend that local button invocation is proof of agent-native replay.

### Entry experience reference

The Cora live demo and public README were reviewed as visual/product references. Flowline adopts the useful principles—clear identity, a staged entry, memorable arena state, progressive explanation, and one obvious CTA—but uses an original operations control room made from CSS and semantic HTML. Wallets, wagers, external assets, character roster, copied wording, and the reference's visual composition are explicitly excluded. The separate boot screen is a Flowline design addition; it is not claimed as an observed Cora feature.

## Open owner decisions

- whether Flowline becomes the second submission;
- final product title and public repository name;
- target native client for rehearsal;
- zero-cost hosting provider;
- public repository ownership and publication timing;
- final video language and narration;
- whether a small learner comprehension check is worth the remaining time;
- final submission and Devpost publication.

## Rejected for this spike

- copying Cora or any participant's code, visual assets, narrative, or layout;
- using a copied benchmark solver or challenge input/output;
- random disruptions that make the judge path non-reproducible;
- an “optimal schedule” claim;
- adding backend, multiplayer, leaderboard, or extra levels before the core journey is evidenced.

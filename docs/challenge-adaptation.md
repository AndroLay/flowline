# Flowline challenge adaptation and purpose

## Why Flowline exists

Flowline is an original educational scheduling game inspired by the central
systems problem in the [ICPC 2026 Online Challenge powered by Huawei on
Codeforces](https://codeforces.com/blog/entry/155646?locale=en&mobile=true).
The official problem asks a scheduler to coordinate staged work across local and
remote computers while balancing overall throughput against per-request latency
objectives. The [official problem statement](https://codeforces.com/contest/2251/problems)
describes an interactive event-driven system with preparation and repeated output
steps, transfers, concurrent resources, and legal scheduling choices.

The problem is technically valuable, but its complete model is too dense for a
short learning experience. Flowline exists to make one of its most important
ideas visible to a learner:

> A plan that looks fast under normal conditions can become fragile when a
> constrained resource changes.

The game turns that idea into a small, visual, replayable exercise. The player
creates a schedule, the page-aware Operations Auditor exposes the causal failure,
and the player decides whether a trade-off is worth accepting.

## What is adapted

Flowline adapts the scheduling tension and the observable cause-and-effect, not
the challenge implementation.

| Challenge concept | Flowline abstraction | Why it is useful for learning |
| --- | --- | --- |
| Work moving through local and remote processing resources | A job moving through `PREP BAY` and `DISPATCH BAY` | Makes staged work visible without requiring infrastructure knowledge |
| Multiple stages with resource contention | One preparation lane followed by two dispatch berths | Shows why capacity and order affect downstream work |
| Concurrent scheduling choices | The player orders four fictional jobs | Gives the player ownership of the decision instead of hiding it in an optimizer |
| Throughput versus per-request latency/SLO | Completed jobs, makespan, waiting, idle time, and job deadlines | Exposes trade-offs with concrete before/after evidence |
| Idle “bubbles” caused by dependencies or contention | Visible idle gaps and queue waiting on the timeline | Connects an empty slot to a causal scheduling decision |
| A scheduler operating under changing conditions | One deterministic berth-offline disruption after the initial plan | Lets the learner test robustness without random or opaque outcomes |

The mapping is intentionally conceptual. `PREP BAY`, `DISPATCH BAY`, Pantry,
Archive, Beacon, Relay, and the visual operations floor are Flowline's own
fictional vocabulary and scenario.

## What is deliberately simplified or omitted

Flowline is **not** a reduced implementation that preserves every constraint of
the Codeforces problem. It is a pedagogical abstraction with a smaller state
space and a different presentation.

The following parts are intentionally omitted:

- live request arrivals and the original interactor protocol;
- several remote computers and their exact assignment rules;
- transfer protocols, task-cost formulas, and network timing details;
- repeated token-generation/decode iterations;
- request grouping, input-stage chunking, and hidden future output lengths;
- the original command format, input/output format, scoring formula, and solver;
- any claim that the player found an optimal solution to the original challenge.

Instead, Flowline uses four jobs, two stations, a finite slot horizon, one fixed
disruption, and a pure deterministic simulator. This is small enough to inspect
visually, replay exactly, test exhaustively, and explain in a short judge path.

That simplification is the point: the learner practices scheduling intuition
before encountering the full complexity of an interactive systems challenge.
Flowline teaches the underlying trade-off; it does not claim to teach the
complete Huawei/Codeforces solution.

## Educational purpose

The primary audience is a student or early-career technical learner practicing
basic scheduling intuition. After one round, the learner should be able to:

1. distinguish a fast-looking plan from a robust plan;
2. identify a queue, bottleneck, or idle gap on a timeline;
3. explain why a deadline can fail even when every job eventually completes;
4. compare normal and disruption-tested outcomes;
5. describe one trade-off behind a human-confirmed recovery.

The measurable learning claim is deliberately narrow. Flowline does not claim to
measure scheduling expertise, produce a universally fair answer, or replace a
real operations scheduler. Any stronger learning or adoption claim requires a
separate learner study.

## Why WebMCP belongs in the adaptation

The challenge-inspired scheduling model is the subject matter. WebMCP supplies
the human-agent interaction that makes the lesson distinctive:

1. the agent reads the active board, phase, plan, and revision;
2. it finds a bottleneck using the same deterministic simulator as the UI;
3. it runs the disruption test against the live plan;
4. it compares a ghost alternative without committing it;
5. it stages a revision-bound proposal;
6. the human reviews, edits, accepts, rejects, or undoes the decision.

The agent is an Operations Auditor, not an answer key. The human still owns the
objective and the final trade-off. Removing WebMCP would leave a small scheduling
game, but it would remove the page-aware audit, shared revision context, visible
counterfactual, and agent-staged proposal that connect the learner's live plan to
the explanation.

## Originality boundary

Flowline uses ordinary scheduling ideas as public domain concepts and implements
an original fictional scenario, simulator, UI, tool contract, narrative, and
visual language. It does not copy the challenge's source code, solver, fixtures,
command syntax, input/output examples, variable names, scoring formula, visual
assets, or narrative.

The correct description for a submission is therefore:

> Flowline is an original WebMCP learning game that abstracts the core
> throughput-versus-latency scheduling tension of the ICPC challenge into a
> two-station, disruption-tested human-agent exercise.

It should not be described as a faithful simulator, official companion, solver,
or benchmark for the Huawei/Codeforces challenge.

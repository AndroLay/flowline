# Flowline game design

## Core thesis

An order that looks efficient in the normal shift can be fragile when capacity changes. The player learns the difference between a fast-looking plan and a plan that remains explainable under stress.

## Player and learning objective

Primary persona: a student or early-career technical learner practicing basic scheduling intuition.

After one round, the learner should be able to:

- identify the difference between preparation order and dispatch capacity;
- locate a bottleneck on a timeline;
- explain why a deadline can fail even when every job is eventually completed;
- compare a baseline plan with a disruption-tested plan;
- name what a human-confirmed recovery protects, and where it moves the slack.

This is an educational exercise, not a claim that the game measures scheduling expertise or produces a universally optimal answer.

## Scenario

| Job | Prep | Dispatch | Deadline | Role |
| --- | ---: | ---: | ---: | --- |
| Pantry | 2 | 1 | 8 | flexible standard job |
| Archive | 1 | 2 | 8 | long dispatch load |
| Beacon | 1 | 2 | 6 | critical deadline |
| Relay | 1 | 1 | 7 | late-gap job |

Default order: `Pantry → Archive → Beacon → Relay`.

Robust recovery order: `Beacon → Pantry → Archive → Relay`.

The event is deterministic: Dispatch Bay loses one of its two berths after the first plan is confirmed.

## One-round flow

### 1. Brief

The player sees the objective and the two-station pipeline. The guide explains the human/agent boundary before the game begins.

### 2. Plan

The player reorders job cards with a finger, with the arrow keys — `Home` and `End` for the ends — or with a mouse drag, and can do it from the queue rail or from the 2.5D floor, including dragging from either surface onto the other. The center timeline immediately shows preparation, dispatch lanes, deadlines, waiting, and current revision.

### 3. Audit

The Operations Auditor reads the active board and can:

- inspect the live revision;
- identify the active bottleneck;
- run the one-berth-offline stress test;
- compare any complete order it names, searched through the same evaluator the board
  uses rather than read from a reference answer.

The audit is explanatory. It does not decide what the player must value.

### 4. Human gate

The player writes a reason and stages a plan. A proposal appears with the exact order, revision, and editable reason. The board does not commit until the player confirms.

### 5. Incident

The player starts the shift. The berth-offline condition becomes visible in the timeline. In the default order, Beacon misses its deadline by one slot and Relay — queued behind it — misses by one as well, so two of four jobs are late; the player sees the causal queueing effect rather than receiving only a score.

### 6. Recovery

The player moves Beacon earlier, runs the audit again, stages the recovery, and confirms it. The critical job returns to on time under the disruption, and the timeline shows where the slack moved — see the measured outcome below.

### 7. Reflection and undo

The receipt preserves the confirmed order, revision, reason, and metrics. Exact undo is itself a proposal and requires the same human confirmation boundary.

## Metrics

- `on-time jobs`: jobs whose dispatch ends by their deadline;
- `makespan`: the final dispatch completion slot;
- `waiting`: time between preparation completion and dispatch start;
- `tardiness`: slots beyond a job deadline;
- `critical status`: whether Beacon meets deadline;
- `risk`: clear, watch, or critical.

No metric is presented as the moral or universal definition of a good schedule, and the game does not display a single aggregate number. (`ScheduleMetrics.score` exists in the simulator, but no surface renders it and no tool returns it, so nothing in the game can be played for points.)

## Measured outcome of the fixture

Recomputed from `evaluateSchedule` on 2026-09-03 — the same function the board, the tools and the 3D floor read. Every other statement about cost and robustness in this package should agree with this table and with the campaign table that follows it.

| Order | Condition | on-time | makespan | waiting | dispatch idle | risk | exactly on its deadline |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| default `P→A→B→R` | two berths | 4 / 4 | 6 | 0 | 10 | clear | Beacon |
| default `P→A→B→R` | one berth | 2 / 4 | 8 | 3 | 2 | critical | — (Beacon +1, Relay +1) |
| robust `B→P→A→R` | two berths | 4 / 4 | 6 | 0 | 10 | clear | — |
| robust `B→P→A→R` | one berth | 4 / 4 | 7 | 1 | 2 | clear | Relay |

Read honestly, this fixture does **not** make the learner pay for robustness on any reported metric: in the normal shift the two orders are identical on all six, and under the disruption the robust order is better on every one of them. So the recovery is not a sacrifice, and the lesson is not "robustness costs throughput". What the reorder actually moves is *where the slack sits*: the fast-looking default spends Beacon's last slot, so the deadline that matters is the one with no room left, and losing a berth breaks it. The recovery gives that slot back to Beacon and leaves Relay finishing exactly on its own deadline instead — visible on the timeline as the `at-risk` marker moving from the critical job to a flexible one. The extra slot of makespan (6 → 7) is the berth loss, not the reorder.

That is also why the game states no single answer: **16 of the 24 orders** keep all four jobs on time with one berth offline, and **13 of those tie at makespan 7**, which is the best any order achieves under the disruption. The default order is simply not one of them. A learner who protects Beacon early has found one of thirteen equally good plans, not the plan.

### The other two shifts do make the learner pay — recomputed 2026-09-03

The table above covers shift one only, and shift one is the ramp. Shifts two and three price robustness, which is where the campaign's harder claim actually lives. Same function, same day, `dispatchIdle` omitted because idle berths have no agreed direction:

| Shift | Condition | fast order | robust order | who is better |
| --- | --- | --- | --- | --- |
| `rolling-intake` | two berths | makespan 8, intake wait 4, prep starved 0, all 5 on time | makespan 10, intake wait 11, prep starved 2, all 5 on time | **fast**, on three metrics; the robust order buys nothing yet |
| `rolling-intake` | one berth | 4 / 5 on time, 1 tardy, critical late, score 74 | 5 / 5 on time, 0 tardy, critical on time, score 100 | **neither dominates**: the robust order wins the deadlines, the fast order keeps makespan 9 against 10 |
| `night-handover` | two berths, Vault arrives on time | makespan 8, all 5 on time | makespan 9, all 5 on time | **fast**, by one slot |
| `night-handover` | Vault three slots late | 2 / 5 on time, 3 tardy, intake wait 19, score 41 | 5 / 5 on time, 0 tardy, intake wait 8, score 100 | **robust**, on every reported metric |

So the sentence the campaign can defend is precise: in shift one the robust order is free, and in shifts two and three it costs a slower finish and a longer intake queue in normal conditions and repays it when the shock lands. `rolling-intake` is the only shift where both orders stay defensible *after* the shock, which makes it the one place "the best plan before the shock is not the best plan after it" is literally true rather than rhetorical — the scene belongs there, not on the ramp shift, where the robust order is also the better normal plan.

Two tests in `tests/model.test.mts` hold this shape in place: one pins each shift's relation, including the ramp's deliberate absence of a cost, and one fails if no shift prices robustness or if no shift leaves both orders defensible after the shock. If a future fixture edit makes the robust order strictly better everywhere, the second test fails rather than the claim quietly becoming false.

## Originality boundary

The game uses ordinary operations concepts in an original fictional scenario and interface. The clean-room rules are explicit: no copied solver, challenge input/output, API, variable names, visual composition, narrative, or participant assets. The key interaction is Flowline-specific: a page-aware auditor stress-tests the live learner plan, then the learner owns the acceptance decision.

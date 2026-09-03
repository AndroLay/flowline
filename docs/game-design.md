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

The player reorders job cards. The center timeline immediately shows preparation, dispatch lanes, deadlines, waiting, and current revision.

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

Recomputed from `evaluateSchedule` on 2026-09-03 — the same function the board, the tools and the 3D floor read. Every other statement about cost and robustness in this package should agree with this table.

| Order | Condition | on-time | makespan | waiting | dispatch idle | risk | exactly on its deadline |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| default `P→A→B→R` | two berths | 4 / 4 | 6 | 0 | 10 | clear | Beacon |
| default `P→A→B→R` | one berth | 2 / 4 | 8 | 3 | 2 | critical | — (Beacon +1, Relay +1) |
| robust `B→P→A→R` | two berths | 4 / 4 | 6 | 0 | 10 | clear | — |
| robust `B→P→A→R` | one berth | 4 / 4 | 7 | 1 | 2 | clear | Relay |

Read honestly, this fixture does **not** make the learner pay for robustness on any reported metric: in the normal shift the two orders are identical on all six, and under the disruption the robust order is better on every one of them. So the recovery is not a sacrifice, and the lesson is not "robustness costs throughput". What the reorder actually moves is *where the slack sits*: the fast-looking default spends Beacon's last slot, so the deadline that matters is the one with no room left, and losing a berth breaks it. The recovery gives that slot back to Beacon and leaves Relay finishing exactly on its own deadline instead — visible on the timeline as the `at-risk` marker moving from the critical job to a flexible one. The extra slot of makespan (6 → 7) is the berth loss, not the reorder.

That is also why the game states no single answer: **16 of the 24 orders** keep all four jobs on time with one berth offline, and **13 of those tie at makespan 7**, which is the best any order achieves under the disruption. The default order is simply not one of them. A learner who protects Beacon early has found one of thirteen equally good plans, not the plan.

## Originality boundary

The game uses ordinary operations concepts in an original fictional scenario and interface. The clean-room rules are explicit: no copied solver, challenge input/output, API, variable names, visual composition, narrative, or participant assets. The key interaction is Flowline-specific: a page-aware auditor stress-tests the live learner plan, then the learner owns the acceptance decision.

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
- name one trade-off behind a human-confirmed recovery.

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
- compare the robust reference order.

The audit is explanatory. It does not decide what the player must value.

### 4. Human gate

The player writes a reason and stages a plan. A proposal appears with the exact order, revision, and editable reason. The board does not commit until the player confirms.

### 5. Incident

The player starts the shift. The berth-offline condition becomes visible in the timeline. In the default order, Beacon misses its deadline by one slot; the player sees the causal queueing effect rather than receiving only a score.

### 6. Recovery

The player moves Beacon earlier, runs the audit again, stages the recovery, and confirms it. The critical job remains on time under the disruption and the timeline makes the trade-off visible.

### 7. Reflection and undo

The receipt preserves the confirmed order, revision, reason, and metrics. Exact undo is itself a proposal and requires the same human confirmation boundary.

## Metrics

- `on-time jobs`: jobs whose dispatch ends by their deadline;
- `makespan`: the final dispatch completion slot;
- `waiting`: time between preparation completion and dispatch start;
- `tardiness`: slots beyond a job deadline;
- `critical status`: whether Beacon meets deadline;
- `risk`: clear, watch, or critical.

No metric is presented as the moral or universal definition of a good schedule. The game deliberately exposes trade-offs instead of hiding them behind one “best” number.

## Originality boundary

The game uses ordinary operations concepts in an original fictional scenario and interface. The clean-room rules are explicit: no copied solver, challenge input/output, API, variable names, visual composition, narrative, or participant assets. The key interaction is Flowline-specific: a page-aware auditor stress-tests the live learner plan, then the learner owns the acceptance decision.

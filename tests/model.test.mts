import assert from "node:assert/strict";
import test from "node:test";
import { scenario } from "../src/data/fixtures.ts";
import {
  applyDisruption,
  auditSchedule,
  confirmPending,
  createInitialState,
  enterArena,
  evaluateSchedule,
  prepareUndo,
  reorderJob,
  stageSchedule,
  validateSchedule,
  type GameState,
  type Schedule,
  type Transition,
} from "../src/domain/model.ts";

function stateOf<T>(transition: Transition<T>): T {
  assert.equal(transition.ok, true, transition.ok ? undefined : transition.error.message);
  return transition.state;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

test("the default schedule is efficient in normal conditions but brittle under the shock", () => {
  const audit = auditSchedule(scenario, scenario.defaultSchedule);
  assert.equal(audit.baseline.metrics.onTimeJobs, 4);
  assert.equal(audit.baseline.metrics.makespan, 6);
  assert.equal(audit.baseline.metrics.criticalOnTime, true);
  assert.equal(audit.stress.metrics.onTimeJobs, 2);
  assert.equal(audit.stress.metrics.criticalOnTime, false);
  assert.equal(audit.stress.metrics.criticalTardiness, 1);
  assert.equal(audit.severity, "critical");
  assert.match(audit.finding, /BEACON.*misses by 1 slot/);
});

test("the robust order preserves the critical deadline after one berth goes offline", () => {
  const audit = auditSchedule(scenario, scenario.robustSchedule);
  assert.equal(audit.stress.metrics.criticalOnTime, true);
  assert.equal(audit.stress.metrics.tardyJobs, 0);
  assert.equal(audit.stress.metrics.makespan, 7);
  assert.equal(audit.stress.metrics.totalWaiting, 1);
  assert.equal(audit.severity, "clear");
});

test("all 24 four-job permutations are deterministic and obey the two-stage pipeline", () => {
  const schedules = permutations(scenario.defaultSchedule);
  assert.equal(schedules.length, 24);
  const signatures = new Set<string>();

  for (const schedule of schedules) {
    const first = evaluateSchedule(scenario, schedule, { dispatchParallelism: 1 });
    const second = evaluateSchedule(scenario, schedule, { dispatchParallelism: 1 });
    assert.deepEqual(first, second);
    assert.equal(first.jobs.length, 4);
    for (const run of first.jobs) {
      assert.ok(run.prepStart < run.prepEnd);
      assert.ok(run.dispatchStart >= run.prepEnd);
      assert.ok(run.dispatchStart < run.dispatchEnd);
      assert.equal(run.tardiness, Math.max(0, run.dispatchEnd - scenario.jobs.find((job) => job.id === run.jobId)!.deadline));
    }
    signatures.add(`${first.metrics.makespan}:${first.metrics.tardyJobs}:${first.metrics.totalWaiting}`);
  }

  assert.ok(signatures.size > 1, "the schedule order must change observable outcomes");
});

test("invalid schedules are rejected without silently repairing player input", () => {
  const duplicate = validateSchedule(scenario, ["pantry", "pantry", "beacon", "relay"]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "invalid_schedule");

  const unknown = validateSchedule(scenario, ["pantry", "archive", "beacon", "unknown"] as Schedule);
  assert.equal(unknown.ok, false);
});

test("human-gated schedule lifecycle supports stale protection, disruption, recovery, and exact undo", () => {
  let state: GameState = createInitialState(scenario);
  state = stateOf(enterArena(state));

  const stale = stageSchedule(state, scenario.defaultSchedule, "Keep the current order", state.revision - 1);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, "stale_revision");

  state = stateOf(stageSchedule(state, scenario.defaultSchedule, "Protect the current shift", state.revision));
  assert.equal(state.phase, "awaiting_review");
  assert.equal(state.pendingProposal?.kind, "schedule");

  const blockedEdit = reorderJob(state, 0, 1);
  assert.equal(blockedEdit.ok, false);
  if (!blockedEdit.ok) assert.equal(blockedEdit.error.code, "pending_proposal");

  state = stateOf(confirmPending(state));
  assert.equal(state.phase, "applied");
  assert.equal(state.receipts.length, 1);
  assert.equal(state.activeReceipt?.action, "applied");

  state = stateOf(applyDisruption(state));
  assert.equal(state.phase, "disrupted");
  assert.equal(state.shockApplied, true);
  assert.equal(state.lastAudit?.stress.metrics.criticalOnTime, false);

  state = stateOf(reorderJob(state, 2, 0));
  assert.deepEqual(state.schedule, scenario.robustSchedule);
  state = stateOf(stageSchedule(state, scenario.robustSchedule, "Put the critical job first after the berth loss.", state.revision));
  state = stateOf(confirmPending(state));
  assert.equal(state.lastAudit?.stress.metrics.criticalOnTime, true);
  assert.equal(state.receipts.length, 2);

  const activeReceipt = state.activeReceipt!;
  state = stateOf(prepareUndo(state, activeReceipt.id, state.revision));
  assert.equal(state.pendingProposal?.kind, "undo");
  state = stateOf(confirmPending(state));
  assert.deepEqual(state.schedule, scenario.defaultSchedule);
  assert.equal(state.activeReceipt?.action, "undone");
  assert.equal(state.receipts.length, 3);
});

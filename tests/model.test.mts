import assert from "node:assert/strict";
import test from "node:test";
import { scenario } from "../src/data/fixtures.ts";
import {
  applyDisruption,
  auditSchedule,
  confirmPending,
  createInitialState,
  endSlot,
  enterArena,
  evaluateSchedule,
  jobVerdict,
  prepareUndo,
  reorderJob,
  recommendSchedule,
  slotWindow,
  stageSchedule,
  startSlot,
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

/**
 * One verdict, decided once. The 3D floor used to run its own rule — anything that had
 * waited for a berth was "at risk" — while the timeline legend printed the same word for
 * a state its bars never drew, so the two surfaces disagreed about a job and the board
 * promised a colour it had no way to show. The rule is slack: a run that lands in the
 * last slot its deadline allows is on time and one lost slot from not being, which is
 * this scenario's whole lesson.
 */
test("a job's verdict is the slack its own deadline leaves it, and only that", () => {
  const deadline = { deadline: 6 };
  assert.equal(jobVerdict({ dispatchEnd: 4 }, deadline), "on-time");
  assert.equal(jobVerdict({ dispatchEnd: 6 }, deadline), "at-risk");
  assert.equal(jobVerdict({ dispatchEnd: 7 }, deadline), "missed");

  const critical = scenario.jobs.find((job) => job.priority === "critical")!;
  const normal = evaluateSchedule(scenario, scenario.defaultSchedule);
  const shocked = evaluateSchedule(scenario, scenario.defaultSchedule, { dispatchParallelism: scenario.disruption.dispatchParallelism });
  const criticalIn = (evaluation: typeof normal) => evaluation.jobs.find((run) => run.jobId === critical.id)!;
  // The efficient order clears the critical job in its final slot, so the board that
  // looks safest is the one the legend has to mark, and losing the berth is what turns
  // that mark into a miss.
  assert.equal(criticalIn(normal).verdict, "at-risk");
  assert.equal(criticalIn(normal).onTime, true);
  assert.equal(criticalIn(shocked).verdict, "missed");

  // A verdict never contradicts the run it belongs to: waiting for a berth is not a
  // verdict of its own, and `missed` is exactly `!onTime` on every job of every order.
  for (const order of permutations([...scenario.defaultSchedule]) as Schedule[]) {
    for (const parallelism of [1, 2]) {
      for (const run of evaluateSchedule(scenario, order, { dispatchParallelism: parallelism }).jobs) {
        const job = scenario.jobs.find((entry) => entry.id === run.jobId)!;
        assert.equal(run.verdict === "missed", !run.onTime);
        assert.equal(run.verdict, jobVerdict(run, job));
      }
    }
  }
});

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

test("the auditor searches for its candidate instead of reading the scenario's worked example", () => {
  const critical = scenario.jobs.find((job) => job.priority === "critical")!;
  const fromDefault = recommendSchedule(scenario, scenario.defaultSchedule);
  assert.ok(fromDefault);
  // The candidate is judged by the evaluator, not by the fixture: it has to hold the
  // critical deadline with a berth offline, and hold it with margin left over.
  const proposed = fromDefault.audit.stress.jobs.find((run) => run.jobId === critical.id)!;
  assert.equal(proposed.onTime, true);
  assert.equal(fromDefault.audit.stress.metrics.tardyJobs, 0);
  assert.ok(proposed.dispatchEnd < critical.deadline, "the winning order keeps margin, not just the deadline");
  assert.match(fromDefault.reason, /BEACON/);

  // Nothing left to propose once the board is the best order available — which is how a
  // solved round is recognised without comparing against a stored answer.
  assert.equal(recommendSchedule(scenario, fromDefault.schedule), undefined);

  // And the proof that no fixture is read back: a board the worked example says nothing
  // about gets its own candidate, reached by moving the fewest jobs that still works.
  const fromBad = recommendSchedule(scenario, ["archive", "relay", "pantry", "beacon"]);
  assert.ok(fromBad);
  assert.notDeepEqual(fromBad.schedule, scenario.robustSchedule);
  assert.equal(fromBad.audit.stress.metrics.criticalOnTime, true);
  assert.equal(fromBad.movedJobs, 2);

  // Same board, same candidate: the ranking is total, so a rail and a tool call made a
  // render apart cannot disagree about what the auditor is proposing.
  assert.deepEqual(recommendSchedule(scenario, scenario.defaultSchedule), fromDefault);
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

/**
 * The slot convention itself, pinned once so no surface can quietly re-derive it. Every
 * number a reader sees comes from these three functions, and the off-by-one this test
 * would now catch was real: the focus page announced a dispatch one slot after the
 * timeline drew it.
 */
test("reader-facing slots are 1-based and inclusive on every run of every plan", () => {
  for (const schedule of permutations(scenario.defaultSchedule)) {
    for (const parallelism of [1, 2]) {
      const evaluation = evaluateSchedule(scenario, schedule, { dispatchParallelism: parallelism });
      for (const run of evaluation.jobs) {
        const job = scenario.jobs.find((item) => item.id === run.jobId)!;
        // The first slot the job occupies in its berth, and the last one.
        assert.equal(startSlot(run), run.dispatchStart + 1);
        assert.equal(endSlot(run), run.dispatchEnd);
        // Counted inclusively, those two bounds span exactly the work the job does.
        assert.equal(endSlot(run) - startSlot(run) + 1, job.dispatchDuration);
        // A deadline is an end-slot number already, so it is compared against the last
        // occupied slot with no adjustment. This is the whole reason the convention has
        // to be single: "on time" is decided by the same reading the page prints.
        assert.equal(run.onTime, endSlot(run) <= job.deadline);
        assert.equal(run.tardiness, Math.max(0, endSlot(run) - job.deadline));
        // Every slot in the window is inside the horizon a page can draw.
        assert.ok(startSlot(run) >= 1 && endSlot(run) <= scenario.horizon);
        // And the label form spans the same two bounds the numbers do.
        assert.equal(slotWindow(run.dispatchStart, run.dispatchEnd), `${startSlot(run)}–${endSlot(run)}`);
        // Prep is measured on the same clock, which is what lets one helper describe
        // both stages of the pipeline.
        assert.equal(slotWindow(run.prepStart, run.prepEnd), `${run.prepStart + 1}–${run.prepEnd}`);
      }
    }
  }
});

test("invalid schedules are rejected without silently repairing player input", () => {
  const duplicate = validateSchedule(scenario, ["pantry", "pantry", "beacon", "relay"]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "invalid_schedule");

  const unknown = validateSchedule(scenario, ["pantry", "archive", "beacon", "unknown"] as Schedule);
  assert.equal(unknown.ok, false);
});

test("idle dispatch capacity counts unused berth slots and is not cancelled by waiting time", () => {
  const dispatchWork = scenario.jobs.reduce((total, job) => total + job.dispatchDuration, 0);
  const normal = evaluateSchedule(scenario, scenario.defaultSchedule, { dispatchParallelism: 2 });
  const offline = evaluateSchedule(scenario, scenario.defaultSchedule, { dispatchParallelism: 1 });

  assert.equal(normal.metrics.dispatchIdle, scenario.horizon * 2 - dispatchWork);
  assert.equal(offline.metrics.dispatchIdle, scenario.horizon * 1 - dispatchWork);

  // Losing a berth halves the capacity on offer, so idle capacity has to fall — but
  // it may not fall to zero just because jobs queued. This plan waits 3 slots on one
  // berth while 2 berth-slots of the shift still go unused, and both numbers are true
  // at once: subtracting the waiting would have reported an impossible zero.
  assert.ok(offline.metrics.dispatchIdle < normal.metrics.dispatchIdle);
  assert.equal(offline.metrics.totalWaiting, 3);
  assert.ok(offline.metrics.dispatchIdle > 0, "queued jobs do not erase unused berth capacity");
});

test("the audit never reports a plan as holding when the evaluation says a job misses", () => {
  // Beacon last misses its own deadline before any berth goes offline, so the finding
  // has to open on the normal shift instead of blaming the disruption.
  const beaconLast = auditSchedule(scenario, ["pantry", "archive", "relay", "beacon"]);
  assert.equal(beaconLast.baseline.metrics.criticalOnTime, false);
  assert.equal(beaconLast.severity, "critical");
  assert.match(beaconLast.finding, /already misses its deadline by 1 slot in the normal shift/);
  assert.match(beaconLast.finding, /by 2 slots once a dispatch berth goes offline/);

  // A plan can also leave a non-critical job late in both shifts, adding none under
  // the shock. Nothing about that is clear, so the ladder has a branch for it.
  const tight = { ...scenario, jobs: scenario.jobs.map((job) => (job.id === "archive" ? { ...job, deadline: 6 } : job)) };
  const alreadyLate = auditSchedule(tight, ["pantry", "beacon", "relay", "archive"]);
  assert.equal(alreadyLate.baseline.metrics.criticalOnTime, true);
  assert.equal(alreadyLate.stress.metrics.tardyJobs - alreadyLate.baseline.metrics.tardyJobs, 0);
  assert.equal(alreadyLate.baseline.metrics.tardyJobs, 1);
  assert.equal(alreadyLate.severity, "watch");
  assert.match(alreadyLate.finding, /1 other job already misses its deadline in the normal shift/);
  assert.doesNotMatch(alreadyLate.finding, /stays on time/);
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

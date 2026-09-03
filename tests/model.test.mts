import assert from "node:assert/strict";
import test from "node:test";
import { scenario, shifts } from "../src/data/fixtures.ts";
import {
  applyDisruption,
  auditSchedule,
  closeShift,
  confirmPending,
  createInitialState,
  criticalJob,
  dispatchBerths,
  endSlot,
  enterArena,
  evaluateSchedule,
  jobVerdict,
  prepareUndo,
  reorderJob,
  recommendSchedule,
  resetRound,
  shiftOptions,
  slotWindow,
  stageSchedule,
  startShift,
  startSlot,
  validateSchedule,
  type GameState,
  type Schedule,
  type Scenario,
  type ScheduleEvaluation,
  type Transition,
} from "../src/domain/model.ts";

/** The run of one job in one evaluation, which is what most assertions here are about. */
function runOf(evaluation: ScheduleEvaluation, jobId: string) {
  const run = evaluation.jobs.find((job) => job.jobId === jobId);
  assert.ok(run, `evaluation has no run for ${jobId}`);
  return run;
}

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

/**
 * Three shifts have to be three lessons. Each one is a plan that works on a floor which never
 * changes, a disruption that takes that away, and a way out a player can reach — if any of
 * those three is missing the shift is either unwinnable or not worth playing.
 */
test("every shift is solvable under its own disruption, and its default order is not the answer", () => {
  for (const shift of shifts) {
    const critical = criticalJob(shift);
    const calm = evaluateSchedule(shift, shift.defaultSchedule, shiftOptions(shift, false));
    const shocked = evaluateSchedule(shift, shift.defaultSchedule, shiftOptions(shift, true));
    const robust = evaluateSchedule(shift, shift.robustSchedule, shiftOptions(shift, true));

    assert.equal(runOf(calm, critical.id).onTime, true, `${shift.id}: the default order has to hold before the shock`);
    assert.equal(calm.metrics.tardyJobs, 0, `${shift.id}: the default order has to be clean before the shock`);

    assert.ok(shocked.metrics.score < calm.metrics.score, `${shift.id}: the disruption has to cost the default order something`);
    assert.ok(shocked.metrics.tardyJobs > 0, `${shift.id}: the default order has to break under the shock`);

    assert.equal(runOf(robust, critical.id).verdict, "on-time", `${shift.id}: the way out has to keep margin, not land on the deadline`);
    assert.equal(robust.metrics.tardyJobs, 0, `${shift.id}: the way out has to land every job`);
    assert.ok(robust.metrics.score > shocked.metrics.score, `${shift.id}: replanning has to pay`);
  }
});

/**
 * The campaign is not one shift three times. Shift 1 is a full floor losing a berth, shift 2
 * adds an intake the plan has to wait for, and shift 3's shock is a late arrival rather than
 * lost capacity — so the guide, the finding and the card all have to read for either kind.
 */
test("the campaign covers both kinds of shock and both kinds of intake", () => {
  assert.deepEqual(shifts.map((shift) => shift.order), [1, 2, 3]);
  assert.equal(new Set(shifts.map((shift) => shift.id)).size, shifts.length);

  const shape = shifts.map((shift) => ({
    id: shift.id,
    staggered: shift.jobs.some((job) => job.releaseAt > 0),
    berthsLost: dispatchBerths(shift) - shift.disruption.dispatchParallelism,
    lateArrivals: (shift.disruption.releaseDelays ?? []).length,
  }));
  for (const entry of shape) {
    assert.ok(entry.berthsLost > 0 || entry.lateArrivals > 0, `${entry.id}: a disruption has to take something away`);
    assert.ok(entry.berthsLost >= 0, `${entry.id}: a shock cannot add berths`);
  }
  assert.ok(shape.some((entry) => entry.berthsLost > 0 && entry.lateArrivals === 0), "one shift has to lose capacity");
  assert.ok(shape.some((entry) => entry.lateArrivals > 0 && entry.berthsLost === 0), "one shift has to be shocked by a late arrival");
  assert.ok(shape.some((entry) => !entry.staggered), "one shift has to start with the whole floor already in intake");
  assert.ok(shape.filter((entry) => entry.staggered).length >= 2, "the queue has to be part of more than one shift");
});

/**
 * The intake queue, checked on every order of every shift under both conditions. Two costs come
 * out of it and they are not the same cost: a job that arrived while the crew was busy waited in
 * intake, and a crew with nothing to prep was starved. Confusing the two would let a plan blame
 * the floor for a queue it created, and the result card reports them on separate lines.
 */
test("prep never starts before a job arrives, and the queue's two costs stay apart", () => {
  for (const shift of shifts) {
    for (const order of permutations([...shift.defaultSchedule])) {
      for (const shocked of [false, true]) {
        const options = shiftOptions(shift, shocked);
        const delays = new Map((options.releaseDelays ?? []).map((delay) => [delay.jobId, delay.slots]));
        const evaluation = evaluateSchedule(shift, order, options);
        const where = `${shift.id} ${order.join(",")} shocked=${shocked}`;
        let starvedFromRuns = 0;
        let prepCursor = 0;
        for (const jobId of order) {
          const run = runOf(evaluation, jobId);
          const releaseAt = shift.jobs.find((job) => job.id === jobId)!.releaseAt + (delays.get(jobId) ?? 0);
          assert.equal(run.releaseAt, releaseAt, `${where}: ${jobId} reports the arrival it was evaluated with`);
          assert.ok(run.prepStart >= releaseAt, `${where}: ${jobId} was prepped before it arrived`);
          assert.equal(run.intakeWait, Math.max(0, prepCursor - releaseAt), `${where}: ${jobId}'s intake wait is the crew being busy`);
          starvedFromRuns += Math.max(0, releaseAt - prepCursor);
          prepCursor = run.prepEnd;
        }
        assert.equal(evaluation.metrics.prepStarved, starvedFromRuns, `${where}: starved slots are the crew waiting, not the queue`);
        assert.equal(
          evaluation.metrics.totalIntakeWait,
          order.reduce((total, jobId) => total + runOf(evaluation, jobId).intakeWait, 0),
          `${where}: the intake total is the sum of its runs`,
        );
        assert.ok(evaluation.metrics.prepStarved === 0 || evaluation.metrics.totalIntakeWait >= 0, `${where}: both costs are reported`);
      }
    }
  }
});

/**
 * One shock, one description of it. `shiftOptions` is the only place that turns a shift and a
 * flag into evaluation conditions, because the bug it replaced was a hand-written copy that
 * hardcoded two berths and dropped the late arrivals — so a confirmed receipt on shift 3 was
 * judged on a floor the player was not standing on.
 */
test("a shock is described in one place, and it carries both of its halves", () => {
  for (const shift of shifts) {
    const calm = shiftOptions(shift, false);
    assert.equal(calm.dispatchParallelism, dispatchBerths(shift), `${shift.id}: an unshocked floor runs every berth`);
    assert.equal(calm.releaseDelays, undefined, `${shift.id}: an unshocked floor has no late arrivals`);

    const shocked = shiftOptions(shift, true);
    assert.equal(shocked.dispatchParallelism, shift.disruption.dispatchParallelism, `${shift.id}: the shock owns the berth count`);
    assert.deepEqual(shocked.releaseDelays, shift.disruption.releaseDelays, `${shift.id}: the shock owns the late arrivals`);
    assert.deepEqual(
      evaluateSchedule(shift, shift.defaultSchedule, shocked).metrics,
      evaluateSchedule(shift, shift.defaultSchedule, {
        dispatchParallelism: shift.disruption.dispatchParallelism,
        releaseDelays: shift.disruption.releaseDelays,
      }).metrics,
      `${shift.id}: the helper and the disruption describe the same floor`,
    );
  }
});

/**
 * The board's ruler is drawn from the makespan, so the makespan has to be the last slot any job
 * occupies — otherwise a bar lands in a column the strip never drew. On two of the three shifts a
 * bad order finishes after the shift is over, which is why the strip cannot assume the horizon.
 */
test("the makespan is the last slot the plan actually occupies, horizon or not", () => {
  let sawOverrun = 0;
  for (const shift of shifts) {
    for (const order of permutations([...shift.defaultSchedule])) {
      for (const shocked of [false, true]) {
        const evaluation = evaluateSchedule(shift, order, shiftOptions(shift, shocked));
        const last = Math.max(...evaluation.jobs.map((run) => Math.max(run.prepEnd, run.dispatchEnd)));
        assert.equal(evaluation.metrics.makespan, last, `${shift.id} ${order.join(",")}: the makespan has to cover every bar`);
        if (last > shift.horizon) sawOverrun += 1;
      }
    }
  }
  assert.ok(sawOverrun > 0, "a plan that runs past its shift has to be possible, or the ruler is over-engineered");
});

/**
 * The whole shift, once, the way a player runs it: commit the plan the floor came with, meet the
 * shock, replan, close. Two things are checked that nothing else can check — that a receipt
 * confirmed after the shock is judged on the shocked floor (it was not: the conditions were
 * hardcoded, so shift 3's late arrival never reached a confirmed receipt), and that a closed
 * board is inert.
 */
test("a shift closes into a card that agrees with the board, and a closed board stops moving", () => {
  const shift = shifts.find((entry) => entry.id === "night-handover")!;
  let state: GameState = createInitialState(shift);
  state = stateOf(enterArena(state));
  state = stateOf(stageSchedule(state, shift.defaultSchedule, "Open on the order the floor came with.", state.revision));
  state = stateOf(confirmPending(state));
  state = stateOf(applyDisruption(state));
  assert.equal(state.shockApplied, true);

  state = stateOf(stageSchedule(state, shift.robustSchedule, "Vault arrives late, so prep it after Manifest.", state.revision));
  state = stateOf(confirmPending(state));
  const onTheFloor = evaluateSchedule(shift, shift.robustSchedule, shiftOptions(shift, true));
  assert.deepEqual(state.activeReceipt?.metrics.metrics, onTheFloor.metrics, "a receipt is judged on the floor it was confirmed on");
  assert.ok(onTheFloor.metrics.totalIntakeWait > 0, "shift 3's late arrival has to show up in the receipt it was confirmed under");

  const closed = stateOf(closeShift(state, []));
  assert.equal(closed.phase, "closed");
  const card = closed.resultCard!;
  assert.deepEqual(card.evaluation.metrics, onTheFloor.metrics, "the card reports the board that was closed");
  assert.deepEqual(card.finalSchedule, shift.robustSchedule);
  assert.equal(card.scenarioId, shift.id);
  assert.equal(card.shiftOrder, shift.order);
  assert.equal(card.score, onTheFloor.metrics.score);
  assert.equal(card.objectivesGraded, card.objectives.filter((objective) => objective.graded).length);
  assert.equal(card.objectivesMet, card.objectives.filter((objective) => objective.graded && objective.met).length);
  assert.equal(card.activity.humanConfirmations, closed.receipts.length);
  assert.equal(card.activity.toolCalls, 0, "no tool ran in this shift, and the card must not invent one");
  assert.ok(card.summary.length >= 5, "the card has to be readable as text");
  assert.deepEqual(closed.results.map((result) => result.scenarioId), [shift.id]);

  // Every mutating transition refuses on a closed board, so the card cannot be contradicted.
  for (const [name, transition] of [
    ["reorderJob", reorderJob(closed, shift.robustSchedule[0]!, 3)],
    ["stageSchedule", stageSchedule(closed, shift.defaultSchedule, "One more idea.", closed.revision)],
    ["applyDisruption", applyDisruption(closed)],
    ["closeShift", closeShift(closed, [])],
  ] as const) {
    assert.equal(transition.ok, false, `${name} has to refuse on a closed board`);
  }

  // Moving on keeps the cards; replaying the same shift keeps them too.
  const next = stateOf(startShift(closed, shifts[0]!));
  assert.equal(next.scenario.id, shifts[0]!.id);
  assert.equal(next.phase, "setup");
  assert.equal(next.resultCard, undefined, "a fresh shift starts without a card of its own");
  assert.deepEqual(next.results.map((result) => result.scenarioId), [shift.id], "the campaign remembers what was closed");
  assert.deepEqual(resetRound(closed).results.map((result) => result.scenarioId), [shift.id], "a replay keeps the cards already earned");
});

import assert from "node:assert/strict";
import test from "node:test";
import { scenario } from "../src/data/fixtures.ts";
import {
  applyDisruption,
  auditSchedule,
  createInitialState,
  confirmPending,
  enterArena,
  evaluateSchedule,
  recordComparison,
  setFocus,
  stageSchedule,
  type GameState,
  type Transition,
} from "../src/domain/model.ts";
import {
  deriveSceneModel,
  floorPlacements,
  jobPhaseAt,
  sceneModelAtSlot,
  timePlacements,
} from "../src/visual/scene-model.ts";

function stateOf<T>(transition: Transition<T>): T {
  assert.equal(transition.ok, true, transition.ok ? undefined : transition.error.message);
  return transition.state;
}

test("the floor draws the domain's verdict and never derives one of its own", () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  const critical = scenario.jobs.find((job) => job.priority === "critical")!;
  for (const parallelism of [2, 1]) {
    const evaluation = evaluateSchedule(scenario, state.schedule, { dispatchParallelism: parallelism });
    const model = deriveSceneModel(state, evaluation);
    for (const job of model.jobs) {
      assert.equal(job.status, evaluation.jobs.find((run) => run.jobId === job.id)!.verdict);
    }
    // Both surfaces name the same job in the same state: the board legends "at risk" and
    // the floor tints it gold off this one field, so the last slot before the deadline
    // cannot read as safe on one surface and marked on the other.
    assert.equal(model.jobs.find((job) => job.id === critical.id)!.status, parallelism === 2 ? "at-risk" : "missed");
  }
});

test("scene model preserves entity IDs, revision, focus, and committed metrics", () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  state = setFocus(state, { stationId: "prep", jobId: "archive", reason: "You picked ARCHIVE while it is still in prep.", source: "player" });
  const evaluation = evaluateSchedule(scenario, state.schedule);
  const model = deriveSceneModel(state, evaluation);

  assert.equal(model.revision, state.revision);
  assert.equal(model.focusedStationId, "prep");
  assert.equal(model.selectedJobId, "archive");
  assert.deepEqual(model.stations.map((station) => station.id), ["prep", "dispatch"]);
  assert.deepEqual(model.jobs.map((job) => job.id), state.schedule);
  assert.equal(model.jobs.find((job) => job.id === "archive")?.selected, true);
  assert.equal(model.metrics.makespan, evaluation.metrics.makespan);
  assert.equal(model.ghostJobs.length, 0);
});

test("scene model exposes a pending plan as a ghost without changing committed state", () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  state = stateOf(stageSchedule(state, scenario.robustSchedule, "Test the recovery order", state.revision));
  const committedEvaluation = evaluateSchedule(scenario, scenario.defaultSchedule);
  const ghostEvaluation = evaluateSchedule(scenario, scenario.robustSchedule);
  const model = deriveSceneModel(state, committedEvaluation, { ghostEvaluation });

  assert.equal(model.phase, "awaiting_review");
  assert.deepEqual(model.jobs.map((job) => job.id), scenario.defaultSchedule);
  assert.deepEqual(model.ghostJobs.map((job) => job.id), scenario.robustSchedule);
  assert.equal(model.metrics.onTimeJobs, committedEvaluation.metrics.onTimeJobs);
  assert.ok(model.availableActions.includes("confirm (human)"));
});

test("a compared candidate draws a ghost floor only while it still describes the board", () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  // Both plans are read under the shift the board is asking about — one berth down —
  // because that is the shift the two orders actually disagree in.
  const committedEvaluation = evaluateSchedule(scenario, state.schedule, { dispatchParallelism: 1 });
  const ghostEvaluation = evaluateSchedule(scenario, scenario.robustSchedule, { dispatchParallelism: 1 });
  state = recordComparison(state, scenario.robustSchedule, auditSchedule(scenario, scenario.robustSchedule));

  const compared = deriveSceneModel(state, committedEvaluation, { ghostEvaluation });
  assert.deepEqual(compared.jobs.map((job) => job.id), scenario.defaultSchedule);
  assert.deepEqual(compared.ghostJobs.map((job) => job.id), scenario.robustSchedule);
  assert.equal(compared.ghostSource, "comparison");
  // The comparison is a reading, not a decision: it may not move the board's own
  // audit sentence or its phase.
  assert.equal(compared.audited, false);
  assert.equal(compared.phase, "planning");
  // Beacon misses in the committed order under the shock and holds in the candidate,
  // so the two routes have to end on different words.
  assert.notDeepEqual(compared.ghostRoute, compared.causeRoute);
  assert.equal(compared.causeRoute.at(-1), "BEACON LATE");
  assert.equal(compared.ghostRoute?.at(-1), "BEACON ON TIME");

  const stale = deriveSceneModel({ ...state, revision: state.revision + 1 }, committedEvaluation, { ghostEvaluation });
  assert.equal(stale.ghostJobs.length, 0);
  assert.equal(stale.ghostSource, undefined);
  assert.equal(stale.ghostRoute, undefined);
});

test("a floor stand is only occupied when the plan really has a job standing on it", () => {
  const state: GameState = stateOf(enterArena(createInitialState(scenario)));

  // Both berths staffed: the two jobs still in prep stand on the pads, and each
  // berth holds the job its lane is working on when the shift runs out.
  const staffed = evaluateSchedule(scenario, state.schedule);
  assert.deepEqual(floorPlacements(staffed), [
    { jobId: "pantry", site: "prep-a", tag: "Prep 1" },
    { jobId: "archive", site: "prep-b", tag: "Prep 2" },
    { jobId: "beacon", site: "berth-1", tag: "Berth 01" },
    { jobId: "relay", site: "berth-2", tag: "Berth 02" },
  ]);

  // One berth down, the same order: beacon has finished prep but has nowhere to
  // dispatch from, so it waits at the transfer gate instead of appearing to run
  // beside relay, and the lost berth simply holds nothing.
  const short = evaluateSchedule(scenario, state.schedule, { dispatchParallelism: 1 });
  const stands = floorPlacements(short);
  assert.deepEqual(stands.find((stand) => stand.jobId === "beacon"), { jobId: "beacon", site: "gate", tag: "Q1" });
  assert.deepEqual(stands.find((stand) => stand.jobId === "relay"), { jobId: "relay", site: "berth-1", tag: "Berth 01" });
  assert.equal(stands.filter((stand) => stand.site === "berth-2").length, 0);
  const occupied = stands.filter((stand) => stand.site !== "queue").map((stand) => stand.site);
  assert.equal(new Set(occupied).size, occupied.length, "no stand may hold two jobs at once");

  const model = deriveSceneModel(state, short);
  assert.deepEqual(model.berths.map((berth) => [berth.active, berth.job?.id]), [[true, "relay"], [false, undefined]]);
});

test("scene model reflects disruption capacity and the same audit outcome as the timeline", () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  state = stateOf(stageSchedule(state, scenario.defaultSchedule, "Keep the baseline for the test", state.revision));
  state = stateOf(confirmPending(state));
  state = stateOf(applyDisruption(state));
  const evaluation = evaluateSchedule(scenario, state.schedule, { dispatchParallelism: 1 });
  const model = deriveSceneModel(state, evaluation);

  assert.equal(model.shockApplied, true);
  assert.equal(model.stations.find((station) => station.id === "dispatch")?.activeCapacity, 1);
  assert.equal(model.stations.find((station) => station.id === "dispatch")?.disrupted, true);
  assert.equal(model.metrics.onTimeJobs, evaluation.metrics.onTimeJobs);
  assert.equal(model.jobs.find((job) => job.id === "beacon")?.status, "missed");
});

test("a job's phase is read off its own run on the same half-open clock the bars are drawn on", () => {
  const state: GameState = stateOf(enterArena(createInitialState(scenario)));
  // One berth down, beacon is the job that has to wait: prep 3→4, dispatch 5→7. Walking
  // one job across the shift is what proves the boundaries, because every phase here is
  // one slot wide and an off-by-one would show up as a phase that never happens.
  const short = evaluateSchedule(scenario, state.schedule, { dispatchParallelism: 1 });
  const beacon = short.jobs.find((run) => run.jobId === "beacon")!;
  assert.deepEqual(
    Array.from({ length: scenario.horizon + 1 }, (_, slot) => jobPhaseAt(beacon, slot)),
    ["queued", "queued", "queued", "queued", "prepping", "waiting", "dispatching", "dispatching", "done"],
  );
});

test("no floor stand holds two jobs at any slot of the shift", () => {
  const state: GameState = stateOf(enterArena(createInitialState(scenario)));
  for (const parallelism of [2, 1]) {
    const evaluation = evaluateSchedule(scenario, state.schedule, { dispatchParallelism: parallelism });
    const model = deriveSceneModel(state, evaluation);
    for (let slot = 0; slot <= scenario.horizon; slot += 1) {
      const stands = timePlacements(model.jobs, slot);
      const occupied = stands.filter((stand) => stand.site !== "queue").map((stand) => stand.site);
      assert.equal(new Set(occupied).size, occupied.length, `two jobs shared a stand at slot ${slot}`);
      // A berth may only be held by a job actually dispatching in that lane at this slot,
      // so playback cannot show a block standing in a berth the plan has not sent it to.
      for (const stand of stands.filter((entry) => entry.site.startsWith("berth-"))) {
        const job = model.jobs.find((entry) => entry.id === stand.jobId)!;
        assert.equal(jobPhaseAt(job, slot), "dispatching");
        assert.equal(stand.site, job.dispatchLane === 0 ? "berth-1" : "berth-2");
      }
    }
  }
});

test("a floor read at one slot puts every job where the plan has it at that moment", () => {
  const state: GameState = stateOf(enterArena(createInitialState(scenario)));
  const model = deriveSceneModel(state, evaluateSchedule(scenario, state.schedule));

  // Slot 3: pantry is the first job out of a berth, archive has taken the prep lane
  // behind it, beacon is the one prep takes next, and relay is still off the floor.
  assert.deepEqual(timePlacements(model.jobs, 3), [
    { jobId: "pantry", site: "berth-1", tag: "Berth 01" },
    { jobId: "archive", site: "prep-a", tag: "Prep 1" },
    { jobId: "beacon", site: "prep-b", tag: "Prep next" },
    { jobId: "relay", site: "queue", tag: "Queued" },
  ]);

  // Slot 5: both berths are working, pantry has cleared the floor rather than lingering
  // in the berth it finished in, and each berth reads the lane the plan dispatched from.
  assert.deepEqual(timePlacements(model.jobs, 5), [
    { jobId: "pantry", site: "queue", tag: "Cleared" },
    { jobId: "archive", site: "berth-2", tag: "Berth 02" },
    { jobId: "beacon", site: "berth-1", tag: "Berth 01" },
    { jobId: "relay", site: "prep-a", tag: "Prep 1" },
  ]);

  // The same slot with one berth down: beacon has finished prep and can only stand at
  // the transfer gate, which is the waiting the timeline charges it for.
  const short = deriveSceneModel(state, evaluateSchedule(scenario, state.schedule, { dispatchParallelism: 1 }));
  assert.deepEqual(timePlacements(short.jobs, 5), [
    { jobId: "pantry", site: "queue", tag: "Cleared" },
    { jobId: "archive", site: "berth-1", tag: "Berth 01" },
    { jobId: "beacon", site: "gate", tag: "Q1" },
    { jobId: "relay", site: "prep-a", tag: "Prep 1" },
  ]);
});

test("playing the shift back moves the blocks and leaves every claim about the plan alone", () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  state = setFocus(state, { stationId: "dispatch", jobId: "beacon", reason: "Watch the critical job.", source: "player" });
  const evaluation = evaluateSchedule(scenario, state.schedule);
  const live = deriveSceneModel(state, evaluation);
  const played = sceneModelAtSlot(live, 5);

  // The floor is reseated: at slot 5 both berths are working, where the live floor shows
  // each lane's last tenant. That difference is the whole point of playback.
  assert.deepEqual(live.berths.map((berth) => berth.job?.id), ["beacon", "relay"]);
  assert.deepEqual(played.berths.map((berth) => berth.job?.id), ["beacon", "archive"]);
  assert.deepEqual(played.jobs.map((job) => job.site), ["queue", "berth-2", "berth-1", "prep-a"]);
  assert.deepEqual(played.jobs.map((job) => job.phase), ["done", "dispatching", "dispatching", "prepping"]);
  assert.equal(live.jobs.every((job) => job.phase === undefined), true);
  assert.equal(played.focusJob?.id, "beacon");
  assert.equal(played.focusJob?.phase, "dispatching");

  // Verdicts, metrics and both routes are claims about the whole plan, so a moment in it
  // may not restate them: the critical job is at risk at every slot, not only at its last.
  assert.equal(played.revision, live.revision);
  assert.deepEqual(played.metrics, live.metrics);
  assert.deepEqual(played.causeRoute, live.causeRoute);
  assert.deepEqual(played.jobs.map((job) => job.status), live.jobs.map((job) => job.status));
  assert.equal(played.jobs.find((job) => job.id === "beacon")?.status, "at-risk");
  assert.equal(played.auditFinding, live.auditFinding);

  // The meter reads work done, so it only ever goes forwards and is full once the shift
  // is over — a block cannot appear to un-work itself as the scrub advances.
  let previous = Array.from({ length: live.jobs.length }, () => 0);
  for (let slot = 0; slot <= scenario.horizon; slot += 1) {
    const meters = sceneModelAtSlot(live, slot).jobs.map((job) => job.meter);
    meters.forEach((meter, index) => assert.ok(meter >= previous[index]!, `meter fell back at slot ${slot}`));
    previous = meters;
  }
  assert.deepEqual(previous, [1, 1, 1, 1]);
});

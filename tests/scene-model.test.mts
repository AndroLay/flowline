import assert from "node:assert/strict";
import test from "node:test";
import { scenario } from "../src/data/fixtures.ts";
import {
  applyDisruption,
  createInitialState,
  confirmPending,
  enterArena,
  evaluateSchedule,
  setFocus,
  stageSchedule,
  type GameState,
  type Transition,
} from "../src/domain/model.ts";
import { deriveSceneModel } from "../src/visual/scene-model.ts";

function stateOf<T>(transition: Transition<T>): T {
  assert.equal(transition.ok, true, transition.ok ? undefined : transition.error.message);
  return transition.state;
}

test("scene model preserves entity IDs, revision, focus, and committed metrics", () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  state = setFocus(state, { stationId: "prep", jobId: "archive", source: "player" });
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

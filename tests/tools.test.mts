import assert from "node:assert/strict";
import test from "node:test";
import { scenario } from "../src/data/fixtures.ts";
import { createInitialState, enterArena, type GameState, type ToolEvent } from "../src/domain/model.ts";
import { createFlowlineRuntime } from "../src/tools/webmcp.ts";

test("the runtime exposes structured tools and refuses read access before the shift starts", async () => {
  let state: GameState = createInitialState(scenario);
  const events: ToolEvent[] = [];
  const runtime = createFlowlineRuntime({
    readState: () => state,
    writeState: (nextState) => { state = nextState; },
    emit: (event) => { events.push({ ...event, id: `event-${events.length + 1}`, at: new Date(0).toISOString() }); },
  });

  const setupResult = await runtime.invoke("inspect_board");
  assert.equal(setupResult.ok, false);
  if (!setupResult.ok) assert.equal(setupResult.code, "precondition_failed");

  const entered = enterArena(state);
  assert.equal(entered.ok, true);
  if (entered.ok) state = entered.state;

  const inspected = await runtime.invoke("inspect_board");
  assert.equal(inspected.ok, true);
  if (inspected.ok) {
    assert.equal(inspected.data?.revision, state.revision);
    assert.deepEqual(inspected.data?.schedule, scenario.defaultSchedule);
  }
  assert.equal(state.agentFocus, "inspected");

  const invalid = await runtime.invoke("compare_plans", { schedule: ["pantry", "pantry"] });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "invalid_schedule");
  assert.ok(events.some((event) => event.tool === "inspect_board"));

  const staged = await runtime.invoke("stage_schedule", {
    schedule: scenario.defaultSchedule,
    reason: "Keep the clear baseline for review",
    expectedRevision: state.revision,
  });
  assert.equal(staged.ok, true);
  assert.equal(state.phase, "awaiting_review");

  const duplicate = await runtime.invoke("stage_schedule", {
    schedule: scenario.robustSchedule,
    reason: "Try another plan",
    expectedRevision: state.revision,
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, "pending_proposal");
});

test("native registration is six tools with typed state-changing boundaries", async () => {
  const registered: Array<{ name: string; annotations?: { readOnlyHint?: boolean }; inputSchema: Record<string, unknown> }> = [];
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      modelContext: {
        registerTool: (definition: typeof registered[number]) => { registered.push(definition); },
      },
    },
  });

  try {
    const runtime = createFlowlineRuntime({
      readState: () => createInitialState(scenario),
      writeState: () => undefined,
      emit: () => undefined,
    });
    const snapshot = await runtime.settled;
    assert.equal(snapshot.complete, true);
    assert.deepEqual(snapshot.registered, ["inspect_board", "find_bottleneck", "simulate_disruption", "compare_plans", "stage_schedule", "undo_schedule"]);
    assert.equal(registered.length, 6);
    assert.ok(registered.every((tool) => tool.inputSchema.additionalProperties === false));
    assert.equal(registered.find((tool) => tool.name === "stage_schedule")?.annotations, undefined);
    assert.equal(registered.find((tool) => tool.name === "inspect_board")?.annotations?.readOnlyHint, true);
    assert.equal((registered.find((tool) => tool.name === "stage_schedule")?.inputSchema.required as string[]).includes("expectedRevision"), true);
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, "document", previousDescriptor);
    else delete (globalThis as typeof globalThis & { document?: unknown }).document;
  }
});

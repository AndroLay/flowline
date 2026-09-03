import assert from "node:assert/strict";
import test from "node:test";
import { scenario, shifts } from "../src/data/fixtures.ts";
import { applyDisruption, closeShift, comparisonIsCurrent, confirmPending, createInitialState, enterArena, reorderJob, stageSchedule, type GameState, type Scenario, type ToolEvent, type Transition } from "../src/domain/model.ts";
import { createFlowlineRuntime, toolSpecs } from "../src/tools/webmcp.ts";

function stateOf<T>(transition: Transition<T>): T {
  assert.equal(transition.ok, true, transition.ok ? undefined : transition.error.message);
  return transition.state;
}

/**
 * Four questions, four answers on the floor. Two of these tools used to leave the focus
 * exactly where the other put it — "where does this plan bind" and "what breaks when a
 * berth goes" both landed on the first late job — so the scene moved without ever saying
 * anything the player could not already read in the rail. The test is on the reasons as
 * well as the targets: a target with no sentence is a camera move, not an explanation.
 */
test("each agent tool aims the floor at its own cause, and says which one", async () => {
  let state: GameState = createInitialState(scenario);
  state = stateOf(enterArena(state));
  // A confirmed plan with a berth down, so the bottleneck reading and the shock reading
  // have something to disagree about.
  state = stateOf(stageSchedule(state, scenario.defaultSchedule, "Open the shift on the efficient order.", state.revision));
  state = stateOf(confirmPending(state));
  state = stateOf(applyDisruption(state));
  assert.equal(state.shockApplied, true);
  const runtime = createFlowlineRuntime({
    readState: () => state,
    writeState: (nextState) => { state = nextState; },
    emit: () => undefined,
  });
  const aim = async (tool: string, input?: Record<string, unknown>) => {
    const result = await runtime.invoke(tool, input);
    assert.equal(result.ok, true, `${tool} did not run`);
    return state.focus;
  };

  const read = await aim("inspect_board");
  assert.equal(read.stationId, "prep");
  assert.match(read.reason, /first into prep/);

  const bottleneck = await aim("find_bottleneck");
  assert.match(bottleneck.reason, /constraint|busiest station/);
  assert.match(bottleneck.reason, /with a berth offline/);

  const shock = await aim("simulate_disruption");
  // The shock points at the berth the shift lost — berth 2, the one the floor draws
  // locked — by number, which is the one thing the bottleneck reading never names.
  assert.equal(shock.stationId, "dispatch");
  assert.equal(shock.berthIndex, 1);
  assert.match(shock.reason, /berth 2/i);
  assert.notEqual(shock.reason, bottleneck.reason);

  const compared = await aim("compare_plans", { schedule: scenario.robustSchedule });
  // Both orders hold the same four jobs, so the only pair of routes worth drawing at
  // once is the job the two orders dispatch differently.
  assert.match(compared.reason, /Two routes/);
  assert.match(compared.reason, /the board dispatches it in slots .+ the candidate in slots /);

  const staged = await aim("stage_schedule", {
    schedule: scenario.robustSchedule,
    reason: "One berth is offline, so the critical job has to go first.",
    expectedRevision: state.revision,
  });
  assert.match(staged.reason, /Staged for review/);
  assert.match(staged.reason, /moves from position \d+ to position \d+/);

  const reasons = new Set([read, bottleneck, shock, compared, staged].map((focus) => focus.reason));
  assert.equal(reasons.size, 5);
});

test("an agent proposal is revision-bound to the exact candidate it compared", async () => {
  let state: GameState = stateOf(enterArena(createInitialState(scenario)));
  const runtime = createFlowlineRuntime({
    readState: () => state,
    writeState: (nextState) => { state = nextState; },
    emit: () => undefined,
  });
  const withoutComparison = await runtime.invoke("stage_schedule", {
    schedule: scenario.robustSchedule,
    reason: "Protect the critical deadline",
    expectedRevision: state.revision,
  });
  assert.equal(withoutComparison.ok, false);
  if (!withoutComparison.ok) assert.equal(withoutComparison.code, "precondition_failed");
  assert.equal(state.pendingProposal, undefined);

  assert.equal((await runtime.invoke("compare_plans", { schedule: scenario.robustSchedule })).ok, true);
  const staged = await runtime.invoke("stage_schedule", {
    schedule: scenario.robustSchedule,
    reason: "Protect the critical deadline",
    expectedRevision: state.revision,
  });
  assert.equal(staged.ok, true);
  assert.deepEqual(state.pendingProposal?.schedule, scenario.robustSchedule);
});

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
    assert.deepEqual((inspected.data?.queue as Array<{ id: string }>).map((job) => job.id), scenario.defaultSchedule);
    assert.equal((inspected.data?.stations as Array<{ id: string; capacity: number }>).find((station) => station.id === "dispatch")?.capacity, 2);
    assert.ok((inspected.data?.availableActions as string[]).includes("compare_plans"));
  }
  assert.equal(state.agentFocus, "inspected");

  const invalid = await runtime.invoke("compare_plans", { schedule: ["pantry", "pantry"] });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "invalid_schedule");
  assert.ok(events.some((event) => event.tool === "inspect_board"));

  const compared = await runtime.invoke("compare_plans", { schedule: scenario.robustSchedule });
  assert.equal(compared.ok, true);

  const staged = await runtime.invoke("stage_schedule", {
    schedule: scenario.robustSchedule,
    reason: "Keep the robust order for review",
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

test("a compared candidate is filed apart from the board's own audit and stops counting when it goes stale", async () => {
  let state: GameState = createInitialState(scenario);
  const entered = enterArena(state);
  assert.equal(entered.ok, true);
  if (entered.ok) state = entered.state;
  const runtime = createFlowlineRuntime({
    readState: () => state,
    writeState: (nextState) => { state = nextState; },
    emit: () => undefined,
  });

  // Four entries with one job listed twice: the advertised schema forbids it, but the
  // runtime cannot assume a client validated before calling.
  const repeated = await runtime.invoke("compare_plans", { schedule: ["pantry", "pantry", "beacon", "relay"] });
  assert.equal(repeated.ok, false);
  if (!repeated.ok) assert.equal(repeated.code, "invalid_schedule");
  assert.equal(state.lastComparison, undefined);

  assert.equal((await runtime.invoke("find_bottleneck")).ok, true);
  const boardFinding = state.lastAudit?.finding;
  assert.ok(boardFinding);

  const compared = await runtime.invoke("compare_plans", { schedule: scenario.robustSchedule });
  assert.equal(compared.ok, true);
  // The sentence the focus rail quotes must still describe the order on the timeline,
  // not the candidate nobody committed.
  assert.equal(state.lastAudit?.finding, boardFinding);
  assert.deepEqual(state.lastAudit?.baseline.schedule, state.schedule);
  assert.deepEqual(state.lastComparison?.schedule, scenario.robustSchedule);
  assert.deepEqual(state.lastComparison?.baseSchedule, state.schedule);
  assert.equal(comparisonIsCurrent(state), true);
  if (compared.ok) {
    assert.deepEqual(compared.data?.candidate, scenario.robustSchedule);
    assert.deepEqual(compared.data?.activeSchedule, state.schedule);
  }

  // The predicate is the defence, not the clearing: a comparison whose revision no
  // longer matches the board describes a floor that is not on screen.
  assert.equal(comparisonIsCurrent({ ...state, revision: state.revision + 1 }), false);
  // And one whose candidate is now the active order has nothing left to contrast.
  assert.equal(comparisonIsCurrent({ ...state, schedule: scenario.robustSchedule }), false);

  const moved = reorderJob(state, 2, 0);
  assert.equal(moved.ok, true);
  if (moved.ok) state = moved.state;
  assert.equal(state.lastComparison, undefined);
});

test("every call leaves one trace line, refusals included, and the trace never copies the reason", async () => {
  let state: GameState = createInitialState(scenario);
  const events: ToolEvent[] = [];
  const runtime = createFlowlineRuntime({
    readState: () => state,
    writeState: (nextState) => { state = nextState; },
    emit: (event) => { events.push({ ...event, id: `event-${events.length + 1}`, at: new Date(0).toISOString() }); },
  });

  // Refused before the shift starts. A log that records only what succeeded is not
  // evidence of a boundary, so the refusal and its code are on the trace.
  await runtime.invoke("inspect_board");
  const refusal = events.at(-1)!;
  assert.equal(refusal.ok, false);
  assert.equal(refusal.code, "precondition_failed");
  assert.equal(refusal.phase, "setup");
  assert.equal(refusal.revisionBefore, refusal.revisionAfter);
  assert.equal(refusal.focus, undefined);

  const entered = enterArena(state);
  assert.equal(entered.ok, true);
  if (entered.ok) state = entered.state;

  await runtime.invoke("inspect_board");
  const read = events.at(-1)!;
  assert.equal(read.ok, true);
  assert.equal(read.kind, "read");
  assert.equal(read.code, undefined);
  assert.equal(read.focus?.stationId, "prep");
  assert.equal(read.focus?.jobId, state.schedule[0]);
  assert.equal(read.focus?.source, "agent");
  // The focus has to be able to say what it is showing. A target without a sentence is
  // a camera move, and the trace could not tell the four tools' causes apart.
  assert.match(read.focus!.reason, new RegExp(scenario.jobs.find((job) => job.id === state.schedule[0])!.shortLabel));
  const compared = await runtime.invoke("compare_plans", { schedule: scenario.robustSchedule });
  assert.equal(compared.ok, true);
  const reason = "Berth two is down for maintenance until Friday";
  const offSchema = await runtime.invoke("stage_schedule", {
    schedule: scenario.robustSchedule,
    reason,
    expectedRevision: state.revision,
    hurry: true,
  });
  assert.equal(offSchema.ok, false);
  if (!offSchema.ok) assert.equal(offSchema.code, "invalid_input");
  assert.equal(state.pendingProposal, undefined);
  const rejected = events.at(-1)!;
  assert.equal(rejected.kind, "proposal");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.revisionBefore, rejected.revisionAfter);
  assert.ok(rejected.input?.includes("off-schema: hurry"));

  const staged = await runtime.invoke("stage_schedule", {
    schedule: scenario.robustSchedule,
    reason,
    expectedRevision: state.revision,
  });
  assert.equal(staged.ok, true);
  const proposal = events.at(-1)!;
  assert.equal(proposal.kind, "proposal");
  assert.equal(proposal.proposalId, state.pendingProposal?.proposalId);
  // Staging is not a change: the committed revision is the same on both sides.
  assert.equal(proposal.revisionBefore, proposal.revisionAfter);
  // The arguments are described, not copied: the length of the reason, never its text.
  assert.ok(proposal.input?.includes(`reason ${reason.length} chars`));
  assert.equal(proposal.input?.includes("maintenance"), false);
  assert.ok(proposal.input?.includes("schedule beacon→pantry→archive→relay"));
  // The schema forbids extra keys, and the dispatcher rejects one before it reaches the
  // domain transition. The preceding refusal keeps that boundary visible in the trace.
  assert.equal(proposal.input?.includes("off-schema: hurry"), false);

  // Refused while a plan waits for review, and the refusal does not borrow the ID of
  // the proposal that is already pending.
  await runtime.invoke("stage_schedule", { schedule: scenario.defaultSchedule, reason: "Another idea", expectedRevision: state.revision });
  const blocked = events.at(-1)!;
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "pending_proposal");
  assert.equal(blocked.proposalId, undefined);
  assert.equal(blocked.phase, "awaiting_review");

  await runtime.invoke("undo_schedule", { receiptId: "receipt-9", expectedRevision: state.revision });
  const recovery = events.at(-1)!;
  assert.equal(recovery.kind, "recovery");
  assert.equal(recovery.ok, false);
  assert.equal(recovery.receiptId, "receipt-9");

  const unknown = await runtime.invoke("make_coffee");
  assert.equal(unknown.ok, false);
  assert.equal(events.at(-1)?.kind, "system");
  assert.equal(events.at(-1)?.code, "invalid_input");
  assert.equal(events.at(-1)?.input, undefined);
  assert.equal(events.length, 8);
});

test("tool calls are serialised, so a host that applies a write later cannot serve a stale board", async () => {
  let state: GameState = createInitialState(scenario);
  const entered = enterArena(state);
  assert.equal(entered.ok, true);
  if (entered.ok) state = entered.state;

  const trace: string[] = [];
  // The runtime reads the board once while it is being built, to derive the schedule schema
  // from the loaded shift's job list. That read is not a tool call, so the trace starts
  // after construction — otherwise this test would count the constructor as a racing caller.
  let recording = false;
  const runtime = createFlowlineRuntime({
    readState: () => {
      if (recording) trace.push(state.lastAudit ? "read audited" : "read fresh");
      return state;
    },
    // React applies state on its own schedule, so this host deliberately lands the
    // write a macrotask late: that gap is the window a second call would race through.
    writeState: async (next) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      state = next;
      trace.push("write");
    },
    emit: () => undefined,
  });
  recording = true;

  const [first, second] = await Promise.all([
    runtime.invoke("find_bottleneck"),
    runtime.invoke("compare_plans", { schedule: scenario.robustSchedule }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  // Neither call discarded the other: the audit the first one filed and the candidate
  // the second one compared are both on the board.
  assert.ok(state.lastAudit);
  assert.deepEqual(state.lastComparison?.schedule, scenario.robustSchedule);
  assert.deepEqual(state.lastComparison?.baseSchedule, state.schedule);
  assert.equal(
    trace.filter((entry) => entry === "read fresh").length,
    1,
    "only the first call may read a board that has no audit on it yet",
  );
  assert.equal(trace.indexOf("write") < trace.indexOf("read audited"), true);
});

test("native registration is eight tools with typed state-changing boundaries", async () => {
  const registered: Array<{ name: string; annotations?: { readOnlyHint: boolean; destructiveHint: boolean }; inputSchema: Record<string, unknown> }> = [];
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
    assert.equal(snapshot.provenance, "unverified");
    assert.deepEqual(snapshot.registered, ["inspect_board", "list_shifts", "find_bottleneck", "simulate_disruption", "compare_plans", "review_shift", "stage_schedule", "undo_schedule"]);
    assert.equal(registered.length, 8);
    assert.ok(registered.every((tool) => tool.inputSchema.additionalProperties === false));
    // Not one of the eight claims to be read-only, because not one of them is: the audits
    // write focus and their own finding, the two writes file a proposal. A host that sees
    // readOnlyHint false has to decide whether to prompt, which is the honest position to put
    // it in — the narrower promise, that none of them can move the revision, is what the
    // journey artifact demonstrates instead of what an annotation asserts.
    assert.equal(registered.every((tool) => tool.annotations?.readOnlyHint === false), true);
    assert.equal(registered.every((tool) => tool.annotations?.destructiveHint === false), true);
    assert.equal(toolSpecs(scenario).filter((spec) => spec.boardReadOnly).map((spec) => spec.name).join(","),
      "inspect_board,list_shifts,find_bottleneck,simulate_disruption,compare_plans,review_shift");
    // The advertised schedule is the loaded shift's own job list, not a constant: the
    // five-job shift has to advertise five ids or a correct client cannot call it.
    const items = (tool: string, shift: Scenario) =>
      (toolSpecs(shift).find((spec) => spec.name === tool)?.inputSchema as { properties?: { schedule?: { maxItems?: number; items?: { enum?: string[] } } } })?.properties?.schedule;
    assert.equal(items("compare_plans", scenario)?.maxItems, 4);
    assert.deepEqual(items("stage_schedule", shifts[1])?.items?.enum, shifts[1].jobs.map((job) => job.id));
    assert.equal(items("stage_schedule", shifts[1])?.maxItems, 5);
    assert.equal((registered.find((tool) => tool.name === "stage_schedule")?.inputSchema.required as string[]).includes("expectedRevision"), true);
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, "document", previousDescriptor);
    else delete (globalThis as typeof globalThis & { document?: unknown }).document;
  }
});

// A page cannot verify that `document.modelContext` came from a browser, so the snapshot must
// never say it did. This is the assertion that keeps the arena's badge honest: the label is
// derived from `provenance`, and no branch of it produces the word "native".
test("registration provenance is absent, unverified, or a declared test double — never native", async () => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const settle = async (modelContext?: Record<string, unknown>) => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: modelContext ? { modelContext } : {},
    });
    return createFlowlineRuntime({
      readState: () => createInitialState(scenario),
      writeState: () => undefined,
      emit: () => undefined,
    }).settled;
  };

  try {
    const absent = await settle();
    assert.equal(absent.provenance, "absent");
    assert.equal(absent.phase, "unsupported");
    assert.equal(absent.available, false);

    // Any WebMCP client, real or scripted, looks like this. The page claims only the registration.
    const unverified = await settle({ registerTool: () => undefined });
    assert.equal(unverified.provenance, "unverified");
    assert.equal(unverified.phase, "registered");
    assert.match(unverified.note, /registered on document\.modelContext/);

    // This project's own harnesses set the flag, so every evidence capture is labelled scripted.
    const double = await settle({ registerTool: () => undefined, flowlineTestDouble: true });
    assert.equal(double.provenance, "test-double");
    assert.equal(double.phase, "registered");
    assert.match(double.note, /scripted test double/);

    for (const snapshot of [absent, unverified, double]) assert.doesNotMatch(snapshot.note, /native/i);
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, "document", previousDescriptor);
    else delete (globalThis as typeof globalThis & { document?: unknown }).document;
  }
});

test("native registration survives a StrictMode double mount and releases the tools it owns", async () => {
  const live = new Set<string>();
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      modelContext: {
        // Async on purpose: the real API returns a promise, and that is what lets one
        // mount's registration still be in flight when the next mount begins.
        registerTool: async (definition: { name: string }) => {
          await Promise.resolve();
          live.add(definition.name);
        },
        unregisterTool: async (name: string) => {
          await Promise.resolve();
          live.delete(name);
        },
      },
    },
  });
  const host = {
    readState: () => createInitialState(scenario),
    writeState: () => undefined,
    emit: () => undefined,
  };

  try {
    // One mount and one unmount, with teardown starting while registration is still in
    // flight: nothing may stay registered behind the component that owned it.
    const solo = createFlowlineRuntime(host);
    await solo.cleanup();
    assert.deepEqual([...live], []);

    // StrictMode's order: mount, tear that same mount down, mount again. The teardown
    // may not strip the second mount's tools, and the second mount has to end up
    // owning all eight.
    const first = createFlowlineRuntime(host);
    const teardown = first.cleanup();
    const second = createFlowlineRuntime(host);
    await teardown;
    const firstSnapshot = await first.settled;
    const secondSnapshot = await second.settled;

    assert.equal(secondSnapshot.complete, true);
    assert.equal(secondSnapshot.phase, "registered");
    assert.equal(firstSnapshot.complete, false);
    assert.equal(firstSnapshot.phase, "partial");
    assert.deepEqual([...live].sort(), [...secondSnapshot.registered].sort());
    assert.equal(live.size, 8);

    await second.cleanup();
    assert.deepEqual([...live], []);
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, "document", previousDescriptor);
    else delete (globalThis as typeof globalThis & { document?: unknown }).document;
  }
});

test("partial native registration rolls back the successful prefix when the host can unregister", async () => {
  const live = new Set<string>();
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      modelContext: {
        registerTool: async (definition: { name: string }) => {
          if (definition.name === "simulate_disruption") throw new Error("host rejected this tool");
          live.add(definition.name);
        },
        unregisterTool: async (name: string) => { live.delete(name); },
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
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.phase, "partial");
    assert.deepEqual(snapshot.registered, []);
    assert.deepEqual(snapshot.failed, ["simulate_disruption"]);
    assert.match(snapshot.note, /rolled back/i);
    assert.deepEqual([...live], []);
    await runtime.cleanup();
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, "document", previousDescriptor);
    else delete (globalThis as typeof globalThis & { document?: unknown }).document;
  }
});

/**
 * The campaign rail as a tool, and the card as a tool. `list_shifts` is the one call that reads
 * without touching anything — not even the focus — because naming the shifts is not a reason to
 * move the floor. `review_shift` is the opposite kind of boundary: the card exists only after a
 * human closes the shift, so before that the honest answer is a refusal.
 */
test("the campaign reads without touching the board, and the card refuses until a human closes the shift", async () => {
  const shift = shifts.find((entry) => entry.id === "rolling-intake")!;
  let state: GameState = createInitialState(shift);
  const events: ToolEvent[] = [];
  const runtime = createFlowlineRuntime({
    readState: () => state,
    writeState: (nextState) => { state = nextState; },
    emit: (event) => { events.push({ ...event, id: `event-${events.length + 1}`, at: new Date(0).toISOString() }); },
    shifts,
    readEvents: () => events,
  });

  // Before the floor is entered: the campaign answers, the board does not.
  const before = { revision: state.revision, focus: state.focus, agentFocus: state.agentFocus, phase: state.phase };
  const listed = await runtime.invoke("list_shifts");
  assert.equal(listed.ok, true);
  assert.equal(state.revision, before.revision);
  assert.deepEqual(state.focus, before.focus, "naming the shifts must not move the floor");
  assert.equal(state.agentFocus, before.agentFocus);
  assert.equal(state.phase, before.phase);
  if (listed.ok) {
    const rows = listed.data?.shifts as Array<Record<string, unknown>>;
    assert.equal(rows.length, shifts.length);
    assert.deepEqual(rows.map((row) => row.order), [1, 2, 3]);
    assert.equal(rows.filter((row) => row.active).length, 1);
    assert.equal(rows.find((row) => row.active)?.id, shift.id);
    assert.equal(rows.every((row) => row.closed === false), true, "nothing is closed yet");
    assert.equal(rows.find((row) => row.id === "night-handover")?.staggeredIntake, true);
    assert.ok((listed.data?.humanOnly as string[]).includes("close the shift"));
  }
  const listedEvent = events.at(-1)!;
  assert.equal(listedEvent.tool, "list_shifts");
  assert.equal(listedEvent.revisionBefore, listedEvent.revisionAfter, "a read cannot move the revision");

  const earlyCard = await runtime.invoke("review_shift");
  assert.equal(earlyCard.ok, false);
  if (!earlyCard.ok) assert.equal(earlyCard.code, "precondition_failed");

  state = stateOf(enterArena(state));
  const stillNoCard = await runtime.invoke("review_shift");
  assert.equal(stillNoCard.ok, false);
  if (!stillNoCard.ok) assert.equal(stillNoCard.code, "shift_not_closed");

  // Run the shift the way the page does: commit, meet the shock, replan, then close it.
  state = stateOf(stageSchedule(state, shift.defaultSchedule, "Open on the order the floor came with.", state.revision));
  state = stateOf(confirmPending(state));
  state = stateOf(applyDisruption(state));
  state = stateOf(stageSchedule(state, shift.robustSchedule, "One berth is gone, so dispatch Seedbank first.", state.revision));
  state = stateOf(confirmPending(state));
  const closedCount = events.length;
  state = stateOf(closeShift(state, events));

  const reviewed = await runtime.invoke("review_shift");
  assert.equal(reviewed.ok, true);
  if (reviewed.ok) {
    const card = reviewed.data?.card as Record<string, unknown>;
    assert.equal(card.scenarioId, shift.id);
    assert.deepEqual(card.finalSchedule, shift.robustSchedule);
    assert.equal(card.grade, state.resultCard?.grade);
    assert.equal((card.metrics as { tardyJobs: number }).tardyJobs, 0, "the robust order lands every job on this shift");
    assert.equal((card.activity as { humanConfirmations: number }).humanConfirmations, state.receipts.length);
    assert.ok((card.summary as string[]).length >= 5);
  }
  assert.equal(events.length, closedCount + 1, "reviewing the card is one call, and it is traced");
  assert.equal(state.revision, events.at(-1)!.revisionAfter, "reading the card leaves the board where it was");

  const listedAfter = await runtime.invoke("list_shifts");
  assert.equal(listedAfter.ok, true);
  if (listedAfter.ok) {
    const row = (listedAfter.data?.shifts as Array<Record<string, unknown>>).find((entry) => entry.id === shift.id);
    assert.equal(row?.closed, true);
    assert.equal(row?.grade, state.resultCard?.grade);
    assert.equal(row?.objectivesMet, `${state.resultCard?.objectivesMet}/${state.resultCard?.objectivesGraded}`);
  }
});

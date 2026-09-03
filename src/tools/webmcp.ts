import {
  auditSchedule,
  availableActions,
  criticalJob,
  dispatchBerths,
  endSlot,
  evaluateSchedule,
  focusOnQueue,
  formatSchedule,
  getJob,
  intakeAt,
  prepareUndo,
  recordAudit,
  recordComparison,
  setFocus,
  shiftOptions,
  slots,
  stageSchedule,
  startSlot,
  summariseShift,
  validateSchedule,
  type DomainError,
  type FocusTarget,
  type GameState,
  type Scenario,
  type ScheduleAudit,
  type ScheduleEvaluation,
  type Schedule,
  type ToolEvent,
} from "../domain/model.ts";

type NativeToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint: boolean; destructiveHint: boolean };
  execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<ToolResult>;
};

type ModelContext = {
  registerTool: (definition: NativeToolDefinition) => void | Promise<void>;
  unregisterTool?: (name: string) => void | Promise<void>;
  /**
   * Set by this project's own harnesses, and by nothing else. A page cannot tell a browser's
   * registry from a script that defined `document.modelContext` a moment earlier, so a test
   * double is asked to say so and the page reports what it was told. The absence of this flag
   * is not evidence of a native client — see `RegistrationSnapshot["provenance"]`.
   */
  flowlineTestDouble?: boolean;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export type RegistrationSnapshot = {
  available: boolean;
  complete: boolean;
  phase: "unsupported" | "registering" | "registered" | "partial";
  /**
   * Where the registry came from, as far as the page can honestly tell. `unverified` is not a
   * hedged "native": it is the complete claim, because any script can define
   * `document.modelContext`, and nothing a page can read distinguishes a browser
   * implementation from an injected one. No value here ever asserts a native client.
   */
  provenance: "absent" | "unverified" | "test-double";
  registered: string[];
  failed: string[];
  note: string;
};

export type ToolResult =
  | { ok: true; summary: string; data?: Record<string, unknown> }
  | { ok: false; message: string; code?: DomainError["code"] };

export type FlowlineRuntime = {
  snapshot: RegistrationSnapshot;
  settled: Promise<RegistrationSnapshot>;
  /**
   * The tools this runtime actually registered, with the schemas it registered them under.
   * A caller that wants the catalogue reads it from here rather than rebuilding it, because
   * the schedule schema is the loaded shift's job list and a second copy would describe the
   * wrong shift as soon as the campaign moves on.
   */
  catalogue: readonly ToolSpec[];
  invoke: (name: string, input?: Record<string, unknown>) => Promise<ToolResult>;
  cleanup: () => Promise<void>;
};

type RuntimeOptions = {
  /**
   * The board as the host holds it now. It has to answer with the state last handed
   * to `writeState`: every handler reads the board, derives the next one from it and
   * writes it back, so a host that answers with a stale copy would let one tool call
   * silently discard another's change.
   */
  readState: () => GameState;
  /**
   * Applies a new board. May return a promise, and the runtime waits for it before it
   * starts the next call, so a host that applies asynchronously still cannot serve a
   * stale board to the tool behind it.
   */
  writeState: (state: GameState) => void | Promise<void>;
  emit: (event: Omit<ToolEvent, "id" | "at">) => void;
  /**
   * The trace so far. `review_shift` reports how the work was divided, and the tool log is
   * the only honest source for that; a host that does not keep one gets a card that counts
   * no calls rather than a card that invents them.
   */
  readEvents?: () => readonly ToolEvent[];
  /**
   * The campaign, for `list_shifts`. Omitted, the only shift a tool can see is the one on
   * the board — which is the truth for a host that was handed a single scenario.
   */
  shifts?: readonly Scenario[];
};

/**
 * Native tool names belong to the document, not to a component, so only one runtime
 * may own them at a time. React mounts an effect twice in StrictMode on purpose and
 * the first mount's registration can still be in flight when the second begins:
 * without an owner token the two either register the same name twice or the older
 * one's teardown strips the tools the newer one just installed.
 */
let toolOwner: symbol | undefined;

const EMPTY_SCHEMA: Record<string, unknown> = { type: "object", properties: {}, additionalProperties: false };

/**
 * The schedule argument, described for the shift that is actually loaded rather than for the
 * one this file was written against. The enum and the length are the shift's own job list, so
 * a five-job shift advertises five ids, and a client that sends another shift's four is
 * refused by the published contract instead of by the validator behind it.
 */
function scheduleItemsSchema(scenario: Scenario): Record<string, unknown> {
  const ids = scenario.jobs.map((job) => job.id);
  return { type: "array", minItems: ids.length, maxItems: ids.length, items: { type: "string", enum: ids } };
}

function scheduleSchema(scenario: Scenario): Record<string, unknown> {
  return {
    type: "object",
    properties: { schedule: scheduleItemsSchema(scenario) },
    required: ["schedule"],
    additionalProperties: false,
  };
}
/**
 * The tools that need a floor to read. `list_shifts` is deliberately not one of them: the
 * campaign exists before anybody enters a shift, and refusing to name the shifts would hide
 * the one thing an agent can usefully learn from the briefing screen.
 */
const READ_TOOLS = new Set(["inspect_board", "find_bottleneck", "simulate_disruption", "compare_plans", "review_shift"]);
const EVENT_KIND: Record<string, ToolEvent["kind"]> = {
  inspect_board: "read",
  list_shifts: "read",
  find_bottleneck: "read",
  simulate_disruption: "simulation",
  compare_plans: "simulation",
  review_shift: "read",
  stage_schedule: "proposal",
  undo_schedule: "recovery",
};
const KNOWN_KEYS = new Set(["schedule", "reason", "expectedRevision", "receiptId"]);

const INPUT_RULES: Record<string, { required: readonly string[]; allowed: readonly string[] }> = {
  inspect_board: { required: [], allowed: [] },
  list_shifts: { required: [], allowed: [] },
  find_bottleneck: { required: [], allowed: [] },
  simulate_disruption: { required: [], allowed: [] },
  compare_plans: { required: ["schedule"], allowed: ["schedule"] },
  review_shift: { required: [], allowed: [] },
  stage_schedule: { required: ["schedule", "reason", "expectedRevision"], allowed: ["schedule", "reason", "expectedRevision"] },
  undo_schedule: { required: ["receiptId", "expectedRevision"], allowed: ["receiptId", "expectedRevision"] },
};

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function describeScheduleArgument(value: unknown): string {
  if (!Array.isArray(value)) return "?";
  return clip(value.map((entry) => (typeof entry === "string" ? entry : "?")).join("→"), 64);
}

/**
 * A reduced description of the arguments a call arrived with: enough to tell two calls
 * apart in the trace, and never the free text itself — a reason is recorded as its
 * length, because the trace is shown on the page and must not become a second copy of
 * what the planner typed. Keys the contract does not advertise are named rather than
 * dropped, so a client that sends more than the schema allows leaves a mark.
 */
function describeInput(input: unknown): string | undefined {
  const payload = asRecord(input);
  const parts: string[] = [];
  if ("schedule" in payload) parts.push(`schedule ${describeScheduleArgument(payload.schedule)}`);
  if ("receiptId" in payload) parts.push(`receipt ${typeof payload.receiptId === "string" ? clip(payload.receiptId, 24) : "?"}`);
  if ("reason" in payload) parts.push(`reason ${typeof payload.reason === "string" ? `${payload.reason.trim().length} chars` : "?"}`);
  if ("expectedRevision" in payload) parts.push(`rev ${typeof payload.expectedRevision === "number" ? payload.expectedRevision : "?"}`);
  const extra = Object.keys(payload).filter((key) => !KNOWN_KEYS.has(key));
  if (extra.length > 0) parts.push(`off-schema: ${clip(extra.join(", "), 40)}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Whether two focuses say the same thing. The reason and the berth are part of the
 * comparison, not decoration around it: a candidate comparison can land on the same
 * station and the same job as the stress test before it and still be arguing about a
 * different berth over a different route, and a trace that dropped the field there
 * would report a floor that never moved.
 */
function sameFocus(before: FocusTarget, after: FocusTarget): boolean {
  return before.stationId === after.stationId
    && before.jobId === after.jobId
    && before.berthIndex === after.berthIndex
    && before.reason === after.reason
    && before.source === after.source;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function inputFailure(message: string): DomainError {
  return { code: "invalid_input", message };
}

/**
 * JSON Schema is the discovery contract, not a guarantee that a client validated before
 * calling. Keep the same closed-object and scalar rules at the runtime boundary so direct,
 * native, and scripted clients cannot receive different behavior from the advertised tool.
 * Empty-tool calls may arrive as `undefined` from a native client; that is the one non-object
 * value accepted and is treated as an empty object.
 */
function validateToolInput(name: string, input: unknown): DomainError | undefined {
  const rules = INPUT_RULES[name];
  if (!rules) return undefined;
  if (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input))) {
    return inputFailure(`${name} expects a JSON object.`);
  }
  const payload = input === undefined ? {} : asRecord(input);
  const unknown = Object.keys(payload).filter((key) => !rules.allowed.includes(key));
  if (unknown.length > 0) {
    return inputFailure(`${name} received an unsupported field: ${unknown[0]}.`);
  }
  for (const key of rules.required) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return inputFailure(`${name} requires ${key}.`);
  }
  if (name === "stage_schedule") {
    if (typeof payload.reason !== "string") return inputFailure("stage_schedule requires reason to be text.");
    if (payload.reason.length > 280) return inputFailure("stage_schedule reason must be 280 characters or fewer.");
    if (payload.reason.trim().length < 3) return inputFailure("stage_schedule reason must contain at least three non-space characters.");
  }
  if (name === "undo_schedule" && (typeof payload.receiptId !== "string" || payload.receiptId.length < 1)) {
    return inputFailure("undo_schedule requires a non-empty receiptId.");
  }
  if (name === "stage_schedule" || name === "undo_schedule") {
    const revision = payload.expectedRevision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
      return inputFailure(`${name} requires expectedRevision to be a positive integer.`);
    }
  }
  return undefined;
}

/**
 * Reads a schedule argument off a tool payload. The JSON Schema advertised to the
 * agent constrains length and membership, but nothing in WebMCP guarantees a client
 * validates before calling, so the domain's own validator has the last word here —
 * it is the one that also rejects a job listed twice.
 */
function parseSchedule(scenario: GameState["scenario"], value: unknown): Schedule | undefined {
  if (!Array.isArray(value) || value.some((jobId) => typeof jobId !== "string")) return undefined;
  const valid = validateSchedule(scenario, value as Schedule);
  return valid.ok ? valid.state : undefined;
}

/**
 * The refusal a bad schedule earns, named for the shift on the board. A fixed "four known
 * jobs" would be a lie on a five-job shift, and the ids are the part a caller needs.
 */
function scheduleRefusal(scenario: Scenario): string {
  return `Provide each of this shift's ${scenario.jobs.length} jobs exactly once: ${scenario.jobs.map((job) => job.id).join(", ")}.`;
}

type SemanticJob = {
  id: string;
  code: string;
  label: string;
  priority: string;
  queuePosition: number;
  deadline: number;
  prepDuration: number;
  dispatchDuration: number;
  /** The slot intake releases this job. Prep cannot start it earlier, whatever the order says. */
  intakeAt: number;
  /** Slots this job spent released but waiting for the prep crew. */
  intakeWait: number;
  prepWindow: string;
  dispatchWindow: string;
  berth: number;
  waiting: number;
  predictedFinish: number;
  tardiness: number;
  slack: number;
  verdict: string;
};

/**
 * A compact, semantic view of the live board for a tool result. The agent gets names,
 * positions, capacities, deadlines, violations, causes, and lifecycle actions; it never
 * needs to infer those facts from a screenshot, DOM selector, or rendering object.
 */
function semanticState(state: GameState, evaluation: ScheduleEvaluation, audit?: ScheduleAudit): Record<string, unknown> {
  const dispatch = state.scenario.stations.find((station) => station.id === "dispatch");
  const activeDispatch = evaluation.dispatchParallelism;
  const critical = criticalJob(state.scenario);
  const criticalRun = evaluation.jobs.find((run) => run.jobId === critical.id);
  const jobs: SemanticJob[] = evaluation.jobs.map((run, index) => {
    const job = getJob(state.scenario, run.jobId);
    return {
      id: job.id,
      code: job.code,
      label: job.shortLabel,
      priority: job.priority,
      queuePosition: index + 1,
      deadline: job.deadline,
      prepDuration: job.prepDuration,
      dispatchDuration: job.dispatchDuration,
      intakeAt: run.releaseAt,
      intakeWait: run.intakeWait,
      prepWindow: `${startSlot({ dispatchStart: run.prepStart })}–${endSlot({ dispatchEnd: run.prepEnd })}`,
      dispatchWindow: `${startSlot(run)}–${endSlot(run)}`,
      berth: run.dispatchLane + 1,
      waiting: run.waiting,
      predictedFinish: endSlot(run),
      tardiness: run.tardiness,
      slack: job.deadline - endSlot(run),
      verdict: run.verdict,
    };
  });
  const violations = evaluation.jobs.flatMap((run) => {
    const job = getJob(state.scenario, run.jobId);
    const issues: Record<string, unknown>[] = [];
    if (run.tardiness > 0) {
      issues.push({ kind: "deadline", jobId: job.id, message: `${job.shortLabel} finishes ${run.tardiness} slot${run.tardiness === 1 ? "" : "s"} after D${job.deadline}.`, deadline: job.deadline, predictedFinish: endSlot(run) });
    }
    if (run.waiting > 0) {
      issues.push({ kind: "queue", jobId: job.id, stationId: "dispatch", message: `${job.shortLabel} waits ${run.waiting} slot${run.waiting === 1 ? "" : "s"} for dispatch capacity.` });
    }
    // Two different costs with the same shape, kept apart on purpose: this one is the job
    // sitting released while the prep crew finishes something else. The crew standing idle
    // because nothing has arrived is `plan.prepStarved`, and no single job owns it.
    if (run.intakeWait > 0) {
      issues.push({ kind: "intake", jobId: job.id, stationId: "prep", message: `${job.shortLabel} arrives at slot ${run.releaseAt + 1} and then waits ${slots(run.intakeWait)} for the prep crew.` });
    }
    return issues;
  });
  if (dispatch && activeDispatch < dispatch.parallelism) {
    violations.unshift({ kind: "disruption", stationId: "dispatch", message: `${dispatch.shortLabel} is running at ${activeDispatch}/${dispatch.parallelism} berths.` });
  }
  if (evaluation.metrics.prepStarved > 0) {
    violations.unshift({ kind: "starved", stationId: "prep", message: `Prep Bay stands idle for ${slots(evaluation.metrics.prepStarved)} waiting for intake to release work.` });
  }
  const bottleneckLabel = evaluation.bottleneck === "dispatch" ? "dispatch capacity" : "the sequential prep lane";
  const causalPath = [
    `Queue: ${jobs.map((job) => job.label).join(" → ")}`,
    `Constraint: ${bottleneckLabel}${state.shockApplied ? ` once ${state.scenario.disruption.clause}` : ""}`,
    criticalRun && critical
      ? `${critical.shortLabel}: predicted finish ${endSlot(criticalRun)} against deadline D${critical.deadline}`
      : "No critical job configured",
  ];
  const stations = state.scenario.stations.map((station) => {
    const activeCapacity = station.id === "dispatch" ? activeDispatch : station.parallelism;
    const disrupted = activeCapacity < station.parallelism;
    return {
      id: station.id,
      label: station.shortLabel,
      description: station.description,
      capacity: station.parallelism,
      activeCapacity,
      status: disrupted ? "offline" : station.id === evaluation.bottleneck ? "bottleneck" : "online",
      bottleneck: station.id === evaluation.bottleneck,
    };
  });
  return {
    scenario: {
      id: state.scenario.id,
      title: state.scenario.title,
      order: state.scenario.order,
      objective: state.scenario.objective,
      lesson: state.scenario.lesson,
      horizon: state.scenario.horizon,
      jobCount: state.scenario.jobs.length,
      constraints: [...state.scenario.constraints],
    },
    revision: state.revision,
    phase: state.phase,
    focusedStationId: state.focus.stationId,
    selectedJobId: state.focus.jobId,
    focus: state.focus,
    schedule: [...state.schedule],
    queue: jobs,
    jobs,
    stations,
    // What has not arrived yet, at the slot the shift is being read at. An agent that
    // proposes an order without this reads a floor of five jobs and cannot tell why the
    // crew is idle at slot 1.
    intake: {
      pending: intakeAt(state.scenario, state.schedule, 0).map((job) => ({ id: job.id, label: job.shortLabel, arrivesAtSlot: job.releaseAt + 1 })),
      totalIntakeWait: evaluation.metrics.totalIntakeWait,
      prepStarved: evaluation.metrics.prepStarved,
    },
    plan: {
      condition: state.shockApplied ? "disrupted" : "normal",
      dispatchParallelism: activeDispatch,
      metrics: evaluation.metrics,
      bottleneck: evaluation.bottleneck,
    },
    disruption: {
      id: state.scenario.disruption.id,
      label: state.scenario.disruption.shortLabel,
      clause: state.scenario.disruption.clause,
      dispatchParallelism: state.scenario.disruption.dispatchParallelism,
      releaseDelays: state.scenario.disruption.releaseDelays ?? [],
      applied: state.shockApplied,
    },
    violations,
    causalPath,
    availableActions: availableActions(state),
    pendingProposal: state.pendingProposal
      ? {
        id: state.pendingProposal.proposalId,
        kind: state.pendingProposal.kind,
        expectedRevision: state.pendingProposal.expectedRevision,
        schedule: [...state.pendingProposal.schedule],
        baseSchedule: [...state.pendingProposal.baseSchedule],
        reasonLength: state.pendingProposal.reason.trim().length,
        targetReceiptId: state.pendingProposal.targetReceiptId,
      }
      : undefined,
    activeReceipt: state.activeReceipt
      ? {
        id: state.activeReceipt.id,
        action: state.activeReceipt.action,
        revision: state.activeReceipt.revision,
        schedule: [...state.activeReceipt.schedule],
        previousSchedule: [...state.activeReceipt.previousSchedule],
        shockApplied: state.activeReceipt.shockApplied,
      }
      : undefined,
    audit: audit
      ? { finding: audit.finding, severity: audit.severity, baseline: audit.baseline.metrics, stress: audit.stress.metrics }
      : undefined,
    // Present only once the human has closed the shift. `review_shift` returns the whole
    // card; this is the pointer that tells an agent there is one to read.
    resultCard: state.resultCard
      ? { grade: state.resultCard.grade, objectivesMet: state.resultCard.objectivesMet, objectivesGraded: state.resultCard.objectivesGraded, scenarioId: state.resultCard.scenarioId }
      : undefined,
    shiftsClosed: state.results.length,
  };
}

function failure(error: DomainError): ToolResult {
  return { ok: false, code: error.code, message: error.message };
}

function aborted(context?: { signal?: AbortSignal }): ToolResult | undefined {
  return context?.signal?.aborted ? { ok: false, code: "precondition_failed", message: "The audit was cancelled before it changed the board." } : undefined;
}

/**
 * The eight tools as a WebMCP client is offered them: a name, a sentence, a schema, and
 * whether calling it can change the board. This is the whole surface an agent has to
 * work from, so it is stated once, without a runtime attached, and the registration
 * below and the local eval harness both read this same list. A catalogue that had to be
 * restated somewhere else would eventually describe tools that no longer behave that way.
 */
export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Read-only with respect to the board of record — the schedule and the revision — and
   * nothing wider. Every tool here writes something the player can see: focus on the four
   * audits, `lastAudit` on two of them, `lastComparison` on the comparison, a pending
   * proposal on the two writes. So this flag is not `readOnlyHint`: it is the narrower
   * claim, and the annotation the host receives says `readOnlyHint: false` for all eight.
   */
  boardReadOnly: boolean;
};

/**
 * Built per shift, because two of these schemas are the shift's own job list. Everything
 * else is fixed text, and the two write tools are the only ones that are not board-read-only
 * however many shifts the campaign grows to.
 */
export function toolSpecs(scenario: Scenario): readonly ToolSpec[] {
  const itemsSchema = scheduleItemsSchema(scenario);
  return [
    {
      name: "inspect_board",
      description: "Read the active Flowline schedule, jobs, intake times, station capacity, deadlines, phase, revision, and the receipt of the last confirmed plan. Do not change the schedule.",
      inputSchema: EMPTY_SCHEMA,
      boardReadOnly: true,
    },
    {
      name: "list_shifts",
      description: "List the shifts in this campaign with each one's objective, disruption, job count, and the grade already earned on it. Do not change the schedule.",
      inputSchema: EMPTY_SCHEMA,
      boardReadOnly: true,
    },
    {
      name: "find_bottleneck",
      description: "Audit the current schedule and identify the station, intake wait, or deadline that constrains the active plan. Do not change the schedule.",
      inputSchema: EMPTY_SCHEMA,
      boardReadOnly: true,
    },
    {
      name: "simulate_disruption",
      description: "Run this shift's deterministic shock test against the current schedule — lost dispatch capacity, a late arrival, or both — without committing a new plan.",
      inputSchema: EMPTY_SCHEMA,
      boardReadOnly: true,
    },
    {
      name: "compare_plans",
      description: "Compare a complete job order against the active schedule under normal and disrupted conditions. Do not commit it.",
      inputSchema: scheduleSchema(scenario),
      boardReadOnly: true,
    },
    {
      name: "review_shift",
      description: "Read the result card for a closed shift: the grade, each objective and whether it was met, the closing order, and how the work was divided between tool calls and human confirmations.",
      inputSchema: EMPTY_SCHEMA,
      boardReadOnly: true,
    },
    {
      name: "stage_schedule",
      description: "Stage a complete schedule proposal for the human planner to review. This never confirms or commits a plan.",
      inputSchema: {
        type: "object",
        properties: {
          schedule: itemsSchema,
          reason: { type: "string", minLength: 3, maxLength: 280 },
          expectedRevision: { type: "integer", minimum: 1 },
        },
        required: ["schedule", "reason", "expectedRevision"],
        additionalProperties: false,
      },
      boardReadOnly: false,
    },
    {
      name: "undo_schedule",
      description: "Prepare an exact rollback of a confirmed schedule for human review, using the receipt id that inspect_board reports. This never confirms the rollback.",
      inputSchema: {
        type: "object",
        properties: {
          receiptId: { type: "string", minLength: 1 },
          expectedRevision: { type: "integer", minimum: 1 },
        },
        required: ["receiptId", "expectedRevision"],
        additionalProperties: false,
      },
      boardReadOnly: false,
    },
  ];
}

function toolDefinitions(
  specs: readonly ToolSpec[],
  dispatch: (name: string, input: unknown, context?: { signal?: AbortSignal }) => Promise<ToolResult>,
): NativeToolDefinition[] {
  return specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    // No tool advertises itself as read-only, because none of them is: the audits write
    // focus and their own finding, and the two writes file a pending proposal. What every one
    // of them can promise is that nothing it writes is destructive and nothing it writes can
    // move the revision — a host that decides whether to prompt should see that, not a
    // `readOnlyHint: true` that would earn a silent call.
    annotations: { readOnlyHint: false, destructiveHint: false },
    execute: (input: unknown, context?: { signal?: AbortSignal }) => dispatch(spec.name, input, context),
  }));
}


export function createFlowlineRuntime(options: RuntimeOptions): FlowlineRuntime {
  const native = typeof document !== "undefined" ? document.modelContext : undefined;
  // The catalogue is bound to the shift the runtime was created on, because two of the
  // schemas are that shift's job list. Changing shift therefore means a new runtime — the
  // alternative is a registry advertising an enum the board no longer accepts.
  const catalogue = toolSpecs(options.readState().scenario);
  const definitions = toolDefinitions(catalogue, dispatch);
  const count = definitions.length;
  const token = Symbol("flowline-runtime");
  let disposed = false;
  if (native) toolOwner = token;
  const snapshot: RegistrationSnapshot = {
    available: Boolean(native),
    complete: false,
    phase: native ? "registering" : "unsupported",
    provenance: !native ? "absent" : native.flowlineTestDouble ? "test-double" : "unverified",
    registered: [],
    failed: [],
    note: native ? "Registering operations tools…" : "No WebMCP registry on this document; the local guide is active.",
  };

  /**
   * One tool call at a time. Every handler reads the board and writes a changed board
   * back, and a WebMCP client is free to fire tools in parallel, so the runtime holds
   * the line rather than trusting the caller to wait: the next turn starts only once
   * the previous one's write has been applied by the host.
   */
  let turn: Promise<unknown> = Promise.resolve();

  function dispatch(name: string, input: unknown, context?: { signal?: AbortSignal }): Promise<ToolResult> {
    const queued = turn.then(() => handle(name, input, context));
    turn = queued.catch(() => undefined);
    return queued;
  }

  async function apply(next: GameState): Promise<void> {
    await options.writeState(next);
  }

  /**
   * Every call leaves exactly one line in the trace, written here rather than at the
   * end of each handler: the refusals are the paths that used to return early and log
   * nothing, which left the log describing a clean run of tools that never landed.
   */
  async function handle(name: string, input: unknown, context?: { signal?: AbortSignal }): Promise<ToolResult> {
    const before = options.readState();
    const result = await execute(name, input, before, context);
    const after = options.readState();
    const payload = asRecord(input);
    options.emit({
      tool: name,
      kind: EVENT_KIND[name] ?? "system",
      ok: result.ok,
      summary: result.ok ? result.summary : result.message,
      code: result.ok ? undefined : result.code,
      phase: after.phase,
      // Both sides of the call, so a reader can see that no tool moves the committed
      // revision on its own: only a human confirmation does.
      revisionBefore: before.revision,
      revisionAfter: after.revision,
      // Only the focus this call actually moved. An unchanged focus says nothing about
      // the call, and this field is where the link from a tool to the view is read.
      focus: sameFocus(before.focus, after.focus) ? undefined : after.focus,
      // The proposal this call staged — never one that was already waiting for review.
      proposalId: after.pendingProposal && after.pendingProposal.proposalId !== before.pendingProposal?.proposalId
        ? after.pendingProposal.proposalId
        : undefined,
      receiptId: typeof payload.receiptId === "string" ? payload.receiptId : undefined,
      input: describeInput(input),
    });
    return result;
  }

  async function execute(name: string, input: unknown, state: GameState, context?: { signal?: AbortSignal }): Promise<ToolResult> {
    const cancelled = aborted(context);
    if (cancelled) return cancelled;
    const inputError = validateToolInput(name, input);
    if (inputError) return failure(inputError);
    if (state.phase === "setup" && READ_TOOLS.has(name)) {
      return { ok: false, code: "precondition_failed", message: "Enter the operations floor before asking the auditor to inspect the board." };
    }
    let result: ToolResult;

    if (name === "inspect_board") {
      const nextState = setFocus({ ...state, agentFocus: "inspected" }, focusOnQueue(state.scenario, state.schedule));
      await apply(nextState);
      // The active receipt travels with the read because `undo_schedule` needs its id and
      // no other tool reports one: an agent asked to roll a plan back could otherwise only
      // guess, and a rollback tool whose argument cannot be discovered is not callable.
      result = {
        ok: true,
        summary: `Read revision ${state.revision}: ${formatSchedule(state.schedule, state.scenario)}.`,
        data: semanticState(nextState, evaluateSchedule(nextState.scenario, nextState.schedule, shiftOptions(nextState.scenario, nextState.shockApplied))),
      };
    } else if (name === "find_bottleneck") {
      const audit = auditSchedule(state.scenario, state.schedule);
      const nextState = recordAudit(state, audit, "bottleneck");
      await apply(nextState);
      const activeEvaluation = state.shockApplied ? audit.stress : audit.baseline;
      result = {
        ok: true,
        summary: `${audit.finding} ${activeEvaluation.bottleneck === "dispatch" ? "Dispatch Bay" : "Prep Bay"} is the current bottleneck.`,
        data: { ...semanticState(nextState, activeEvaluation, audit), audit },
      };
    } else if (name === "simulate_disruption") {
      const audit = auditSchedule(state.scenario, state.schedule);
      const nextState = recordAudit(state, audit, "simulation");
      await apply(nextState);
      result = {
        ok: true,
        summary: audit.finding,
        data: {
          ...semanticState(nextState, state.shockApplied ? audit.stress : audit.baseline, audit),
          baseline: audit.baseline.metrics,
          stress: audit.stress.metrics,
        },
      };
    } else if (name === "list_shifts") {
      // No board write at all, not even focus: this is the campaign rail, and moving the
      // floor because someone asked which shifts exist would be a side effect nobody asked
      // for. It is the one tool that answers without touching the state.
      const campaign = options.shifts ?? [state.scenario];
      const best = new Map<string, GameState["results"][number]>();
      for (const card of state.results) {
        const held = best.get(card.scenarioId);
        if (!held || card.score >= held.score) best.set(card.scenarioId, card);
      }
      result = {
        ok: true,
        summary: `${campaign.length} shift${campaign.length === 1 ? "" : "s"} in this campaign; ${best.size} closed. Active: ${state.scenario.title}.`,
        data: {
          activeShiftId: state.scenario.id,
          shifts: campaign.map((shift) => {
            const card = best.get(shift.id);
            return {
              id: shift.id,
              order: shift.order,
              title: shift.title,
              objective: shift.objective,
              lesson: shift.lesson,
              horizon: shift.horizon,
              jobCount: shift.jobs.length,
              staggeredIntake: shift.jobs.some((job) => job.releaseAt > 0),
              disruption: { label: shift.disruption.shortLabel, clause: shift.disruption.clause, berthsLost: dispatchBerths(shift) - shift.disruption.dispatchParallelism, lateArrivals: (shift.disruption.releaseDelays ?? []).length },
              active: shift.id === state.scenario.id,
              closed: Boolean(card),
              grade: card?.grade,
              objectivesMet: card ? `${card.objectivesMet}/${card.objectivesGraded}` : undefined,
            };
          }),
          // Choosing the shift is a human action, like confirming a plan. Said here so an
          // agent reads the boundary off the tool rather than discovering it as a refusal.
          humanOnly: ["start a shift", "close the shift", "confirm a plan"],
        },
      };
    } else if (name === "review_shift") {
      const card = state.resultCard ?? (state.phase === "closed" ? summariseShift(state, [...(options.readEvents?.() ?? [])]) : undefined);
      if (!card) {
        return {
          ok: false,
          code: "shift_not_closed",
          message: "No result card yet: the shift is closed by the human planner once a plan has been confirmed under the disruption.",
        };
      }
      result = {
        ok: true,
        summary: `${card.scenarioTitle}: grade ${card.grade}, ${card.objectivesMet} of ${card.objectivesGraded} objectives met.`,
        data: {
          card: {
            scenarioId: card.scenarioId,
            scenarioTitle: card.scenarioTitle,
            shiftOrder: card.shiftOrder,
            grade: card.grade,
            score: card.score,
            objectivesMet: card.objectivesMet,
            objectivesGraded: card.objectivesGraded,
            finalSchedule: [...card.finalSchedule],
            objectives: card.objectives,
            metrics: card.evaluation.metrics,
            activity: card.activity,
            lesson: card.lesson,
            summary: card.summary,
          },
          earlierShifts: state.results.map((earlier) => ({ scenarioId: earlier.scenarioId, grade: earlier.grade, score: earlier.score })),
        },
      };
    } else if (name === "compare_plans") {
      const payload = asRecord(input);
      const schedule = parseSchedule(state.scenario, payload.schedule);
      if (!schedule) return { ok: false, code: "invalid_schedule", message: scheduleRefusal(state.scenario) };
      const audit = auditSchedule(state.scenario, schedule);
      // Filed as a comparison rather than as the board's audit: the timeline still
      // shows the active order, so this candidate may not become the explanation
      // the focus rail reads out.
      const nextState = recordComparison(state, schedule, audit);
      await apply(nextState);
      const criticalLabel = criticalJob(state.scenario).shortLabel;
      const activeAudit = state.lastAudit;
      const activeEvaluation = evaluateSchedule(state.scenario, state.schedule, shiftOptions(state.scenario, state.shockApplied));
      result = {
        ok: true,
        summary: `${criticalLabel} is ${audit.stress.metrics.criticalOnTime ? "on time" : `late by ${audit.stress.metrics.criticalTardiness} slot${audit.stress.metrics.criticalTardiness === 1 ? "" : "s"}`} after the berth disruption.`,
        data: {
          ...semanticState(nextState, activeEvaluation, activeAudit),
          candidate: schedule,
          activeSchedule: state.schedule,
          baseline: audit.baseline,
          stress: audit.stress,
          finding: audit.finding,
          revision: state.revision,
          focus: options.readState().focus,
        },
      };
    } else if (name === "stage_schedule") {
      const payload = asRecord(input);
      const schedule = parseSchedule(state.scenario, payload.schedule);
      const reason = typeof payload.reason === "string" ? payload.reason : "";
      const expectedRevision = typeof payload.expectedRevision === "number" ? payload.expectedRevision : NaN;
      if (!schedule) return { ok: false, code: "invalid_schedule", message: scheduleRefusal(state.scenario) };
      const transition = stageSchedule(state, schedule, reason, expectedRevision, { requireCurrentComparison: true });
      if (!transition.ok) return failure(transition.error);
      await apply(transition.state);
      result = {
        ok: true,
        summary: "Plan staged. The human planner must review and confirm it.",
        data: {
          ...semanticState(transition.state, evaluateSchedule(transition.state.scenario, transition.state.schedule, shiftOptions(transition.state.scenario, transition.state.shockApplied)), transition.state.lastAudit),
          proposal: {
            id: transition.state.pendingProposal!.proposalId,
            schedule: [...transition.state.pendingProposal!.schedule],
            expectedRevision,
            reasonLength: transition.state.pendingProposal!.reason.length,
          },
        },
      };
    } else if (name === "undo_schedule") {
      const payload = asRecord(input);
      const receiptId = typeof payload.receiptId === "string" ? payload.receiptId : "";
      const expectedRevision = typeof payload.expectedRevision === "number" ? payload.expectedRevision : NaN;
      const transition = prepareUndo(state, receiptId, expectedRevision);
      if (!transition.ok) return failure(transition.error);
      await apply(transition.state);
      result = {
        ok: true,
        summary: "Exact rollback staged. The human planner must confirm it.",
        data: {
          ...semanticState(transition.state, evaluateSchedule(transition.state.scenario, transition.state.schedule, shiftOptions(transition.state.scenario, transition.state.shockApplied)), transition.state.lastAudit),
          proposal: {
            id: transition.state.pendingProposal!.proposalId,
            kind: "undo",
            schedule: [...transition.state.pendingProposal!.schedule],
            expectedRevision,
            targetReceiptId: transition.state.pendingProposal!.targetReceiptId,
          },
        },
      };
    } else {
      return { ok: false, code: "invalid_input", message: `Unknown operations tool: ${name}.` };
    }

    return result;
  }

  async function registerNative(): Promise<RegistrationSnapshot> {
    if (!native) return snapshot;
    let superseded = false;
    let rolledBack = false;
    for (const definition of definitions) {
      // Checked between every await: a newer runtime may have claimed these names
      // while this loop was suspended, and re-adding one behind it would leave two
      // registrations for the same tool.
      if (disposed || toolOwner !== token) {
        superseded = true;
        break;
      }
      try {
        await native.registerTool(definition);
        snapshot.registered.push(definition.name);
      } catch {
        snapshot.failed.push(definition.name);
      }
    }
    // A half-registered surface is worse than an unavailable one: a model can discover
    // some capabilities and then fail in the middle of a journey. When the host exposes
    // unregisterTool, remove the successful prefix before reporting the partial result.
    // Hosts without an unregister primitive remain explicitly partial and are never called
    // complete.
    if (!superseded && snapshot.failed.length > 0 && native.unregisterTool && snapshot.registered.length > 0) {
      const registered = [...snapshot.registered];
      const rollback = await Promise.allSettled(registered.map((name) => native.unregisterTool!(name)));
      rolledBack = rollback.every((result) => result.status === "fulfilled");
      if (rolledBack) snapshot.registered = [];
    }
    snapshot.complete = !superseded && snapshot.failed.length === 0 && snapshot.registered.length === definitions.length;
    snapshot.phase = snapshot.complete ? "registered" : "partial";
    // The wording stops at what registering proves: these tools are on this document's
    // registry. It used to read "Six native operations tools ready", which claimed a browser
    // implementation that no run of this project has ever had.
    snapshot.note = snapshot.complete
      ? snapshot.provenance === "test-double"
        ? `${count} operations tools registered on a scripted test double.`
        : `${count} operations tools registered on document.modelContext.`
      : superseded
        ? "A newer runtime took over the registered tools."
        : rolledBack
          ? "Registration was partial; the successful tools were rolled back."
        : `${snapshot.registered.length} tools ready; ${snapshot.failed.length} failed to register.`;
    return { ...snapshot, registered: [...snapshot.registered], failed: [...snapshot.failed] };
  }

  const settled = registerNative();

  return {
    snapshot,
    settled,
    catalogue,
    invoke: (name, input = {}) => dispatch(name, input),
    cleanup: async () => {
      disposed = true;
      // A registration still in flight has to finish first, or teardown would read an
      // empty list and leave live tools behind it.
      await settled.catch(() => undefined);
      // If a newer runtime owns these names its registration has already replaced
      // ours, and unregistering here would strip the tools that are actually live.
      if (toolOwner !== token) return;
      toolOwner = undefined;
      const names = snapshot.registered;
      snapshot.registered = [];
      snapshot.complete = false;
      if (!native?.unregisterTool) return;
      await Promise.all(names.map((name) => native.unregisterTool!(name)));
    },
  };
}

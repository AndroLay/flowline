import {
  auditSchedule,
  focusOnQueue,
  formatSchedule,
  prepareUndo,
  recordAudit,
  recordComparison,
  setFocus,
  stageSchedule,
  validateSchedule,
  type DomainError,
  type FocusTarget,
  type GameState,
  type Schedule,
  type ToolEvent,
} from "../domain/model.ts";

type NativeToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<ToolResult>;
};

type ModelContext = {
  registerTool: (definition: NativeToolDefinition) => void | Promise<void>;
  unregisterTool?: (name: string) => void | Promise<void>;
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
};

/**
 * Native tool names belong to the document, not to a component, so only one runtime
 * may own them at a time. React mounts an effect twice in StrictMode on purpose and
 * the first mount's registration can still be in flight when the second begins:
 * without an owner token the two either register the same name twice or the older
 * one's teardown strips the tools the newer one just installed.
 */
let toolOwner: symbol | undefined;

const JOB_IDS: Schedule[number][] = ["pantry", "archive", "beacon", "relay"];
const EMPTY_SCHEMA: Record<string, unknown> = { type: "object", properties: {}, additionalProperties: false };
const SCHEDULE_ITEMS_SCHEMA: Record<string, unknown> = {
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: { type: "string", enum: JOB_IDS },
};
const SCHEDULE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    schedule: SCHEDULE_ITEMS_SCHEMA,
  },
  required: ["schedule"],
  additionalProperties: false,
};
const READ_TOOLS = new Set(["inspect_board", "find_bottleneck", "simulate_disruption", "compare_plans"]);
const EVENT_KIND: Record<string, ToolEvent["kind"]> = {
  inspect_board: "read",
  find_bottleneck: "read",
  simulate_disruption: "simulation",
  compare_plans: "simulation",
  stage_schedule: "proposal",
  undo_schedule: "recovery",
};
const KNOWN_KEYS = new Set(["schedule", "reason", "expectedRevision", "receiptId"]);

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

function failure(error: DomainError): ToolResult {
  return { ok: false, code: error.code, message: error.message };
}

function aborted(context?: { signal?: AbortSignal }): ToolResult | undefined {
  return context?.signal?.aborted ? { ok: false, code: "precondition_failed", message: "The audit was cancelled before it changed the board." } : undefined;
}

/**
 * The six tools as a WebMCP client is offered them: a name, a sentence, a schema, and
 * whether calling it can change the board. This is the whole surface an agent has to
 * work from, so it is stated once, without a runtime attached, and the registration
 * below and the local eval harness both read this same list. A catalogue that had to be
 * restated somewhere else would eventually describe tools that no longer behave that way.
 */
export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
};

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "inspect_board",
    description: "Read the active Flowline schedule, jobs, station capacity, deadlines, phase, revision, and the receipt of the last confirmed plan. Do not change the schedule.",
    inputSchema: EMPTY_SCHEMA,
    readOnly: true,
  },
  {
    name: "find_bottleneck",
    description: "Audit the current schedule and identify the station or deadline that constrains the active plan. Do not change the schedule.",
    inputSchema: EMPTY_SCHEMA,
    readOnly: true,
  },
  {
    name: "simulate_disruption",
    description: "Run the deterministic one-berth-offline shock test against the current schedule without committing a new plan.",
    inputSchema: EMPTY_SCHEMA,
    readOnly: true,
  },
  {
    name: "compare_plans",
    description: "Compare a complete job order against the active schedule under normal and disrupted dispatch capacity. Do not commit it.",
    inputSchema: SCHEDULE_SCHEMA,
    readOnly: true,
  },
  {
    name: "stage_schedule",
    description: "Stage a complete schedule proposal for the human planner to review. This never confirms or commits a plan.",
    inputSchema: {
      type: "object",
      properties: {
        schedule: SCHEDULE_ITEMS_SCHEMA,
        reason: { type: "string", minLength: 3, maxLength: 280 },
        expectedRevision: { type: "integer", minimum: 1 },
      },
      required: ["schedule", "reason", "expectedRevision"],
      additionalProperties: false,
    },
    readOnly: false,
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
    readOnly: false,
  },
];

function toolDefinitions(dispatch: (name: string, input: unknown, context?: { signal?: AbortSignal }) => Promise<ToolResult>): NativeToolDefinition[] {
  return TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: spec.readOnly ? { readOnlyHint: true } : undefined,
    execute: (input: unknown, context?: { signal?: AbortSignal }) => dispatch(spec.name, input, context),
  }));
}


export function createFlowlineRuntime(options: RuntimeOptions): FlowlineRuntime {
  const native = typeof document !== "undefined" ? document.modelContext : undefined;
  const definitions = toolDefinitions(dispatch);
  const token = Symbol("flowline-runtime");
  let disposed = false;
  if (native) toolOwner = token;
  const snapshot: RegistrationSnapshot = {
    available: Boolean(native),
    complete: false,
    phase: native ? "registering" : "unsupported",
    registered: [],
    failed: [],
    note: native ? "Registering operations tools…" : "Native WebMCP unavailable; local guide is active.",
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
      const receipt = state.activeReceipt;
      result = {
        ok: true,
        summary: `Read revision ${state.revision}: ${formatSchedule(state.schedule, state.scenario)}.`,
        data: {
          phase: state.phase,
          revision: state.revision,
          schedule: state.schedule,
          horizon: state.scenario.horizon,
          focus: nextState.focus,
          activeReceipt: receipt
            ? { id: receipt.id, action: receipt.action, revision: receipt.revision, schedule: receipt.schedule, previousSchedule: receipt.previousSchedule }
            : undefined,
        },
      };
    } else if (name === "find_bottleneck") {
      const audit = auditSchedule(state.scenario, state.schedule);
      await apply(recordAudit(state, audit, "bottleneck"));
      const activeEvaluation = state.shockApplied ? audit.stress : audit.baseline;
      result = {
        ok: true,
        summary: `${audit.finding} ${activeEvaluation.bottleneck === "dispatch" ? "Dispatch Bay" : "Prep Bay"} is the current bottleneck.`,
        data: { audit, revision: state.revision, focus: options.readState().focus },
      };
    } else if (name === "simulate_disruption") {
      const audit = auditSchedule(state.scenario, state.schedule);
      await apply(recordAudit(state, audit, "simulation"));
      result = {
        ok: true,
        summary: audit.finding,
        data: { baseline: audit.baseline.metrics, stress: audit.stress.metrics, revision: state.revision, focus: options.readState().focus },
      };
    } else if (name === "compare_plans") {
      const payload = asRecord(input);
      const schedule = parseSchedule(state.scenario, payload.schedule);
      if (!schedule) return { ok: false, code: "invalid_schedule", message: "Provide each of the four known jobs exactly once." };
      const audit = auditSchedule(state.scenario, schedule);
      // Filed as a comparison rather than as the board's audit: the timeline still
      // shows the active order, so this candidate may not become the explanation
      // the focus rail reads out.
      await apply(recordComparison(state, schedule, audit));
      const criticalLabel = state.scenario.jobs.find((job) => job.priority === "critical")!.shortLabel;
      result = {
        ok: true,
        summary: `${criticalLabel} is ${audit.stress.metrics.criticalOnTime ? "on time" : `late by ${audit.stress.metrics.criticalTardiness} slot${audit.stress.metrics.criticalTardiness === 1 ? "" : "s"}`} after the berth disruption.`,
        data: {
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
      if (!schedule) return { ok: false, code: "invalid_schedule", message: "Provide each of the four known jobs exactly once." };
      const transition = stageSchedule(state, schedule, reason, expectedRevision);
      if (!transition.ok) return failure(transition.error);
      await apply(transition.state);
      result = { ok: true, summary: "Plan staged. The human planner must review and confirm it.", data: { proposalId: transition.state.pendingProposal!.proposalId, expectedRevision, focus: transition.state.focus } };
    } else if (name === "undo_schedule") {
      const payload = asRecord(input);
      const receiptId = typeof payload.receiptId === "string" ? payload.receiptId : "";
      const expectedRevision = typeof payload.expectedRevision === "number" ? payload.expectedRevision : NaN;
      const transition = prepareUndo(state, receiptId, expectedRevision);
      if (!transition.ok) return failure(transition.error);
      await apply(transition.state);
      result = { ok: true, summary: "Exact rollback staged. The human planner must confirm it.", data: { proposalId: transition.state.pendingProposal!.proposalId, expectedRevision, focus: transition.state.focus } };
    } else {
      return { ok: false, code: "invalid_input", message: `Unknown operations tool: ${name}.` };
    }

    return result;
  }

  async function registerNative(): Promise<RegistrationSnapshot> {
    if (!native) return snapshot;
    let superseded = false;
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
    snapshot.complete = !superseded && snapshot.failed.length === 0 && snapshot.registered.length === definitions.length;
    snapshot.phase = snapshot.complete ? "registered" : "partial";
    snapshot.note = snapshot.complete
      ? "Six native operations tools ready."
      : superseded
        ? "A newer runtime took over the native tools."
        : `${snapshot.registered.length} tools ready; ${snapshot.failed.length} failed to register.`;
    return { ...snapshot, registered: [...snapshot.registered], failed: [...snapshot.failed] };
  }

  const settled = registerNative();

  return {
    snapshot,
    settled,
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

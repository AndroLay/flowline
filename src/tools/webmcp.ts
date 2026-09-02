import {
  auditSchedule,
  formatSchedule,
  prepareUndo,
  recordAudit,
  setFocus,
  stageSchedule,
  type DomainError,
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
  readState: () => GameState;
  writeState: (state: GameState) => void;
  emit: (event: Omit<ToolEvent, "id" | "at">) => void;
};

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseSchedule(value: unknown): Schedule | undefined {
  if (!Array.isArray(value) || value.length !== JOB_IDS.length || value.some((jobId) => typeof jobId !== "string" || !JOB_IDS.includes(jobId as Schedule[number]))) return undefined;
  return value as Schedule;
}

function failure(error: DomainError): ToolResult {
  return { ok: false, code: error.code, message: error.message };
}

function aborted(context?: { signal?: AbortSignal }): ToolResult | undefined {
  return context?.signal?.aborted ? { ok: false, code: "precondition_failed", message: "The audit was cancelled before it changed the board." } : undefined;
}

function toolDefinitions(dispatch: (name: string, input: unknown, context?: { signal?: AbortSignal }) => Promise<ToolResult>): NativeToolDefinition[] {
  return [
    {
      name: "inspect_board",
      description: "Read the active Flowline schedule, jobs, station capacity, deadlines, phase, and revision. Do not change the schedule.",
      inputSchema: EMPTY_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: (input, context) => dispatch("inspect_board", input, context),
    },
    {
      name: "find_bottleneck",
      description: "Audit the current schedule and identify the station or deadline that constrains the active plan. Do not change the schedule.",
      inputSchema: EMPTY_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: (input, context) => dispatch("find_bottleneck", input, context),
    },
    {
      name: "simulate_disruption",
      description: "Run the deterministic one-berth-offline shock test against the current schedule without committing a new plan.",
      inputSchema: EMPTY_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: (input, context) => dispatch("simulate_disruption", input, context),
    },
    {
      name: "compare_plans",
      description: "Compare a complete job order against the active schedule under normal and disrupted dispatch capacity. Do not commit it.",
      inputSchema: SCHEDULE_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: (input, context) => dispatch("compare_plans", input, context),
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
      execute: (input, context) => dispatch("stage_schedule", input, context),
    },
    {
      name: "undo_schedule",
      description: "Prepare an exact rollback of the active confirmed schedule for human review. This never confirms the rollback.",
      inputSchema: {
        type: "object",
        properties: {
          receiptId: { type: "string", minLength: 1 },
          expectedRevision: { type: "integer", minimum: 1 },
        },
        required: ["receiptId", "expectedRevision"],
        additionalProperties: false,
      },
      execute: (input, context) => dispatch("undo_schedule", input, context),
    },
  ];
}

export function createFlowlineRuntime(options: RuntimeOptions): FlowlineRuntime {
  const native = typeof document !== "undefined" ? document.modelContext : undefined;
  const definitions = toolDefinitions(dispatch);
  const snapshot: RegistrationSnapshot = {
    available: Boolean(native),
    complete: false,
    phase: native ? "registering" : "unsupported",
    registered: [],
    failed: [],
    note: native ? "Registering operations tools…" : "Native WebMCP unavailable; local guide is active.",
  };

  async function dispatch(name: string, input: unknown, context?: { signal?: AbortSignal }): Promise<ToolResult> {
    const cancelled = aborted(context);
    if (cancelled) return cancelled;
    const state = options.readState();
    if (state.phase === "setup" && READ_TOOLS.has(name)) {
      return { ok: false, code: "precondition_failed", message: "Enter the operations floor before asking the auditor to inspect the board." };
    }
    let result: ToolResult;

    if (name === "inspect_board") {
      const nextState = setFocus({ ...state, agentFocus: "inspected" }, { stationId: "prep", jobId: state.schedule[0], source: "agent" });
      options.writeState(nextState);
      result = {
        ok: true,
        summary: `Read revision ${state.revision}: ${formatSchedule(state.schedule, state.scenario)}.`,
        data: { phase: state.phase, revision: state.revision, schedule: state.schedule, horizon: state.scenario.horizon, focus: nextState.focus },
      };
    } else if (name === "find_bottleneck") {
      const audit = auditSchedule(state.scenario, state.schedule);
      options.writeState(recordAudit(state, audit, "bottleneck"));
      const activeEvaluation = state.shockApplied ? audit.stress : audit.baseline;
      result = {
        ok: true,
        summary: `${audit.finding} ${activeEvaluation.bottleneck === "dispatch" ? "Dispatch Bay" : "Prep Bay"} is the current bottleneck.`,
        data: { audit, revision: state.revision, focus: options.readState().focus },
      };
    } else if (name === "simulate_disruption") {
      const audit = auditSchedule(state.scenario, state.schedule);
      options.writeState(recordAudit(state, audit, "simulation"));
      result = {
        ok: true,
        summary: audit.finding,
        data: { baseline: audit.baseline.metrics, stress: audit.stress.metrics, revision: state.revision, focus: options.readState().focus },
      };
    } else if (name === "compare_plans") {
      const payload = asRecord(input);
      const schedule = parseSchedule(payload.schedule);
      if (!schedule) return { ok: false, code: "invalid_schedule", message: "Provide each of the four known jobs exactly once." };
      const audit = auditSchedule(state.scenario, schedule);
      options.writeState(recordAudit(state, audit, "simulation"));
      const criticalLabel = state.scenario.jobs.find((job) => job.priority === "critical")!.shortLabel;
      result = {
        ok: true,
        summary: `${criticalLabel} is ${audit.stress.metrics.criticalOnTime ? "on time" : `late by ${audit.stress.metrics.criticalTardiness} slot${audit.stress.metrics.criticalTardiness === 1 ? "" : "s"}`} after the berth disruption.`,
        data: { schedule, baseline: audit.baseline, stress: audit.stress, revision: state.revision, focus: options.readState().focus },
      };
    } else if (name === "stage_schedule") {
      const payload = asRecord(input);
      const schedule = parseSchedule(payload.schedule);
      const reason = typeof payload.reason === "string" ? payload.reason : "";
      const expectedRevision = typeof payload.expectedRevision === "number" ? payload.expectedRevision : NaN;
      if (!schedule) return { ok: false, code: "invalid_schedule", message: "Provide each of the four known jobs exactly once." };
      const transition = stageSchedule(state, schedule, reason, expectedRevision);
      if (!transition.ok) return failure(transition.error);
      options.writeState(transition.state);
      result = { ok: true, summary: "Plan staged. The human planner must review and confirm it.", data: { proposalId: transition.state.pendingProposal!.proposalId, expectedRevision, focus: transition.state.focus } };
    } else if (name === "undo_schedule") {
      const payload = asRecord(input);
      const receiptId = typeof payload.receiptId === "string" ? payload.receiptId : "";
      const expectedRevision = typeof payload.expectedRevision === "number" ? payload.expectedRevision : NaN;
      const transition = prepareUndo(state, receiptId, expectedRevision);
      if (!transition.ok) return failure(transition.error);
      options.writeState(transition.state);
      result = { ok: true, summary: "Exact rollback staged. The human planner must confirm it.", data: { proposalId: transition.state.pendingProposal!.proposalId, expectedRevision, focus: transition.state.focus } };
    } else {
      return { ok: false, code: "invalid_input", message: `Unknown operations tool: ${name}.` };
    }

    options.emit({
      tool: name,
      kind: name === "stage_schedule" ? "proposal" : name === "undo_schedule" ? "recovery" : name === "inspect_board" || name === "find_bottleneck" ? "read" : "simulation",
      summary: result.summary,
    });
    return result;
  }

  async function registerNative(): Promise<RegistrationSnapshot> {
    if (!native) return snapshot;
    for (const definition of definitions) {
      try {
        await native.registerTool(definition);
        snapshot.registered.push(definition.name);
      } catch {
        snapshot.failed.push(definition.name);
      }
    }
    snapshot.complete = snapshot.failed.length === 0 && snapshot.registered.length === definitions.length;
    snapshot.phase = snapshot.complete ? "registered" : "partial";
    snapshot.note = snapshot.complete ? "Six native operations tools ready." : `${snapshot.registered.length} tools ready; ${snapshot.failed.length} failed to register.`;
    return { ...snapshot, registered: [...snapshot.registered], failed: [...snapshot.failed] };
  }

  return {
    snapshot,
    settled: registerNative(),
    invoke: (name, input = {}) => dispatch(name, input),
    cleanup: async () => {
      if (!native?.unregisterTool) return;
      await Promise.all(snapshot.registered.map((name) => native.unregisterTool!(name)));
    },
  };
}

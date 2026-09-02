import { scenario as defaultScenario } from "../data/fixtures.ts";

export type JobId = "pantry" | "archive" | "beacon" | "relay";
export type StationId = "prep" | "dispatch";
export type JobTint = "coral" | "gold" | "mint" | "blue";
export type JobPriority = "critical" | "standard";
export type Schedule = JobId[];
export type Phase = "setup" | "planning" | "awaiting_review" | "applied" | "disrupted";
export type AgentFocus = "idle" | "inspected" | "bottleneck" | "simulation" | "proposal" | "incident" | "recovery";
export type FocusSource = "player" | "agent" | "system";

export type FocusTarget = {
  stationId: StationId;
  jobId?: JobId;
  source: FocusSource;
};

export type Job = {
  id: JobId;
  code: string;
  label: string;
  shortLabel: string;
  description: string;
  prepDuration: number;
  dispatchDuration: number;
  deadline: number;
  priority: JobPriority;
  tint: JobTint;
};

export type Station = {
  id: StationId;
  label: string;
  shortLabel: string;
  description: string;
  parallelism: number;
  tint: "coral" | "blue";
};

export type Disruption = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  dispatchParallelism: number;
};

export type Scenario = {
  id: string;
  title: string;
  subtitle: string;
  brief: string;
  objective: string;
  horizon: number;
  constraints: string[];
  stations: Station[];
  jobs: Job[];
  defaultSchedule: Schedule;
  robustSchedule: Schedule;
  disruption: Disruption;
};

export type JobRun = {
  jobId: JobId;
  prepStart: number;
  prepEnd: number;
  dispatchStart: number;
  dispatchEnd: number;
  dispatchLane: number;
  waiting: number;
  tardiness: number;
  onTime: boolean;
};

export type ScheduleMetrics = {
  completedJobs: number;
  onTimeJobs: number;
  tardyJobs: number;
  makespan: number;
  totalWaiting: number;
  dispatchIdle: number;
  criticalOnTime: boolean;
  criticalTardiness: number;
  score: number;
  risk: "clear" | "watch" | "critical";
};

export type ScheduleEvaluation = {
  schedule: Schedule;
  dispatchParallelism: number;
  jobs: JobRun[];
  metrics: ScheduleMetrics;
  bottleneck: StationId;
};

export type ScheduleAudit = {
  baseline: ScheduleEvaluation;
  stress: ScheduleEvaluation;
  finding: string;
  severity: "clear" | "watch" | "critical";
};

export type PendingProposal = {
  kind: "schedule" | "undo";
  proposalId: string;
  expectedRevision: number;
  schedule: Schedule;
  baseSchedule: Schedule;
  reason: string;
  returnPhase: "planning" | "disrupted";
  targetReceiptId?: string;
};

export type Receipt = {
  id: string;
  action: "applied" | "undone";
  revision: number;
  schedule: Schedule;
  previousSchedule: Schedule;
  metrics: ScheduleEvaluation;
  reason: string;
  shockApplied: boolean;
  targetReceiptId?: string;
};

export type ToolEvent = {
  id: string;
  tool: string;
  kind: "read" | "simulation" | "proposal" | "recovery" | "system";
  summary: string;
  at: string;
};

export type GameState = {
  scenario: Scenario;
  roundNumber: number;
  phase: Phase;
  schedule: Schedule;
  revision: number;
  playerReason: string;
  shockApplied: boolean;
  pendingProposal?: PendingProposal;
  lastAudit?: ScheduleAudit;
  activeReceipt?: Receipt;
  receipts: Receipt[];
  agentFocus: AgentFocus;
  focus: FocusTarget;
};

export type DomainError = {
  code: "invalid_input" | "precondition_failed" | "stale_revision" | "pending_proposal" | "invalid_schedule" | "no_active_receipt" | "proposal_not_found";
  message: string;
  details?: Record<string, unknown>;
};

export type Transition<T = GameState> = { ok: true; state: T } | { ok: false; error: DomainError };

const JOB_IDS: JobId[] = ["pantry", "archive", "beacon", "relay"];

export function cloneSchedule(schedule: Schedule): Schedule {
  return [...schedule];
}

export function getJob(scenario: Scenario, jobId: JobId): Job {
  return scenario.jobs.find((job) => job.id === jobId)!;
}

export function formatSchedule(schedule: Schedule, scenario: Scenario): string {
  return schedule.map((jobId) => getJob(scenario, jobId).shortLabel).join(" → ");
}

export function validateSchedule(scenario: Scenario, schedule: Schedule): Transition<Schedule> {
  if (schedule.length !== JOB_IDS.length || schedule.some((jobId) => !JOB_IDS.includes(jobId))) {
    return { ok: false, error: { code: "invalid_schedule", message: "The schedule must contain all four known jobs." } };
  }
  if (new Set(schedule).size !== JOB_IDS.length) {
    return { ok: false, error: { code: "invalid_schedule", message: "A job can appear only once in the schedule." } };
  }
  return { ok: true, state: cloneSchedule(schedule) };
}

export function evaluateSchedule(
  scenario: Scenario,
  schedule: Schedule,
  options: { dispatchParallelism?: number } = {},
): ScheduleEvaluation {
  const dispatchParallelism = options.dispatchParallelism ?? scenario.stations.find((station) => station.id === "dispatch")!.parallelism;
  const laneAvailable = Array.from({ length: dispatchParallelism }, () => 0);
  const jobs: JobRun[] = [];
  let prepCursor = 0;

  for (const jobId of schedule) {
    const job = getJob(scenario, jobId);
    const prepStart = prepCursor;
    const prepEnd = prepStart + job.prepDuration;
    prepCursor = prepEnd;

    let dispatchLane = 0;
    for (let lane = 1; lane < laneAvailable.length; lane += 1) {
      if (laneAvailable[lane] < laneAvailable[dispatchLane]) dispatchLane = lane;
    }
    const dispatchStart = Math.max(prepEnd, laneAvailable[dispatchLane]);
    const dispatchEnd = dispatchStart + job.dispatchDuration;
    laneAvailable[dispatchLane] = dispatchEnd;
    jobs.push({
      jobId,
      prepStart,
      prepEnd,
      dispatchStart,
      dispatchEnd,
      dispatchLane,
      waiting: dispatchStart - prepEnd,
      tardiness: Math.max(0, dispatchEnd - job.deadline),
      onTime: dispatchEnd <= job.deadline,
    });
  }

  const criticalRun = jobs.find((run) => getJob(scenario, run.jobId).priority === "critical")!;
  const onTimeJobs = jobs.filter((run) => run.onTime).length;
  const tardyJobs = jobs.length - onTimeJobs;
  const makespan = Math.max(...jobs.map((run) => run.dispatchEnd), 0);
  const totalWaiting = jobs.reduce((total, run) => total + run.waiting, 0);
  const dispatchBusy = jobs.reduce((total, run) => total + getJob(scenario, run.jobId).dispatchDuration, 0);
  const dispatchIdle = Math.max(0, scenario.horizon * dispatchParallelism - dispatchBusy - totalWaiting);
  const criticalOnTime = criticalRun.onTime;
  const risk = !criticalOnTime ? "critical" : tardyJobs > 0 ? "watch" : "clear";
  const score = Math.max(
    0,
    Math.min(100, Math.round(onTimeJobs * 20 + (criticalOnTime ? 20 : 0) + Math.max(0, scenario.horizon - makespan) * 2 - totalWaiting)),
  );
  const prepBusy = scenario.jobs.reduce((total, job) => total + job.prepDuration, 0);
  const prepUtilization = prepBusy / scenario.horizon;
  const dispatchUtilization = dispatchBusy / (scenario.horizon * dispatchParallelism);

  return {
    schedule: cloneSchedule(schedule),
    dispatchParallelism,
    jobs,
    metrics: {
      completedJobs: jobs.length,
      onTimeJobs,
      tardyJobs,
      makespan,
      totalWaiting,
      dispatchIdle,
      criticalOnTime,
      criticalTardiness: criticalRun.tardiness,
      score,
      risk,
    },
    bottleneck: dispatchUtilization >= prepUtilization ? "dispatch" : "prep",
  };
}

export function auditSchedule(scenario: Scenario, schedule: Schedule): ScheduleAudit {
  const baseline = evaluateSchedule(scenario, schedule, { dispatchParallelism: 2 });
  const stress = evaluateSchedule(scenario, schedule, { dispatchParallelism: scenario.disruption.dispatchParallelism });
  const criticalJob = scenario.jobs.find((job) => job.priority === "critical")!;
  let finding = `${criticalJob.shortLabel} stays on time under both conditions.`;
  let severity: ScheduleAudit["severity"] = "clear";

  if (baseline.metrics.criticalOnTime && !stress.metrics.criticalOnTime) {
    finding = `${criticalJob.shortLabel} is on time in the normal shift, but misses by ${stress.metrics.criticalTardiness} slot${stress.metrics.criticalTardiness === 1 ? "" : "s"} when a dispatch berth goes offline.`;
    severity = "critical";
  } else if (stress.metrics.tardyJobs > baseline.metrics.tardyJobs) {
    finding = `The plan picks up ${stress.metrics.tardyJobs - baseline.metrics.tardyJobs} additional late job${stress.metrics.tardyJobs - baseline.metrics.tardyJobs === 1 ? "" : "s"} under the disruption.`;
    severity = "watch";
  }

  return { baseline, stress, finding, severity };
}

export function createInitialState(inputScenario: Scenario = defaultScenario): GameState {
  return {
    scenario: inputScenario,
    roundNumber: 1,
    phase: "setup",
    schedule: cloneSchedule(inputScenario.defaultSchedule),
    revision: 1,
    playerReason: "",
    shockApplied: false,
    receipts: [],
    agentFocus: "idle",
    focus: { stationId: "dispatch", jobId: "beacon", source: "system" },
  };
}

export function enterArena(state: GameState): Transition {
  if (state.phase !== "setup") return { ok: false, error: { code: "precondition_failed", message: "The current shift is already in the arena." } };
  return { ok: true, state: { ...state, phase: "planning", revision: state.revision + 1, agentFocus: "idle", focus: { ...state.focus, source: "system" } } };
}

export function reorderJob(state: GameState, from: number, to: number): Transition {
  if (state.pendingProposal) return { ok: false, error: { code: "pending_proposal", message: "Review or reject the pending plan before editing the schedule." } };
  if (state.phase !== "planning" && state.phase !== "disrupted") {
    return { ok: false, error: { code: "precondition_failed", message: "Jobs can only be reordered while planning or recovering." } };
  }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= state.schedule.length || to >= state.schedule.length) {
    return { ok: false, error: { code: "invalid_input", message: "That schedule position does not exist." } };
  }
  const schedule = cloneSchedule(state.schedule);
  const [job] = schedule.splice(from, 1);
  schedule.splice(to, 0, job);
  return {
    ok: true,
    state: { ...state, schedule, revision: state.revision + 1, lastAudit: undefined, agentFocus: "idle" },
  };
}

export function setPlayerReason(state: GameState, reason: string): GameState {
  return { ...state, playerReason: reason };
}

export function setFocus(state: GameState, focus: FocusTarget): GameState {
  return { ...state, focus };
}

export function recordAudit(state: GameState, audit: ScheduleAudit, focus: AgentFocus = "simulation"): GameState {
  const activeEvaluation = state.shockApplied ? audit.stress : audit.baseline;
  const focusRun = activeEvaluation.jobs.find((run) => !run.onTime)
    ?? activeEvaluation.jobs.reduce((current, run) => run.waiting > current.waiting ? run : current, activeEvaluation.jobs[0]);
  return {
    ...state,
    lastAudit: audit,
    agentFocus: focus,
    focus: { stationId: activeEvaluation.bottleneck, jobId: focusRun?.jobId, source: "agent" },
  };
}

export function applyDisruption(state: GameState): Transition {
  if (state.phase !== "applied" || state.pendingProposal) {
    return { ok: false, error: { code: "precondition_failed", message: "The shift can only be disrupted after a plan is confirmed." } };
  }
  const lastAudit = auditSchedule(state.scenario, state.schedule);
  return {
    ok: true,
    state: {
      ...state,
      phase: "disrupted",
      shockApplied: true,
      revision: state.revision + 1,
      lastAudit,
      agentFocus: "incident",
      focus: { stationId: "dispatch", jobId: state.scenario.jobs.find((job) => job.priority === "critical")?.id, source: "system" },
    },
  };
}

export function stageSchedule(state: GameState, schedule: Schedule, reason: string, expectedRevision: number): Transition {
  if (state.pendingProposal) return { ok: false, error: { code: "pending_proposal", message: "A plan is already waiting for human review." } };
  if (state.phase !== "planning" && state.phase !== "disrupted") {
    return { ok: false, error: { code: "precondition_failed", message: "A plan can only be staged from the active planning board." } };
  }
  if (expectedRevision !== state.revision) return { ok: false, error: { code: "stale_revision", message: `This plan is stale. The board is now revision ${state.revision}.` } };
  if (reason.trim().length < 3) return { ok: false, error: { code: "invalid_input", message: "Add a short human reason before staging a plan." } };
  const valid = validateSchedule(state.scenario, schedule);
  if (!valid.ok) return valid;
  const next: PendingProposal = {
    kind: "schedule",
    proposalId: `proposal-${state.roundNumber}-${state.revision}`,
    expectedRevision,
    schedule: valid.state,
    baseSchedule: cloneSchedule(state.schedule),
    reason: reason.trim(),
    returnPhase: state.phase,
  };
  return { ok: true, state: { ...state, phase: "awaiting_review", pendingProposal: next, agentFocus: "proposal" } };
}

export function updatePendingReason(state: GameState, reason: string): Transition {
  if (!state.pendingProposal) return { ok: false, error: { code: "proposal_not_found", message: "There is no pending plan to edit." } };
  return { ok: true, state: { ...state, pendingProposal: { ...state.pendingProposal, reason } } };
}

export function rejectPending(state: GameState): Transition {
  if (!state.pendingProposal) return { ok: false, error: { code: "proposal_not_found", message: "There is no pending plan to reject." } };
  return { ok: true, state: { ...state, phase: state.pendingProposal.returnPhase, pendingProposal: undefined, agentFocus: "idle" } };
}

export function confirmPending(state: GameState): Transition {
  const proposal = state.pendingProposal;
  if (!proposal) return { ok: false, error: { code: "proposal_not_found", message: "There is no pending plan to confirm." } };
  if (proposal.expectedRevision !== state.revision) return { ok: false, error: { code: "stale_revision", message: "The pending plan no longer matches the current board." } };
  if (proposal.reason.trim().length < 3) return { ok: false, error: { code: "invalid_input", message: "The human reason must contain at least three characters." } };
  const revision = state.revision + 1;
  const metrics = evaluateSchedule(state.scenario, proposal.schedule, { dispatchParallelism: state.shockApplied ? 1 : 2 });
  const previousConfirmedSchedule = state.activeReceipt ? state.activeReceipt.schedule : state.schedule;
  const receipt: Receipt = {
    id: `receipt-${state.roundNumber}-${revision}`,
    action: proposal.kind === "undo" ? "undone" : "applied",
    revision,
    schedule: cloneSchedule(proposal.schedule),
    previousSchedule: cloneSchedule(previousConfirmedSchedule),
    metrics,
    reason: proposal.reason.trim(),
    shockApplied: state.shockApplied,
    targetReceiptId: proposal.targetReceiptId,
  };
  const nextPhase: Phase = proposal.returnPhase === "planning" ? "applied" : "disrupted";
  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      schedule: cloneSchedule(proposal.schedule),
      revision,
      pendingProposal: undefined,
      activeReceipt: receipt,
      receipts: [...state.receipts, receipt],
      lastAudit: auditSchedule(state.scenario, proposal.schedule),
      agentFocus: proposal.kind === "undo" ? "recovery" : "inspected",
      focus: {
        stationId: state.shockApplied ? "dispatch" : "prep",
        jobId: proposal.schedule[0],
        source: "system",
      },
    },
  };
}

export function prepareUndo(state: GameState, receiptId: string, expectedRevision: number): Transition {
  if (state.pendingProposal) return { ok: false, error: { code: "pending_proposal", message: "Review the current proposal before preparing another action." } };
  if (state.phase !== "applied" && state.phase !== "disrupted") {
    return { ok: false, error: { code: "precondition_failed", message: "Undo is available after a confirmed plan." } };
  }
  if (expectedRevision !== state.revision) return { ok: false, error: { code: "stale_revision", message: `This undo is stale. The board is now revision ${state.revision}.` } };
  if (!state.activeReceipt || state.activeReceipt.id !== receiptId || state.activeReceipt.action === "undone") {
    return { ok: false, error: { code: "no_active_receipt", message: "That receipt is not the active confirmed plan." } };
  }
  return {
    ok: true,
    state: {
      ...state,
      pendingProposal: {
        kind: "undo",
        proposalId: `undo-${state.roundNumber}-${state.revision}`,
        expectedRevision,
        schedule: cloneSchedule(state.activeReceipt.previousSchedule),
        baseSchedule: cloneSchedule(state.schedule),
        reason: "Restore the previous schedule so the shift can be reconsidered.",
        returnPhase: state.shockApplied ? "disrupted" : "planning",
        targetReceiptId: state.activeReceipt.id,
      },
      agentFocus: "recovery",
      phase: "awaiting_review",
      focus: { stationId: "dispatch", jobId: state.activeReceipt.previousSchedule[0], source: "agent" },
    },
  };
}

export function resetRound(state: GameState): GameState {
  return {
    ...createInitialState(state.scenario),
    roundNumber: state.roundNumber + 1,
  };
}

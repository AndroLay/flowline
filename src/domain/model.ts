import { scenario as defaultScenario } from "../data/fixtures.ts";

/**
 * A job's identity, validated against the shift it belongs to rather than against a closed
 * union. There is more than one shift now, and each brings its own jobs, so a union here
 * would have to list every job in the game and would still not say which shift a given id
 * is legal in. `validateSchedule` answers that question from `scenario.jobs`, which is the
 * only list that can be right.
 */
export type JobId = string;
export type StationId = "prep" | "dispatch";
/** Which job this is. Never how it is doing — that is a verdict, and it has its own three. */
export type JobTint = "ice" | "azure" | "violet" | "cobalt" | "quartz";
export type JobPriority = "critical" | "standard";
export type Schedule = JobId[];
export type Phase = "setup" | "planning" | "awaiting_review" | "applied" | "disrupted" | "closed";
export type AgentFocus = "idle" | "inspected" | "bottleneck" | "simulation" | "proposal" | "incident" | "recovery";
export type FocusSource = "player" | "agent" | "system";

/**
 * Where the floor is pointed, and why. The reason is required: a scene that moves when a
 * tool runs but cannot say what it is showing is decoration, and it is the sentence the
 * focus page reads out. `berthIndex` is set only when the cause is one particular berth —
 * the one the shift lost, or the one the focused job is standing in — so the page can name
 * it instead of gesturing at the bay.
 */
export type FocusTarget = {
  stationId: StationId;
  jobId?: JobId;
  berthIndex?: number;
  reason: string;
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
  /**
   * The slot the job is available from, on the same clock as every other reading here.
   * Zero means it is on the floor when the shift opens. Anything higher means it is still
   * in intake, and prep cannot start it early however the order is arranged — which is what
   * makes a queue a constraint rather than a list.
   */
  releaseAt: number;
  priority: JobPriority;
  tint: JobTint;
};

export type Station = {
  id: StationId;
  label: string;
  shortLabel: string;
  description: string;
  parallelism: number;
};

/**
 * The one thing that goes wrong in a shift. `dispatchParallelism` is the capacity left
 * after it lands, and `releaseDelays` pushes named jobs later into intake — so a shift can
 * lose a berth, or have a supplier arrive late, or both, without the evaluator growing a
 * second notion of what a shock is.
 */
export type Disruption = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  /**
   * The shock as a verb phrase, so a sentence can say "once <clause> lands". The findings
   * are quoted verbatim by the audit rail, the tool responses and the result card, and a
   * shift whose shock is a late arrival cannot borrow the sentence written for a lost berth.
   */
  clause: string;
  dispatchParallelism: number;
  releaseDelays?: { jobId: JobId; slots: number }[];
};

/**
 * One shift: its floor, its jobs, its intake, and the single thing that goes wrong in it.
 * `order` is the position in the campaign, and `lesson` is the sentence the result card
 * checks the player against — kept on the shift rather than in the UI so a new shift cannot
 * be added without saying what it is supposed to teach.
 */
export type Scenario = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  brief: string;
  objective: string;
  lesson: string;
  horizon: number;
  constraints: string[];
  stations: Station[];
  jobs: Job[];
  defaultSchedule: Schedule;
  robustSchedule: Schedule;
  disruption: Disruption;
};

/**
 * How one job's run stands against its own deadline. Three words, because three is
 * what every surface legends: the timeline, the floor slabs and the 3D scene all read
 * this one field instead of each deciding for itself what counts as close.
 */
export type JobVerdict = "on-time" | "at-risk" | "missed";

export type JobRun = {
  jobId: JobId;
  /** The slot the job became available, after any disruption delay. */
  releaseAt: number;
  /** Slots the job spent in intake because prep was busy when it arrived. */
  intakeWait: number;
  prepStart: number;
  prepEnd: number;
  dispatchStart: number;
  dispatchEnd: number;
  dispatchLane: number;
  waiting: number;
  tardiness: number;
  onTime: boolean;
  /** The one verdict the board, the floor and the scene are all allowed to draw. */
  verdict: JobVerdict;
};

export type ScheduleMetrics = {
  completedJobs: number;
  onTimeJobs: number;
  tardyJobs: number;
  makespan: number;
  totalWaiting: number;
  /** Slots jobs spent queued in intake, waiting for a prep crew that was already busy. */
  totalIntakeWait: number;
  /** Prep capacity the plan cannot use because the next job has not arrived yet. */
  prepStarved: number;
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

/**
 * A read-only comparison of some candidate order against the plan on the board.
 * It is deliberately a separate field from lastAudit: lastAudit is the explanation
 * of the schedule the timeline is showing, and letting a candidate write into it
 * made the page describe a plan nobody could see. Both the base order and the
 * revision are kept so a comparison that has gone stale can be recognised instead
 * of being drawn as though it still applied.
 */
export type PlanComparison = {
  schedule: Schedule;
  baseSchedule: Schedule;
  revision: number;
  audit: ScheduleAudit;
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

/**
 * One line of the tool trace: what an agent asked for, and what it actually did to
 * the board. Refusals are recorded exactly like successes, because a call the runtime
 * turned down is the part of the boundary worth showing — so `ok` and `code` carry as
 * much of the story as `summary` does. The revision is kept on both sides of the call
 * so a reader can tell a read from a write without trusting the tool's own name, and
 * `input` is a reduced description rather than the payload: known arguments only,
 * lengths in place of free text, so a trace never becomes a second copy of a reason
 * the planner typed.
 */
export type ToolEvent = {
  id: string;
  tool: string;
  kind: "read" | "simulation" | "proposal" | "recovery" | "system";
  ok: boolean;
  summary: string;
  code?: DomainError["code"];
  phase: Phase;
  revisionBefore: number;
  revisionAfter: number;
  focus?: FocusTarget;
  proposalId?: string;
  receiptId?: string;
  input?: string;
  at: string;
};

/**
 * One line of the shift report: a thing the shift asked for, whether the closed board did
 * it, and the number that decides it. Every objective is derived from the final evaluation
 * or from the trace — none is scored by opinion, and none of them scores the sentence the
 * player wrote, because the game does not mark comprehension.
 */
export type ShiftObjective = {
  id: string;
  label: string;
  met: boolean;
  detail: string;
  /** False for objectives the design guarantees; those are reported, not graded. */
  graded: boolean;
};

export type ShiftGrade = "A" | "B" | "C" | "D";

/**
 * The result card. It reports the board that was closed and the division of labour that
 * produced it: how many calls an agent made, how many the runtime refused, and how many
 * times a human clicked confirm. The last of those is the number the whole package is
 * about, so it is on the card rather than in a doc.
 */
export type ShiftResult = {
  scenarioId: string;
  scenarioTitle: string;
  shiftOrder: number;
  grade: ShiftGrade;
  score: number;
  objectivesMet: number;
  objectivesGraded: number;
  finalSchedule: Schedule;
  evaluation: ScheduleEvaluation;
  objectives: ShiftObjective[];
  activity: {
    revisions: number;
    humanConfirmations: number;
    toolCalls: number;
    toolRefusals: number;
    rollbacksPrepared: number;
    reasonsWritten: number;
  };
  lesson: string;
  /** The card as plain text, so a player can paste what they achieved somewhere else. */
  summary: string[];
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
  lastComparison?: PlanComparison;
  activeReceipt?: Receipt;
  receipts: Receipt[];
  agentFocus: AgentFocus;
  focus: FocusTarget;
  /** The card for the shift currently closed, if it has been closed. */
  resultCard?: ShiftResult;
  /** Every card earned in this session, oldest first. Cleared by nothing. */
  results: ShiftResult[];
};

export type DomainError = {
  code: "invalid_input" | "precondition_failed" | "stale_revision" | "pending_proposal" | "invalid_schedule" | "no_active_receipt" | "proposal_not_found" | "shift_not_closed";
  message: string;
  details?: Record<string, unknown>;
};

export type Transition<T = GameState> = { ok: true; state: T } | { ok: false; error: DomainError };

/**
 * The actions the current state can honestly expose to a client. This is deliberately
 * derived from the same phase and proposal guards the transitions use; the scene model
 * and semantic tool responses must not grow their own, optimistic action list.
 *
 * Human actions are named explicitly. There is intentionally no `confirm` tool: a
 * WebMCP client can prepare a proposal, but only the page owner can commit it.
 */
export function availableActions(state: Pick<GameState, "phase" | "pendingProposal">): string[] {
  if (state.pendingProposal) return ["review proposal (human)", "confirm (human)", "reject (human)"];
  switch (state.phase) {
    case "setup":
      return ["list_shifts", "enter arena (human)", "choose shift (human)"];
    case "planning":
      return ["inspect_board", "list_shifts", "find_bottleneck", "simulate_disruption", "compare_plans", "stage_schedule", "reorder (human)"];
    case "applied":
      return ["inspect_board", "list_shifts", "find_bottleneck", "simulate_disruption", "undo_schedule", "reveal disruption (human)"];
    case "disrupted":
      return ["inspect_board", "list_shifts", "find_bottleneck", "simulate_disruption", "compare_plans", "stage_schedule", "undo_schedule", "reorder (human)", "close shift (human)"];
    case "closed":
      return ["inspect_board", "list_shifts", "review_shift", "next shift (human)", "replay shift (human)"];
    case "awaiting_review":
      // A pending proposal is handled above. This branch is defensive for malformed
      // host state, and is safer than suggesting a mutation that would be refused.
      return ["review proposal (human)"];
  }
}

export function cloneSchedule(schedule: Schedule): Schedule {
  return [...schedule];
}

export function getJob(scenario: Scenario, jobId: JobId): Job {
  return scenario.jobs.find((job) => job.id === jobId)!;
}

/**
 * The one job whose deadline the shift is graded on. Every shift declares exactly one, and
 * five surfaces used to re-find it by hand — the audit, the recommender, the opening focus,
 * the shock focus and the card — which is five chances for one of them to disagree about
 * what the round is about.
 */
export function criticalJob(scenario: Scenario): Job {
  return scenario.jobs.find((job) => job.priority === "critical") ?? scenario.jobs[0];
}

/** The berths the shift starts with, before anything goes wrong. */
export function dispatchBerths(scenario: Scenario): number {
  return scenario.stations.find((station) => station.id === "dispatch")!.parallelism;
}

/**
 * The evaluator options for one shift under one condition. A disruption may take berths
 * away, delay arrivals, or both, and every surface that evaluates a plan — the board, the
 * audit, a receipt, the card, five tool handlers — has to apply exactly the same pair or it
 * will report a different board than the one the player is looking at. One shift built the
 * options by hand on each surface and its late arrival reached only the audit; this is the
 * one place that decides, so a shift cannot be half-shocked again.
 */
export function shiftOptions(
  scenario: Scenario,
  shocked: boolean,
): { dispatchParallelism: number; releaseDelays?: { jobId: JobId; slots: number }[] } {
  if (!shocked) return { dispatchParallelism: dispatchBerths(scenario) };
  return {
    dispatchParallelism: scenario.disruption.dispatchParallelism,
    releaseDelays: scenario.disruption.releaseDelays,
  };
}

/**
 * The jobs still in intake at a given point on the clock, front of the queue first. The
 * intake rail draws this, `inspect_board` reports it, and the evaluator honours the same
 * `releaseAt` it reads — one arrival time, three readers.
 */
export function intakeAt(scenario: Scenario, schedule: Schedule, clock: number): Job[] {
  return schedule
    .map((jobId) => getJob(scenario, jobId))
    .filter((job) => job.releaseAt > clock);
}

export function formatSchedule(schedule: Schedule, scenario: Scenario): string {
  return schedule.map((jobId) => getJob(scenario, jobId).shortLabel).join(" → ");
}

/**
 * The one slot convention, and the two functions that apply it. The evaluator runs on a
 * continuous clock: a job holds a berth from `dispatchStart` to `dispatchEnd`, and a
 * deadline is compared against `dispatchEnd`. Slots as a reader counts them are 1-based
 * and inclusive, so the first slot a run occupies is `dispatchStart + 1`, the last is
 * `dispatchEnd`, and a deadline is an end-slot number already. Both were being derived by
 * hand on each surface, and one of them was off by one — the spoken summary of the focus
 * page announced a dispatch a slot later than the timeline drew it. Anything that shows a
 * slot number reads it from here.
 */
export function startSlot(run: Pick<JobRun, "dispatchStart">): number {
  return run.dispatchStart + 1;
}

export function endSlot(run: Pick<JobRun, "dispatchEnd">): number {
  return run.dispatchEnd;
}

/**
 * The inclusive slot window between two clock readings, for labels and titles: a bar
 * running from 5 to 7 covers "6–7". Both stages of the pipeline are measured on the same
 * clock, so this is what a prep bar and a dispatch bar are both described with.
 */
export function slotWindow(fromClock: number, toClock: number): string {
  return `${fromClock + 1}–${toClock}`;
}

export function validateSchedule(scenario: Scenario, schedule: Schedule): Transition<Schedule> {
  const scenarioJobIds = scenario.jobs.map((job) => job.id);
  if (schedule.length !== scenarioJobIds.length || schedule.some((jobId) => !scenarioJobIds.includes(jobId))) {
    return {
      ok: false,
      error: {
        code: "invalid_schedule",
        message: `The schedule must contain all ${scenarioJobIds.length} jobs on this shift: ${scenarioJobIds.join(", ")}.`,
      },
    };
  }
  if (new Set(schedule).size !== scenarioJobIds.length) {
    return { ok: false, error: { code: "invalid_schedule", message: "A job can appear only once in the schedule." } };
  }
  return { ok: true, state: cloneSchedule(schedule) };
}

/**
 * The verdict on one run, decided by the slack the plan leaves it and by nothing else.
 * A job that lands in its last legal slot is on time and one slot of trouble away from
 * not being: that is the state the timeline legend calls "at risk", and it is the state
 * the whole scenario turns on, because the efficient normal order clears the critical
 * job exactly on its deadline and the berth that goes offline is what takes the slot
 * away. Waiting for a berth is deliberately not part of this: a job can queue for two
 * slots and still leave with room to spare, and a floor that painted it at risk would
 * be reporting the queue twice — once as waiting, once as danger.
 */
export function jobVerdict(run: { dispatchEnd: number }, job: { deadline: number }): JobVerdict {
  if (run.dispatchEnd > job.deadline) return "missed";
  return run.dispatchEnd === job.deadline ? "at-risk" : "on-time";
}

/**
 * The whole simulator. Jobs pass through prep in the order given and then take the first
 * dispatch berth that frees up, and a job cannot enter prep before it has arrived — which is
 * the only reason the order of the queue is a decision rather than a preference.
 *
 * `releaseDelays` is how a disruption reaches intake: the shock is applied to the arrival
 * time here rather than baked into the fixture, so the same shift can be read under normal
 * intake and under a late supplier without keeping two copies of its jobs.
 */
export function evaluateSchedule(
  scenario: Scenario,
  schedule: Schedule,
  options: { dispatchParallelism?: number; releaseDelays?: { jobId: JobId; slots: number }[] } = {},
): ScheduleEvaluation {
  const dispatchParallelism = options.dispatchParallelism ?? dispatchBerths(scenario);
  const delays = new Map((options.releaseDelays ?? []).map((delay) => [delay.jobId, delay.slots]));
  const laneAvailable = Array.from({ length: dispatchParallelism }, () => 0);
  const jobs: JobRun[] = [];
  let prepCursor = 0;
  let prepStarved = 0;

  for (const jobId of schedule) {
    const job = getJob(scenario, jobId);
    const releaseAt = job.releaseAt + (delays.get(job.id) ?? 0);
    // Two different kinds of idleness, and they are not the same reading: a job that arrived
    // while prep was busy queues in intake, and a prep crew with nothing to start is starved
    // by the queue rather than by the plan.
    const intakeWait = Math.max(0, prepCursor - releaseAt);
    prepStarved += Math.max(0, releaseAt - prepCursor);
    const prepStart = Math.max(prepCursor, releaseAt);
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
      releaseAt,
      intakeWait,
      prepStart,
      prepEnd,
      dispatchStart,
      dispatchEnd,
      dispatchLane,
      waiting: dispatchStart - prepEnd,
      tardiness: Math.max(0, dispatchEnd - job.deadline),
      onTime: dispatchEnd <= job.deadline,
      verdict: jobVerdict({ dispatchEnd }, job),
    });
  }

  const criticalRun = jobs.find((run) => getJob(scenario, run.jobId).priority === "critical")!;
  const onTimeJobs = jobs.filter((run) => run.onTime).length;
  const tardyJobs = jobs.length - onTimeJobs;
  const makespan = Math.max(...jobs.map((run) => run.dispatchEnd), 0);
  const totalWaiting = jobs.reduce((total, run) => total + run.waiting, 0);
  const totalIntakeWait = jobs.reduce((total, run) => total + run.intakeWait, 0);
  const dispatchBusy = jobs.reduce((total, run) => total + getJob(scenario, run.jobId).dispatchDuration, 0);
  // Idle is the dispatch capacity the plan never uses: every berth offers one slot
  // per slot of the horizon, and the plan spends dispatchBusy of them. Waiting time
  // is not subtracted here — a job waiting for a berth is exactly a berth standing
  // idle, so subtracting it a second time counted the same slot twice and read as
  // zero idle capacity whenever a berth went offline.
  const dispatchIdle = Math.max(0, scenario.horizon * dispatchParallelism - dispatchBusy);
  const criticalOnTime = criticalRun.onTime;
  const risk = !criticalOnTime ? "critical" : tardyJobs > 0 ? "watch" : "clear";
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        onTimeJobs * 20
        + (criticalOnTime ? 20 : 0)
        + Math.max(0, scenario.horizon - makespan) * 2
        - totalWaiting
        - totalIntakeWait,
      ),
    ),
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
      totalIntakeWait,
      prepStarved,
      dispatchIdle,
      criticalOnTime,
      criticalTardiness: criticalRun.tardiness,
      score,
      risk,
    },
    bottleneck: dispatchUtilization >= prepUtilization ? "dispatch" : "prep",
  };
}

/**
 * A count of slots in words, for the audit's sentences and for the screen-reader text that
 * reports the same number on the board. Exported because "1 slots late" was being spoken on
 * the floor while the audit next to it said "1 slot": one convention, one plural rule.
 */
export function slots(count: number): string {
  return `${count} slot${count === 1 ? "" : "s"}`;
}

/**
 * Reads one plan under both dispatch capacities and says what is wrong with it.
 * The branches are ordered worst case first, and every branch that leaves a job
 * late reports a severity to match: the finding is the sentence the focus rail and
 * the tool results both quote, so it may never claim a plan holds when the
 * evaluation it was derived from says otherwise.
 */
export function auditSchedule(scenario: Scenario, schedule: Schedule): ScheduleAudit {
  const baseline = evaluateSchedule(scenario, schedule, shiftOptions(scenario, false));
  const stress = evaluateSchedule(scenario, schedule, shiftOptions(scenario, true));
  const critical = criticalJob(scenario);
  const addedTardy = stress.metrics.tardyJobs - baseline.metrics.tardyJobs;
  // The shock is named by the shift, because losing a berth and losing an arrival are not
  // the same sentence and the finding is quoted verbatim on three surfaces.
  const shock = scenario.disruption.clause;
  let finding = `${critical.shortLabel} stays on time under both conditions, and no other job misses its deadline.`;
  let severity: ScheduleAudit["severity"] = "clear";

  if (!baseline.metrics.criticalOnTime) {
    finding = `${critical.shortLabel} already misses its deadline by ${slots(baseline.metrics.criticalTardiness)} in the normal shift`
      + (stress.metrics.criticalTardiness > baseline.metrics.criticalTardiness
        ? `, and by ${slots(stress.metrics.criticalTardiness)} once ${shock}.`
        : ", before anything goes wrong.");
    severity = "critical";
  } else if (!stress.metrics.criticalOnTime) {
    finding = `${critical.shortLabel} is on time in the normal shift, but misses by ${slots(stress.metrics.criticalTardiness)} once ${shock}.`;
    severity = "critical";
  } else if (addedTardy > 0) {
    finding = `${critical.shortLabel} holds, but the plan picks up ${addedTardy} additional late job${addedTardy === 1 ? "" : "s"} under the disruption.`;
    severity = "watch";
  } else if (baseline.metrics.tardyJobs > 0) {
    finding = `${critical.shortLabel} holds under both conditions, but ${baseline.metrics.tardyJobs} other job${baseline.metrics.tardyJobs === 1 ? "" : "s"} already misses its deadline in the normal shift.`;
    severity = "watch";
  }

  return { baseline, stress, finding, severity };
}

export type PlanRecommendation = {
  schedule: Schedule;
  reason: string;
  audit: ScheduleAudit;
  movedJobs: number;
};

type RankedPlan = { schedule: Schedule; audit: ScheduleAudit; movedJobs: number; criticalEnd: number };

function permutations(jobIds: Schedule): Schedule[] {
  if (jobIds.length <= 1) return [cloneSchedule(jobIds)];
  return jobIds.flatMap((jobId, index) =>
    permutations([...jobIds.slice(0, index), ...jobIds.slice(index + 1)]).map((rest) => [jobId, ...rest]),
  );
}

function movedPositions(from: Schedule, to: Schedule): number {
  return to.filter((jobId, index) => from[index] !== jobId).length;
}

/**
 * Worst case first, and the disrupted shift before the normal one: the round is about
 * whether a plan survives losing a berth, so an order that keeps the critical job on
 * time under the shock outranks one that merely scores well while both berths are up.
 * Among the orders that hold, the one that finishes the critical job earliest wins: two
 * plans can both be on time while one lands exactly on the deadline and the other keeps
 * slots of margin, and margin is the whole lesson of the round. The last two keys make
 * the ranking total and stable — fewest positions moved, then the order's own name — so
 * the same board always yields the same candidate, and the plan already on the board
 * wins every tie it is part of.
 */
function rankPlans(a: RankedPlan, b: RankedPlan): number {
  return (Number(b.audit.stress.metrics.criticalOnTime) - Number(a.audit.stress.metrics.criticalOnTime))
    || (a.audit.stress.metrics.tardyJobs - b.audit.stress.metrics.tardyJobs)
    || (a.audit.stress.metrics.criticalTardiness - b.audit.stress.metrics.criticalTardiness)
    || (a.criticalEnd - b.criticalEnd)
    || (b.audit.stress.metrics.score - a.audit.stress.metrics.score)
    || (a.audit.stress.metrics.totalIntakeWait - b.audit.stress.metrics.totalIntakeWait)
    || (a.audit.baseline.metrics.tardyJobs - b.audit.baseline.metrics.tardyJobs)
    || (b.audit.baseline.metrics.score - a.audit.baseline.metrics.score)
    || (a.movedJobs - b.movedJobs)
    || a.schedule.join(">").localeCompare(b.schedule.join(">"));
}

/**
 * The auditor's own candidate, searched rather than looked up. The scenario carries a
 * robust order, but it is a worked example for the tests and the docs: reading it here
 * would make the page an answer key, where the agent is right because a fixture said so
 * rather than because the plan survives the shift. So this ranks every order the four
 * jobs allow, through the same evaluator the board uses, and explains its pick with the
 * numbers that decided it. It returns nothing when the plan on the board is already the
 * best available — the state a player reaches by solving the round, and the one case
 * where an agent has nothing to propose.
 */
export function recommendSchedule(scenario: Scenario, schedule: Schedule): PlanRecommendation | undefined {
  const critical = criticalJob(scenario);
  const criticalEndUnderStress = (audit: ScheduleAudit) =>
    audit.stress.jobs.find((run) => run.jobId === critical.id)!.dispatchEnd;
  const current = auditSchedule(scenario, schedule);
  const ranked: RankedPlan[] = permutations(scenario.jobs.map((job) => job.id))
    .map((candidate) => {
      const audit = auditSchedule(scenario, candidate);
      return { schedule: candidate, audit, movedJobs: movedPositions(schedule, candidate), criticalEnd: criticalEndUnderStress(audit) };
    })
    .sort(rankPlans);
  const best = ranked[0];
  if (best.movedJobs === 0) return undefined;

  const proposed = best.audit.stress.jobs.find((run) => run.jobId === critical.id)!;
  const board = current.stress.jobs.find((run) => run.jobId === critical.id)!;
  const position = best.schedule.indexOf(critical.id) + 1;
  const recoveredJobs = current.stress.metrics.tardyJobs - best.audit.stress.metrics.tardyJobs;

  let reason: string;
  if (!board.onTime && proposed.onTime) {
    reason = `Moves ${critical.shortLabel} to position ${position}, so it clears dispatch by slot ${endSlot(proposed)} and holds its slot ${critical.deadline} deadline once ${scenario.disruption.clause}. The order on the board misses it by ${slots(board.tardiness)}.`;
  } else if (recoveredJobs > 0) {
    reason = `Keeps ${critical.shortLabel} on time and brings ${recoveredJobs} other job${recoveredJobs === 1 ? "" : "s"} back inside ${recoveredJobs === 1 ? "its" : "their"} deadline${recoveredJobs === 1 ? "" : "s"} once ${scenario.disruption.clause}.`;
  } else if (proposed.dispatchEnd < board.dispatchEnd) {
    // Both orders hold, so the argument is margin: how much of the window is left when the
    // shock lands, which is what the player is really being taught to buy.
    reason = `Both orders hold, but this one clears ${critical.shortLabel} by slot ${endSlot(proposed)} instead of slot ${endSlot(board)}, leaving ${slots(critical.deadline - endSlot(proposed))} of margin against the slot ${critical.deadline} deadline.`;
  } else if (best.audit.stress.metrics.totalWaiting !== current.stress.metrics.totalWaiting) {
    reason = `Holds the same deadlines under the shift with less time spent waiting for a berth: ${slots(best.audit.stress.metrics.totalWaiting)} against ${slots(current.stress.metrics.totalWaiting)} on the board.`;
  } else {
    reason = `Holds the same deadlines under the shift with less time queued in intake: ${slots(best.audit.stress.metrics.totalIntakeWait)} against ${slots(current.stress.metrics.totalIntakeWait)} on the board.`;
  }

  return { schedule: best.schedule, reason, audit: best.audit, movedJobs: best.movedJobs };
}

export function createInitialState(inputScenario: Scenario = defaultScenario): GameState {
  const critical = criticalJob(inputScenario);
  return {
    scenario: inputScenario,
    roundNumber: 1,
    phase: "setup",
    schedule: cloneSchedule(inputScenario.defaultSchedule),
    revision: 1,
    playerReason: "",
    shockApplied: false,
    receipts: [],
    results: [],
    agentFocus: "idle",
    focus: {
      stationId: "dispatch",
      jobId: critical.id,
      reason: "The shift opens on the dispatch bay, where the critical job has to leave.",
      source: "system",
    },
  };
}

export function enterArena(state: GameState): Transition {
  if (state.phase !== "setup") return { ok: false, error: { code: "precondition_failed", message: "The current shift is already in the arena." } };
  return {
    ok: true,
    state: {
      ...state,
      phase: "planning",
      revision: state.revision + 1,
      agentFocus: "idle",
      focus: {
        ...state.focus,
        reason: "The board is open and nothing has been inspected yet.",
        source: "system",
      },
    },
  };
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
    state: { ...state, schedule, revision: state.revision + 1, lastAudit: undefined, lastComparison: undefined, agentFocus: "idle" },
  };
}

export function setPlayerReason(state: GameState, reason: string): GameState {
  return { ...state, playerReason: reason };
}

export function setFocus(state: GameState, focus: FocusTarget): GameState {
  return { ...state, focus };
}

/**
 * The focus each agent tool aims, built here rather than at the call sites so a target and
 * the sentence that explains it can never drift apart. Two different questions used to
 * produce the same focus — "where is the bottleneck" and "what breaks under the shock" both
 * landed on the first late job — which left the floor pointing somewhere that answered
 * neither. Each builder now reads the evaluation it is arguing from.
 */
function stationLabel(stationId: StationId): string {
  return stationId === "dispatch" ? "Dispatch bay" : "Prep bay";
}

/** Reading the board: the front of the queue, which is where the plan starts. */
export function focusOnQueue(scenario: Scenario, schedule: Schedule): FocusTarget {
  const first = getJob(scenario, schedule[0]);
  return {
    stationId: "prep",
    jobId: first.id,
    reason: `Reading the order as it stands: ${first.shortLabel} is first into prep.`,
    source: "agent",
  };
}

/**
 * The constraint itself: the station the evaluator names, and the run that spends the most
 * time waiting for it. A board where nothing waits has no queue to point at, so the focus
 * falls to the job that finishes last — the one holding the makespan.
 */
export function focusOnBottleneck(scenario: Scenario, evaluation: ScheduleEvaluation, shocked = false): FocusTarget {
  const waiting = evaluation.jobs.reduce((worst, run) => (run.waiting > worst.waiting ? run : worst), evaluation.jobs[0]);
  const last = evaluation.jobs.reduce((latest, run) => (run.dispatchEnd > latest.dispatchEnd ? run : latest), evaluation.jobs[0]);
  const run = waiting.waiting > 0 ? waiting : last;
  const job = getJob(scenario, run.jobId);
  // The condition is named in the sentence, because the same board has two different
  // constraints depending on whether it still has both berths.
  const shift = shocked ? " with a berth offline" : "";
  return {
    stationId: evaluation.bottleneck,
    jobId: job.id,
    berthIndex: evaluation.bottleneck === "dispatch" ? run.dispatchLane : undefined,
    reason: run.waiting > 0
      ? `${stationLabel(evaluation.bottleneck)} is the constraint${shift}: ${job.shortLabel} waits ${slots(run.waiting)} for it before dispatching in slots ${slotWindow(run.dispatchStart, run.dispatchEnd)}.`
      : `${stationLabel(evaluation.bottleneck)} is the busiest station${shift} and nothing queues for it: ${job.shortLabel} finishes last, at slot ${endSlot(run)}.`,
    source: "agent",
  };
}

/**
 * The shock: the berth the shift loses, and what losing it does to the job that cannot be
 * late. This is the one focus that names a berth nobody is standing in — the missing
 * capacity is the cause, so it is what the floor points at.
 */
export function focusOnShock(scenario: Scenario, audit: ScheduleAudit): FocusTarget {
  const critical = criticalJob(scenario);
  const run = audit.stress.jobs.find((item) => item.jobId === critical.id);
  const berths = dispatchBerths(scenario);
  const lost = audit.stress.dispatchParallelism < berths ? audit.stress.dispatchParallelism : undefined;
  // A shift that loses capacity can name the berth. A shift whose shock is a late arrival
  // has no berth to point at, so it points at the intake the delay hit.
  const delayed = scenario.disruption.releaseDelays?.[0];
  const named = lost !== undefined
    ? `berth ${lost + 1}`
    : delayed
      ? `${getJob(scenario, delayed.jobId).shortLabel} arriving ${slots(delayed.slots)} late`
      : "the shift";
  return {
    stationId: lost === undefined && delayed ? "prep" : "dispatch",
    jobId: critical.id,
    berthIndex: lost,
    reason: !run
      ? `${scenario.disruption.shortLabel}: ${named} is out for the shift.`
      : run.onTime
        ? `With ${named} ${lost === undefined && delayed ? "" : "offline "}${critical.shortLabel} still clears at slot ${endSlot(run)}, inside its slot ${critical.deadline} deadline.`
        : `With ${named} ${lost === undefined && delayed ? "" : "offline "}${critical.shortLabel} cannot start before slot ${startSlot(run)}, so it leaves at slot ${endSlot(run)} — ${slots(run.tardiness)} past its slot ${critical.deadline} deadline.`,
    source: "agent",
  };
}

/**
 * A candidate against the board. The focus goes to the job whose dispatch actually moves
 * between the two orders, because that job is the only one whose two routes are worth
 * drawing at once: the live route and the ghost route leave from different berths or land on
 * different slots, and that difference is the argument. Both orders hold the same four jobs,
 * so this never points at a run the floor cannot show.
 */
export function focusOnCandidate(scenario: Scenario, board: ScheduleEvaluation, candidate: ScheduleEvaluation): FocusTarget {
  const pairs = board.jobs
    .map((run) => ({ run, other: candidate.jobs.find((item) => item.jobId === run.jobId) }))
    .filter((pair): pair is { run: JobRun; other: JobRun } => Boolean(pair.other));
  const moved = pairs
    .slice()
    .sort((first, second) =>
      (Math.abs(second.other.dispatchEnd - second.run.dispatchEnd) - Math.abs(first.other.dispatchEnd - first.run.dispatchEnd))
      || first.run.jobId.localeCompare(second.run.jobId))[0];
  if (!moved || moved.other.dispatchEnd === moved.run.dispatchEnd) {
    return { stationId: "dispatch", reason: `Under ${scenario.disruption.shortLabel} the candidate dispatches every job in the same slots the board does.`, source: "agent" };
  }
  const job = getJob(scenario, moved.run.jobId);
  return {
    stationId: "dispatch",
    jobId: job.id,
    berthIndex: moved.other.dispatchLane,
    reason: `Two routes for ${job.shortLabel} under ${scenario.disruption.shortLabel}: the board dispatches it in slots ${slotWindow(moved.run.dispatchStart, moved.run.dispatchEnd)}, the candidate in slots ${slotWindow(moved.other.dispatchStart, moved.other.dispatchEnd)}.`,
    source: "agent",
  };
}

/**
 * A staged order, whether the auditor proposed it or the player built it. The move itself is
 * the cause here — no evaluation is read, because what is being explained is the change
 * waiting for a human, not a result that has happened.
 */
export function focusOnProposal(scenario: Scenario, from: Schedule, to: Schedule, source: FocusSource = "agent"): FocusTarget {
  const index = to.findIndex((jobId, position) => from[position] !== jobId);
  const stationId: StationId = index <= 0 ? "prep" : "dispatch";
  if (index < 0) {
    return { stationId: "prep", jobId: to[0], reason: "The staged order is the order already on the board.", source };
  }
  const job = getJob(scenario, to[index]);
  return {
    stationId,
    jobId: job.id,
    reason: `Staged for review: ${job.shortLabel} moves from position ${from.indexOf(job.id) + 1} to position ${index + 1}.`,
    source,
  };
}

/**
 * Files an audit and aims the floor at what that audit was asked. "Where does this plan
 * bind" and "what happens when a berth goes" are different questions with different answers,
 * so they no longer share one focus: the bottleneck reading points at the constraint on the
 * board as it runs now, and the stress reading points at the berth the shift loses.
 */
export function recordAudit(state: GameState, audit: ScheduleAudit, focus: AgentFocus = "simulation"): GameState {
  const activeEvaluation = state.shockApplied ? audit.stress : audit.baseline;
  return {
    ...state,
    lastAudit: audit,
    agentFocus: focus,
    focus: focus === "bottleneck"
      ? focusOnBottleneck(state.scenario, activeEvaluation, state.shockApplied)
      : focusOnShock(state.scenario, audit),
  };
}

/**
 * Files a candidate comparison without touching the board, and aims the floor at the one job
 * the two orders treat differently. The focus used to be left alone here, on the reasoning
 * that a candidate's runs stand somewhere the player is not looking — true of a job picked at
 * random, but not of this one: both orders contain the same four jobs, and this is the job
 * whose live route and ghost route actually diverge, which is the only pair worth drawing at
 * once. The committed schedule, the timeline and the revision are all untouched.
 */
export function recordComparison(state: GameState, schedule: Schedule, audit: ScheduleAudit): GameState {
  const board = auditSchedule(state.scenario, state.schedule);
  return {
    ...state,
    lastComparison: {
      schedule: cloneSchedule(schedule),
      baseSchedule: cloneSchedule(state.schedule),
      revision: state.revision,
      audit,
    },
    agentFocus: "simulation",
    focus: focusOnCandidate(state.scenario, board.stress, audit.stress),
  };
}

/** Whether a filed comparison still describes the plan currently on the board. */
export function comparisonIsCurrent(state: GameState): boolean {
  const comparison = state.lastComparison;
  if (!comparison) return false;
  return comparison.revision === state.revision
    && comparison.baseSchedule.join(",") === state.schedule.join(",")
    && comparison.schedule.join(",") !== state.schedule.join(",");
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
      lastComparison: undefined,
      agentFocus: "incident",
      // The incident points at the berth it took away, from the same builder the
      // stress-test tool uses: the floor shows one cause, whoever revealed it.
      focus: { ...focusOnShock(state.scenario, lastAudit), source: "system" },
    },
  };
}

export function stageSchedule(
  state: GameState,
  schedule: Schedule,
  reason: string,
  expectedRevision: number,
  options: { requireCurrentComparison?: boolean } = {},
): Transition {
  if (state.pendingProposal) return { ok: false, error: { code: "pending_proposal", message: "A plan is already waiting for human review." } };
  if (state.phase !== "planning" && state.phase !== "disrupted") {
    return { ok: false, error: { code: "precondition_failed", message: "A plan can only be staged from the active planning board." } };
  }
  if (expectedRevision !== state.revision) return { ok: false, error: { code: "stale_revision", message: `This plan is stale. The board is now revision ${state.revision}.` } };
  if (reason.trim().length < 3) return { ok: false, error: { code: "invalid_input", message: "Add a short human reason before staging a plan." } };
  const valid = validateSchedule(state.scenario, schedule);
  if (!valid.ok) return valid;
  if (options.requireCurrentComparison) {
    const compared = state.lastComparison;
    if (!comparisonIsCurrent(state) || !compared || compared.schedule.join(",") !== valid.state.join(",")) {
      return {
        ok: false,
        error: {
          code: "precondition_failed",
          message: "Compare this exact order against the current board revision before staging an agent proposal.",
        },
      };
    }
  }
  const next: PendingProposal = {
    kind: "schedule",
    proposalId: `proposal-${state.roundNumber}-${state.revision}`,
    expectedRevision,
    schedule: valid.state,
    baseSchedule: cloneSchedule(state.schedule),
    reason: reason.trim(),
    returnPhase: state.phase,
  };
  return {
    ok: true,
    state: {
      ...state,
      phase: "awaiting_review",
      pendingProposal: next,
      agentFocus: "proposal",
      // Staging moves the timeline, the proposal panel and the floor in one transition, so
      // the ghost strip and the ghost route are always talking about the same job.
      focus: focusOnProposal(state.scenario, state.schedule, next.schedule),
    },
  };
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
  const metrics = evaluateSchedule(state.scenario, proposal.schedule, shiftOptions(state.scenario, state.shockApplied));
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
      lastComparison: undefined,
      agentFocus: proposal.kind === "undo" ? "recovery" : "inspected",
      // What the confirmation did, in the place it did it: the order the human committed,
      // read against the one it replaced.
      focus: {
        stationId: state.shockApplied ? "dispatch" : "prep",
        jobId: proposal.schedule[0],
        reason: proposal.kind === "undo"
          ? `Rolled back to ${formatSchedule(proposal.schedule, state.scenario)} against receipt ${state.activeReceipt?.id ?? "—"}.`
          : `Committed at revision ${revision}: ${getJob(state.scenario, proposal.schedule[0]).shortLabel} now leads the order.`,
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
      focus: {
        ...focusOnProposal(state.scenario, state.schedule, state.activeReceipt.previousSchedule),
        reason: `Rollback staged against receipt ${state.activeReceipt.id}: back to ${formatSchedule(state.activeReceipt.previousSchedule, state.scenario)}. Nothing has moved yet.`,
      },
    },
  };
}

/**
 * The card, derived and not scored by opinion. Every objective names the number that decided
 * it, so a reader can disagree with the grade by checking the board rather than by trusting
 * it. One objective is reported rather than graded: human authority is a property of the
 * design, so counting it toward the grade would be marking the game's own homework.
 */
export function summariseShift(state: GameState, events: ToolEvent[] = []): ShiftResult {
  const { scenario } = state;
  const evaluation = evaluateSchedule(scenario, state.schedule, shiftOptions(scenario, true));
  const critical = criticalJob(scenario);
  const criticalRun = evaluation.jobs.find((run) => run.jobId === critical.id)!;
  const calls = events.filter((event) => event.kind !== "system");
  const reads = calls.filter((event) => event.ok && (event.kind === "read" || event.kind === "simulation"));
  const recoveryReceipts = state.receipts.filter((receipt) => receipt.shockApplied);

  const objectives: ShiftObjective[] = [
    {
      id: "critical-on-time",
      label: `${critical.shortLabel} makes its deadline under the disruption`,
      met: criticalRun.onTime,
      detail: `Clears at slot ${endSlot(criticalRun)} against a slot ${critical.deadline} deadline.`,
      graded: true,
    },
    {
      id: "every-job-on-time",
      label: "No job misses its deadline",
      met: evaluation.metrics.tardyJobs === 0,
      detail: evaluation.metrics.tardyJobs === 0
        ? `All ${evaluation.metrics.completedJobs} jobs land inside their windows.`
        : `${evaluation.metrics.tardyJobs} of ${evaluation.metrics.completedJobs} jobs finish late.`,
      graded: true,
    },
    {
      id: "margin-kept",
      label: `${critical.shortLabel} keeps margin rather than landing on the deadline`,
      met: criticalRun.verdict === "on-time",
      detail: criticalRun.verdict === "on-time"
        ? `${slots(critical.deadline - endSlot(criticalRun))} of slack left against the deadline.`
        : criticalRun.verdict === "at-risk"
          ? "Lands exactly on the deadline, so one more slot of trouble misses it."
          : `Past the deadline by ${slots(criticalRun.tardiness)}.`,
      graded: true,
    },
    {
      id: "auditor-consulted",
      label: "The board was read before it was changed",
      met: reads.length > 0,
      detail: reads.length > 0
        ? `${reads.length} successful read or stress-test call${reads.length === 1 ? "" : "s"} in the trace.`
        : "No read or stress-test call was made on this shift.",
      graded: true,
    },
    {
      id: "recovery-confirmed",
      label: "A recovery was confirmed after the shock landed",
      met: recoveryReceipts.length > 0,
      detail: recoveryReceipts.length > 0
        ? `${recoveryReceipts.length} plan${recoveryReceipts.length === 1 ? "" : "s"} confirmed while the disruption was active.`
        : "The shift was closed on the plan that was already committed.",
      graded: true,
    },
    {
      id: "human-authority",
      label: "No tool call moved the revision",
      met: calls.every((event) => event.revisionAfter === event.revisionBefore),
      detail: `${calls.length} tool call${calls.length === 1 ? "" : "s"} recorded, ${state.receipts.length} human confirmation${state.receipts.length === 1 ? "" : "s"}.`,
      graded: false,
    },
  ];

  const graded = objectives.filter((objective) => objective.graded);
  const met = graded.filter((objective) => objective.met).length;
  const grade: ShiftGrade = met >= graded.length ? "A" : met === graded.length - 1 ? "B" : met === graded.length - 2 ? "C" : "D";
  const summary = [
    `${scenario.title} — shift ${scenario.order} — grade ${grade} (${met}/${graded.length} objectives)`,
    `Order closed: ${formatSchedule(state.schedule, scenario)}`,
    `Under ${scenario.disruption.shortLabel}: ${evaluation.metrics.onTimeJobs}/${evaluation.metrics.completedJobs} on time, makespan ${evaluation.metrics.makespan}, board score ${evaluation.metrics.score}.`,
    `Queue cost: ${slots(evaluation.metrics.totalIntakeWait)} in intake, ${slots(evaluation.metrics.totalWaiting)} waiting for a berth.`,
    `Division of labour: ${calls.length} tool calls (${calls.filter((event) => !event.ok).length} refused), ${state.receipts.length} human confirmations, revision ${state.revision}.`,
    `Lesson: ${scenario.lesson}`,
  ];

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    shiftOrder: scenario.order,
    grade,
    score: evaluation.metrics.score,
    objectivesMet: met,
    objectivesGraded: graded.length,
    finalSchedule: cloneSchedule(state.schedule),
    evaluation,
    objectives,
    activity: {
      revisions: state.revision,
      humanConfirmations: state.receipts.length,
      toolCalls: calls.length,
      toolRefusals: calls.filter((event) => !event.ok).length,
      rollbacksPrepared: calls.filter((event) => event.ok && event.tool === "undo_schedule").length,
      reasonsWritten: state.receipts.filter((receipt) => receipt.reason.trim().length > 0).length,
    },
    lesson: scenario.lesson,
    summary,
  };
}

export function resetRound(state: GameState): GameState {
  return {
    ...createInitialState(state.scenario),
    roundNumber: state.roundNumber + 1,
    // The cards already earned survive a replay. Losing them would make the campaign rail
    // forget shifts the player finished, and the result card is the only place this game
    // reports what was achieved.
    results: state.results,
  };
}

/**
 * Moves the session to another shift. Human-only on purpose: choosing which shift to work is
 * the same class of decision as committing a plan, so no tool reaches it. A shift already
 * closed can be replayed, and the cards earned so far are carried across.
 */
export function startShift(state: GameState, scenario: Scenario): Transition {
  if (state.pendingProposal) {
    return { ok: false, error: { code: "pending_proposal", message: "Review or reject the pending plan before changing shift." } };
  }
  return {
    ok: true,
    state: {
      ...createInitialState(scenario),
      roundNumber: state.roundNumber + 1,
      results: state.results,
    },
  };
}

/**
 * Closes the shift and writes the card. Available only once the shock has landed and a plan
 * has been confirmed under it — closing before that would report a board nobody had to
 * defend. The trace is passed in rather than stored on the state: the card reports how the
 * work was divided, and the tool log is the only honest source for that.
 */
export function closeShift(state: GameState, events: ToolEvent[] = []): Transition {
  if (state.pendingProposal) {
    return { ok: false, error: { code: "pending_proposal", message: "Review or reject the pending plan before closing the shift." } };
  }
  if (state.phase !== "disrupted" || !state.shockApplied) {
    return { ok: false, error: { code: "precondition_failed", message: "A shift can only be closed after the disruption has been met." } };
  }
  if (!state.activeReceipt) {
    return { ok: false, error: { code: "no_active_receipt", message: "Confirm a plan for the disrupted shift before closing it." } };
  }
  const resultCard = summariseShift(state, events);
  return {
    ok: true,
    state: {
      ...state,
      phase: "closed",
      resultCard,
      results: [...state.results, resultCard],
      agentFocus: "recovery",
      focus: {
        stationId: "dispatch",
        jobId: resultCard.finalSchedule[0],
        reason: `Shift closed at revision ${state.revision}: grade ${resultCard.grade}, ${resultCard.objectivesMet} of ${resultCard.objectivesGraded} objectives met.`,
        source: "system",
      },
    },
  };
}

import {
  comparisonIsCurrent,
  getJob,
  type FocusSource,
  type GameState,
  type Job,
  type JobId,
  type JobRun,
  type JobVerdict,
  type ScheduleEvaluation,
  type StationId,
} from "../domain/model.ts";

/**
 * The floor draws the domain's verdict, it does not decide one. The scene used to call
 * a job at risk whenever it had waited for a berth, which put the 3D floor and the
 * timeline legend on two different rules for the same word.
 */
export type SceneJobStatus = JobVerdict;

/**
 * Where a job physically stands on the focus floor. The scene model owns this so
 * the WebGL geometry and the DOM labels place the same job in the same place —
 * neither surface is allowed to invent a position of its own.
 */
export type SceneSite = "prep-a" | "prep-b" | "gate" | "berth-1" | "berth-2" | "queue";

/**
 * Where one job stands in its own run at one slot of the shift. The live floor has no
 * phase — it draws the plan as it ends, where "the berth holds its last tenant" is a
 * summary rather than a moment — so this is only set on a floor read at a slot.
 */
export type SceneJobPhase = "queued" | "prepping" | "waiting" | "dispatching" | "done";

export type SceneJob = {
  id: JobId;
  code: string;
  label: string;
  shortLabel: string;
  tint: Job["tint"];
  priority: Job["priority"];
  queuePosition: number;
  prepStart: number;
  prepEnd: number;
  dispatchStart: number;
  dispatchEnd: number;
  dispatchLane: number;
  waiting: number;
  deadline: number;
  tardiness: number;
  status: SceneJobStatus;
  selected: boolean;
  site: SceneSite;
  /** What the floor calls this job's stand: `Prep 1`, `Berth 02`, `Q1`. */
  tag: string;
  /** Share of this job's own window that the plan already spends, 0..1. */
  meter: number;
  /**
   * Which part of its run the job is in, on a floor read at one slot. Absent on the
   * live floor, because the live floor is the whole plan rather than a moment in it.
   */
  phase?: SceneJobPhase;
};

export type SceneBerth = {
  index: number;
  label: string;
  active: boolean;
  job?: SceneJob;
};

export type SceneStation = {
  id: StationId;
  label: string;
  shortLabel: string;
  capacity: number;
  activeCapacity: number;
  bottleneck: boolean;
  disrupted: boolean;
};

export type SceneModel = {
  revision: number;
  phase: GameState["phase"];
  horizon: number;
  focusedStationId: StationId;
  selectedJobId?: JobId;
  focusSource: FocusSource;
  shockApplied: boolean;
  disruptionLabel: string;
  stations: SceneStation[];
  jobs: SceneJob[];
  ghostJobs: SceneJob[];
  /** The dispatch berths, in floor order, with whatever job stands in each. */
  berths: SceneBerth[];
  /** The job the focus view is built around: the selected one, else the critical one. */
  focusJob?: SceneJob;
  /** Slot the critical deadline falls on, so the floor strip can mark it. */
  deadlineSlot: number;
  causalPath: string[];
  /** Why the plan runs as it does now, as three floor steps. */
  causeRoute: string[];
  /** The same three steps under the staged proposal, when one is staged. */
  ghostRoute?: string[];
  /**
   * Which uncommitted order the ghost floor belongs to, so a surface can name it
   * honestly: a proposal awaiting confirmation reads differently from a candidate
   * the agent merely compared.
   */
  ghostSource?: "proposal" | "comparison";
  auditFinding: string;
  auditSeverity: "clear" | "watch" | "critical";
  /** Whether an audit has actually been recorded for this revision. */
  audited: boolean;
  metrics: {
    makespan: number;
    onTimeJobs: number;
    totalJobs: number;
    totalWaiting: number;
    dispatchIdle: number;
    criticalOnTime: boolean;
  };
  availableActions: string[];
};

type SceneModelOptions = {
  ghostEvaluation?: ScheduleEvaluation;
};

function mapJobs(state: GameState, evaluation: ScheduleEvaluation, selectedJobId?: JobId): SceneJob[] {
  const jobs = evaluation.jobs.map((run, queuePosition) => {
    const job = getJob(state.scenario, run.jobId);
    return {
      id: job.id,
      code: job.code,
      label: job.label,
      shortLabel: job.shortLabel,
      tint: job.tint,
      priority: job.priority,
      queuePosition,
      prepStart: run.prepStart,
      prepEnd: run.prepEnd,
      dispatchStart: run.dispatchStart,
      dispatchEnd: run.dispatchEnd,
      dispatchLane: run.dispatchLane,
      waiting: run.waiting,
      deadline: job.deadline,
      tardiness: run.tardiness,
      status: run.verdict,
      selected: selectedJobId === job.id,
      site: "queue" as SceneSite,
      tag: "",
      // Same reading as the 2.5D board's meter: how much of this job's own
      // window the plan already spends.
      meter: Math.max(0.06, Math.min(1, run.dispatchEnd / Math.max(1, job.deadline))),
    };
  });
  return assignSites(jobs, evaluation);
}

/** One job's stand on the floor, derived from the plan and from nothing else. */
export type FloorPlacement = { jobId: JobId; site: SceneSite; tag: string };

/** The one name a berth has, on the floor and on the timeline alike. */
function berthTag(lane: number) {
  return `Berth ${String(lane + 1).padStart(2, "0")}`;
}

/**
 * Where the plan puts each job on the floor, so that no stand ever shows something
 * the schedule does not support. A berth holds one job — the last tenant of that
 * lane, the one it is still working on when the shift runs out — and only berths
 * that are actually staffed hold anything, so losing a berth removes a slab instead
 * of stacking two jobs onto one. The prep pads read in prep order, because prep is
 * a single sequential lane. Whoever is left has finished prep and is queued for a
 * berth: the next one stands at the transfer gate and the rest are off the floor.
 * The WebGL geometry, the 2.5D bays and the DOM labels all read this one answer, so
 * no surface can invent a position of its own.
 */
export function floorPlacements(evaluation: ScheduleEvaluation): FloorPlacement[] {
  const placed = new Map<JobId, FloorPlacement>();
  const runs = evaluation.jobs;

  for (let lane = 0; lane < evaluation.dispatchParallelism && lane < 2; lane += 1) {
    const held = runs
      .filter((run) => run.dispatchLane === lane)
      .reduce<JobRun | undefined>((last, run) => (!last || run.dispatchStart > last.dispatchStart ? run : last), undefined);
    if (!held) continue;
    placed.set(held.jobId, { jobId: held.jobId, site: lane === 0 ? "berth-1" : "berth-2", tag: berthTag(lane) });
  }

  const ashore = runs.filter((run) => !placed.has(run.jobId)).sort((first, second) => first.prepStart - second.prepStart);
  const pads: SceneSite[] = ["prep-a", "prep-b"];
  ashore.slice(0, pads.length).forEach((run, index) => {
    placed.set(run.jobId, { jobId: run.jobId, site: pads[index]!, tag: `Prep ${index + 1}` });
  });

  ashore.slice(pads.length).sort((first, second) => first.dispatchStart - second.dispatchStart).forEach((run, index) => {
    placed.set(run.jobId, { jobId: run.jobId, site: index === 0 ? "gate" : "queue", tag: `Q${index + 1}` });
  });

  return runs.map((run) => placed.get(run.jobId) ?? { jobId: run.jobId, site: "queue", tag: "Queued" });
}

function assignSites(jobs: SceneJob[], evaluation: ScheduleEvaluation): SceneJob[] {
  const placements = new Map(floorPlacements(evaluation).map((placement) => [placement.jobId, placement]));
  return jobs.map((job) => {
    const placement = placements.get(job.id);
    return { ...job, site: placement?.site ?? "queue", tag: placement?.tag ?? "Queued" };
  });
}

/**
 * Which part of its run a job is in at one slot. A run from clock a to clock b covers
 * slots a+1..b — the same half-open rule the timeline bars are drawn by — so a job is
 * in a stage exactly when the slot falls inside that stage's window.
 */
export function jobPhaseAt(
  run: Pick<SceneJob, "prepStart" | "prepEnd" | "dispatchStart" | "dispatchEnd">,
  slot: number,
): SceneJobPhase {
  if (slot <= run.prepStart) return "queued";
  if (slot <= run.prepEnd) return "prepping";
  if (slot <= run.dispatchStart) return "waiting";
  if (slot <= run.dispatchEnd) return "dispatching";
  return "done";
}

/**
 * Where the plan puts each job at one slot of the shift, as against `floorPlacements`,
 * which answers where they end up. Prep is one sequential lane, so pad 1 is that lane
 * and pad 2 is whoever it takes next; the gate holds the one job nearest its berth and
 * anything queued behind it is off the floor; a berth holds whoever is dispatching in
 * that lane at this slot. Every reading comes from the runs themselves, so a floor read
 * at a slot cannot put a job somewhere the schedule does not.
 */
export function timePlacements(jobs: SceneJob[], slot: number): FloorPlacement[] {
  const placed = new Map<JobId, FloorPlacement>();
  const phases = new Map<JobId, SceneJobPhase>(jobs.map((job) => [job.id, jobPhaseAt(job, slot)]));
  const inPhase = (want: SceneJobPhase) => jobs.filter((job) => phases.get(job.id) === want);

  for (const job of inPhase("dispatching")) {
    const lane = Math.min(Math.max(job.dispatchLane, 0), 1);
    placed.set(job.id, { jobId: job.id, site: lane === 0 ? "berth-1" : "berth-2", tag: berthTag(lane) });
  }
  for (const job of inPhase("prepping")) {
    placed.set(job.id, { jobId: job.id, site: "prep-a", tag: "Prep 1" });
  }
  const next = inPhase("queued").sort((first, second) => first.prepStart - second.prepStart)[0];
  if (next) placed.set(next.id, { jobId: next.id, site: "prep-b", tag: "Prep next" });
  inPhase("waiting")
    .sort((first, second) => first.dispatchStart - second.dispatchStart)
    .forEach((job, index) => {
      placed.set(job.id, { jobId: job.id, site: index === 0 ? "gate" : "queue", tag: `Q${index + 1}` });
    });

  return jobs.map((job) => placed.get(job.id)
    ?? { jobId: job.id, site: "queue", tag: phases.get(job.id) === "done" ? "Cleared" : "Queued" });
}

/**
 * How much of a job's own work the shift has finished by this slot: prep plus dispatch,
 * measured on the clock the bars are drawn on rather than as a share of its deadline,
 * because at a slot the honest reading is work done and not slack left.
 */
function workDone(job: SceneJob, slot: number): number {
  const ran = (from: number, to: number) => Math.min(Math.max(slot - from, 0), Math.max(0, to - from));
  const total = Math.max(1, job.prepEnd - job.prepStart + (job.dispatchEnd - job.dispatchStart));
  return Math.max(0.06, Math.min(1, (ran(job.prepStart, job.prepEnd) + ran(job.dispatchStart, job.dispatchEnd)) / total));
}

/**
 * The same floor read at one slot instead of at the end of the shift. Nothing is
 * re-simulated: the sites, the phases and the meters are all read off the runs the model
 * already carries, so the played-back floor and the live one can only disagree about
 * when a job is somewhere, never about where the plan sends it. Metrics, verdicts and
 * both routes stay the plan's, because those are claims about the whole plan and not
 * about the moment.
 */
export function sceneModelAtSlot(model: SceneModel, slot: number): SceneModel {
  const reseat = (jobs: SceneJob[]): SceneJob[] => {
    const placements = new Map(timePlacements(jobs, slot).map((placement) => [placement.jobId, placement]));
    return jobs.map((job) => ({
      ...job,
      site: placements.get(job.id)?.site ?? "queue",
      tag: placements.get(job.id)?.tag ?? "Queued",
      phase: jobPhaseAt(job, slot),
      meter: workDone(job, slot),
    }));
  };
  const jobs = reseat(model.jobs);
  return {
    ...model,
    jobs,
    ghostJobs: reseat(model.ghostJobs),
    berths: model.berths.map((berth) => ({
      ...berth,
      job: jobs.find((job) => job.site === (berth.index === 0 ? "berth-1" : "berth-2")),
    })),
    focusJob: model.focusJob ? jobs.find((job) => job.id === model.focusJob?.id) : undefined,
  };
}

function focusJobOf(jobs: SceneJob[]): SceneJob | undefined {
  return jobs.find((job) => job.selected) ?? jobs.find((job) => job.priority === "critical") ?? jobs[0];
}

/**
 * The ghost floor's last step, read against what the live floor does to the same
 * job. "STILL LATE" is only honest when the committed plan is late as well, and a
 * candidate that turns an on-time job late has to say that instead of borrowing
 * the same words.
 */
function ghostVerdict(live: SceneJob | undefined, ghost: SceneJob): string {
  if (ghost.status !== "missed") return `${ghost.shortLabel} ON TIME`;
  return `${ghost.shortLabel} ${live?.status === "missed" ? "STILL LATE" : "NOW LATE"}`;
}

export function deriveSceneModel(state: GameState, evaluation: ScheduleEvaluation, options: SceneModelOptions = {}): SceneModel {
  const selectedJobId = state.focus.jobId;
  const focusedStation = state.focus.stationId;
  const activeDispatchCapacity = evaluation.dispatchParallelism;
  const audit = state.lastAudit;
  const activeRun = evaluation.jobs.find((run) => run.jobId === selectedJobId) ?? evaluation.jobs[0];
  const activeJob = activeRun ? getJob(state.scenario, activeRun.jobId) : undefined;
  const causalPath = [
    focusedStation === "prep" ? "PREP QUEUE" : "DISPATCH QUEUE",
    activeJob ? `${activeJob.code} / ${activeJob.shortLabel}` : "ACTIVE JOB",
    activeJob ? `DEADLINE D${activeJob.deadline}` : "DEADLINE RAIL",
  ];

  const jobs = mapJobs(state, evaluation, selectedJobId);
  // A ghost floor is drawn for a staged proposal and for a still-current candidate
  // comparison, and for nothing else: both are orders the human has not committed,
  // and a comparison that no longer matches the board would draw a floor that never
  // existed.
  const ghostJobs = (state.pendingProposal || comparisonIsCurrent(state)) && options.ghostEvaluation
    ? mapJobs(state, options.ghostEvaluation, selectedJobId).map((job) => ({ ...job, selected: false }))
    : [];
  const focusJob = focusJobOf(jobs);
  const ghostFocus = focusJob ? ghostJobs.find((job) => job.id === focusJob.id) : undefined;
  const dispatch = state.scenario.stations.find((station) => station.id === "dispatch");
  const berths: SceneBerth[] = Array.from({ length: dispatch?.parallelism ?? 1 }, (_, index) => ({
    index,
    label: `Berth ${index + 1}`,
    active: index < activeDispatchCapacity,
    job: jobs.find((job) => job.site === (index === 0 ? "berth-1" : "berth-2")),
  }));

  return {
    revision: state.revision,
    phase: state.phase,
    horizon: state.scenario.horizon,
    focusedStationId: focusedStation,
    selectedJobId,
    focusSource: state.focus.source,
    shockApplied: state.shockApplied,
    disruptionLabel: state.scenario.disruption.shortLabel,
    stations: state.scenario.stations.map((station) => ({
      id: station.id,
      label: station.label,
      shortLabel: station.shortLabel,
      capacity: station.parallelism,
      activeCapacity: station.id === "dispatch" ? activeDispatchCapacity : station.parallelism,
      bottleneck: station.id === evaluation.bottleneck,
      disrupted: station.id === "dispatch" && activeDispatchCapacity < station.parallelism,
    })),
    jobs,
    ghostJobs,
    berths,
    focusJob,
    deadlineSlot: focusJob?.deadline ?? state.scenario.horizon,
    causalPath,
    causeRoute: [
      "QUEUE",
      focusJob && focusJob.waiting > 0 ? "BERTH DELAY" : "BERTH",
      focusJob ? `${focusJob.shortLabel} ${focusJob.status === "missed" ? "LATE" : "ON TIME"}` : "DEADLINE",
    ],
    ghostRoute: ghostFocus
      ? ["QUEUE", ghostFocus.waiting > 0 ? "BERTH DELAY" : "BERTH", ghostVerdict(focusJob, ghostFocus)]
      : undefined,
    ghostSource: ghostJobs.length === 0 ? undefined : state.pendingProposal ? "proposal" : "comparison",
    auditFinding: audit?.finding ?? "No audit has been recorded for this revision yet.",
    auditSeverity: audit?.severity ?? "clear",
    audited: audit !== undefined,
    metrics: {
      makespan: evaluation.metrics.makespan,
      onTimeJobs: evaluation.metrics.onTimeJobs,
      totalJobs: evaluation.jobs.length,
      totalWaiting: evaluation.metrics.totalWaiting,
      dispatchIdle: evaluation.metrics.dispatchIdle,
      criticalOnTime: evaluation.metrics.criticalOnTime,
    },
    availableActions: state.pendingProposal
      ? ["review proposal", "confirm (human)", "reject"]
      : state.phase === "planning" || state.phase === "disrupted"
        ? ["inspect", "find bottleneck", "stress-test", "compare", "stage"]
        : state.phase === "applied"
          ? ["reveal disruption", "prepare undo"]
          : ["inspect board"],
  };
}

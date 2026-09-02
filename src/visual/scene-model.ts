import {
  getJob,
  type FocusSource,
  type GameState,
  type Job,
  type JobId,
  type JobRun,
  type ScheduleEvaluation,
  type StationId,
} from "../domain/model.ts";

export type SceneJobStatus = "on-time" | "at-risk" | "missed";

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
  causalPath: string[];
  auditFinding: string;
  auditSeverity: "clear" | "watch" | "critical";
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

function statusFor(run: JobRun, job: Job): SceneJobStatus {
  if (!run.onTime) return "missed";
  if (run.dispatchEnd >= job.deadline - 1 || run.waiting > 0) return "at-risk";
  return "on-time";
}

function mapJobs(state: GameState, evaluation: ScheduleEvaluation, selectedJobId?: JobId): SceneJob[] {
  return evaluation.jobs.map((run, queuePosition) => {
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
      status: statusFor(run, job),
      selected: selectedJobId === job.id,
    };
  });
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
    jobs: mapJobs(state, evaluation, selectedJobId),
    ghostJobs: state.pendingProposal && options.ghostEvaluation
      ? mapJobs(state, options.ghostEvaluation, selectedJobId).map((job) => ({ ...job, selected: false }))
      : [],
    causalPath,
    auditFinding: audit?.finding ?? "No audit has been recorded for this revision yet.",
    auditSeverity: audit?.severity ?? "clear",
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

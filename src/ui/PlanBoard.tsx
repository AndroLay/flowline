import type { CSSProperties } from "react";
import { getJob, type JobId, type Scenario, type Schedule, type ScheduleEvaluation } from "../domain/model.ts";

export type ShiftMode = "normal" | "stress";

type BlockPlacement = { job: Scenario["jobs"][number]; run: ScheduleEvaluation["jobs"][number]; index: number };

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * The shared "LIVE PLAN" surface. The brief page renders it dense as a preview;
 * the arena renders it full size and editable. Both read the same evaluation, so
 * there is only ever one version of the plan on screen.
 */
export function PlanBoard({
  scenario,
  schedule,
  evaluation,
  mode,
  onMode,
  dense = false,
  editable = false,
  selectedJobId,
  onSelectJob,
  onMove,
}: {
  scenario: Scenario;
  schedule: Schedule;
  evaluation: ScheduleEvaluation;
  mode: ShiftMode;
  onMode: (mode: ShiftMode) => void;
  dense?: boolean;
  editable?: boolean;
  selectedJobId?: JobId;
  onSelectJob?: (jobId: JobId) => void;
  onMove?: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <section className={`board${dense ? " board--dense" : ""}`} aria-label="Live plan">
      <header className="board__head">
        <span className="dot-label">
          <i />Live plan — {mode === "stress" ? "shock test" : "normal shift"}
        </span>
        <div className="seg" role="group" aria-label="Shift condition">
          <button type="button" className={mode === "normal" ? "is-on" : ""} aria-pressed={mode === "normal"} onClick={() => onMode("normal")}>Normal</button>
          <button type="button" className={mode === "stress" ? "is-on" : ""} aria-pressed={mode === "stress"} onClick={() => onMode("stress")}>Shock test</button>
        </div>
      </header>
      <div className="queue">
        <span className="micro">Queue order</span>
        <ol className="queue__list">
          {schedule.map((jobId, index) => {
            const job = getJob(scenario, jobId);
            const selected = selectedJobId === job.id;
            return (
              <li className="queue__slot" key={job.id}>
                <span className="queue__n">{index + 1}</span>
                <button
                  type="button"
                  className={`chip chip--${job.tint}${selected ? " is-on" : ""}`}
                  aria-pressed={selected}
                  onClick={() => onSelectJob?.(job.id)}
                  onKeyDown={(event) => {
                    if (!editable || !onMove) return;
                    if (event.key === "ArrowLeft") { event.preventDefault(); onMove(index, -1); }
                    if (event.key === "ArrowRight") { event.preventDefault(); onMove(index, 1); }
                  }}
                >
                  {job.shortLabel}
                </button>
                {editable && onMove && (
                  <span className="queue__move">
                    <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label={`Move ${job.label} earlier in the queue`}>◂</button>
                    <button type="button" disabled={index === schedule.length - 1} onClick={() => onMove(index, 1)} aria-label={`Move ${job.label} later in the queue`}>▸</button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <FloorBays scenario={scenario} schedule={schedule} evaluation={evaluation} dense={dense} selectedJobId={selectedJobId} onSelectJob={onSelectJob} />
      <ScheduleTimeline scenario={scenario} evaluation={evaluation} dense={dense} />
    </section>
  );
}

/** 2.5D read of the same schedule: where each job physically sits on the floor. */
function FloorBays({ scenario, schedule, evaluation, dense, selectedJobId, onSelectJob }: {
  scenario: Scenario;
  schedule: Schedule;
  evaluation: ScheduleEvaluation;
  dense: boolean;
  selectedJobId?: JobId;
  onSelectJob?: (jobId: JobId) => void;
}) {
  const placements: BlockPlacement[] = schedule.map((jobId, index) => ({
    job: getJob(scenario, jobId),
    run: evaluation.jobs.find((run) => run.jobId === jobId)!,
    index,
  }));
  const offline = evaluation.dispatchParallelism < 2;
  return (
    <div className="bays">
      <span className="bays__floor" aria-hidden="true" />
      <Bay
        title="Prep bay"
        detail="one lane / sequential"
        blocks={placements.slice(0, 2)}
        dense={dense}
        selectedJobId={selectedJobId}
        onSelectJob={onSelectJob}
      />
      <span className="bays__handoff" aria-hidden="true">→</span>
      <Bay
        title="Dispatch bay"
        detail={offline ? "one berth / offline" : "two berths / parallel"}
        alert={offline}
        blocks={placements.slice(2)}
        dense={dense}
        selectedJobId={selectedJobId}
        onSelectJob={onSelectJob}
      />
    </div>
  );
}
function Bay({ title, detail, blocks, dense, alert = false, selectedJobId, onSelectJob }: {
  title: string;
  detail: string;
  blocks: BlockPlacement[];
  dense: boolean;
  alert?: boolean;
  selectedJobId?: JobId;
  onSelectJob?: (jobId: JobId) => void;
}) {
  return (
    <section className={`bay${alert ? " bay--alert" : ""}`} aria-label={`${title}, ${detail}`}>
      <header className="bay__head">
        <strong>{title}</strong>
        <small>{detail}</small>
      </header>
      <div className="bay__deck">
        <span className="bay__plate" aria-hidden="true" />
        <div className="bay__blocks">
          {blocks.map(({ job, run, index }) => {
            // The meter reads as "how much of this job's own window is already spent".
            const spent = Math.max(6, Math.min(100, Math.round((run.dispatchEnd / job.deadline) * 100)));
            return (
            <button
              type="button"
              key={job.id}
              className={`slab slab--${job.tint}${run.onTime ? "" : " is-late"}${selectedJobId === job.id ? " is-on" : ""}`}
              aria-pressed={selectedJobId === job.id}
              onClick={() => onSelectJob?.(job.id)}
              style={{ "--lift": index % 2 } as CSSProperties}
            >
              <strong className="slab__name">{job.shortLabel}</strong>
              <span className="slab__tag">{dense ? pad(index + 1) : index < 2 ? `Prep ${index + 1}` : `Out ${run.dispatchLane + 1}`}</span>
              <span className="slab__meter" aria-hidden="true"><i style={{ width: `${spent}%` }} /></span>
              {!run.onTime && <span className="slab__warn" aria-hidden="true">⚠</span>}
              <span className="sr-only">
                {run.onTime ? `finishes slot ${run.dispatchEnd}, on time` : `finishes slot ${run.dispatchEnd}, ${run.tardiness} slots late`}
              </span>
            </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
/**
 * One grid for the whole timeline: column 1 is the lane label, columns 2..n+1 are
 * the slots. The deadline rule is a real grid item on the boundary column, so it
 * can never drift away from the bars it is judging.
 */
export function ScheduleTimeline({ scenario, evaluation, dense = false, ghost = false, legend = true }: {
  scenario: Scenario;
  evaluation: ScheduleEvaluation;
  dense?: boolean;
  ghost?: boolean;
  legend?: boolean;
}) {
  const slots = scenario.horizon;
  const critical = scenario.jobs.find((job) => job.priority === "critical") ?? scenario.jobs[0];
  const criticalRun = evaluation.jobs.find((run) => run.jobId === critical.id);
  const onTime = criticalRun?.onTime ?? true;
  const berths = evaluation.dispatchParallelism;
  const rows = [
    { key: "prep", label: dense ? "Prep" : "Prep lane", stage: "prep" as const, runs: evaluation.jobs },
    ...Array.from({ length: berths }, (_, lane) => ({
      key: `out-${lane}`,
      label: lane === 0 ? (dense ? "Out" : "Dispatch") : dense ? `B${pad(lane + 1)}` : `Berth ${pad(lane + 1)}`,
      stage: "dispatch" as const,
      runs: evaluation.jobs.filter((run) => run.dispatchLane === lane),
    })),
  ];
  const deadlineColumn = Math.min(slots, critical.deadline) + 2;
  return (
    <div className={`tl${dense ? " tl--dense" : ""}${onTime ? " tl--ontime" : " tl--late"}${ghost ? " tl--ghost" : ""}`}>
      <span className="micro">Time line (slots)</span>
      <div
        className="tl__grid"
        style={{ gridTemplateColumns: `var(--tl-label) repeat(${slots}, minmax(0, 1fr))`, "--slots": slots } as CSSProperties}
      >
        {Array.from({ length: slots }, (_, index) => index + 1).map((slot) => (
          <span className={`tl__tick${slot === critical.deadline ? " is-deadline" : ""}`} key={slot} style={{ gridColumn: slot + 1, gridRow: 1 }}>{pad(slot)}</span>
        ))}
        {rows.map((row, rowIndex) => [
          <span className="tl__lane-label" key={`${row.key}-label`} style={{ gridColumn: 1, gridRow: rowIndex + 2 }}>{row.label}</span>,
          <span className="tl__lane" key={`${row.key}-lane`} aria-hidden="true" style={{ gridColumn: `2 / span ${slots}`, gridRow: rowIndex + 2 }} />,
          ...row.runs.map((run) => {
            const job = getJob(scenario, run.jobId);
            const start = row.stage === "prep" ? run.prepStart : run.dispatchStart;
            const end = row.stage === "prep" ? run.prepEnd : run.dispatchEnd;
            const late = row.stage === "dispatch" && !run.onTime;
            return (
              <span
                className={`tl__bar tl__bar--${job.tint}${late ? " is-late" : ""}`}
                key={`${row.key}-${job.id}`}
                style={{ gridColumn: `${start + 2} / span ${Math.max(1, end - start)}`, gridRow: rowIndex + 2 }}
                title={`${job.label}: slots ${start + 1}–${end}${late ? ` · ${run.tardiness} late` : ""}`}
              >
                <b>{job.shortLabel}</b>
                {late && <i aria-hidden="true">⚠</i>}
              </span>
            );
          }),
        ])}
        <span className="tl__rule" aria-hidden="true" style={{ gridColumn: deadlineColumn, gridRow: `1 / span ${rows.length + 1}` }} />
        <span className="tl__caption" style={{ gridColumn: deadlineColumn, gridRow: rows.length + 2 }}>
          <b>{onTime ? "On time" : "Deadline"}</b>
          <small>{critical.code} • D{critical.deadline}</small>
        </span>
      </div>
      {legend && <Legend scenario={scenario} />}
    </div>
  );
}

function Legend({ scenario }: { scenario: Scenario }) {
  return (
    <div className="legend">
      {scenario.jobs.map((job) => (
        <span key={job.id}><i className={`sw sw--${job.tint}`} />{job.shortLabel}</span>
      ))}
      <span className="legend__spacer" aria-hidden="true" />
      <span><i className="sw sw--ontime" />On time</span>
      <span><i className="sw sw--risk" />At risk</span>
      <span><i className="sw sw--late" />Late</span>
    </div>
  );
}

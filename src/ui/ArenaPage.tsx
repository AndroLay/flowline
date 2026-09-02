import { useState } from "react";
import { evaluateSchedule, formatSchedule, type AgentFocus, type GameState, type JobId, type ScheduleAudit, type ScheduleEvaluation, type ToolEvent } from "../domain/model.ts";
import type { RegistrationSnapshot } from "../tools/webmcp.ts";
import { PlanBoard, ScheduleTimeline, type ShiftMode } from "./PlanBoard.tsx";

const FOCUS_LABEL: Record<AgentFocus, string> = {
  idle: "Waiting",
  inspected: "Board read",
  bottleneck: "Bottleneck found",
  simulation: "Stress test ready",
  proposal: "Proposal staged",
  incident: "Incident active",
  recovery: "Recovery mode",
};

export type ArenaProps = {
  state: GameState;
  evaluation: ScheduleEvaluation;
  audit: ScheduleAudit;
  ghost?: ScheduleEvaluation;
  registration: RegistrationSnapshot;
  events: ToolEvent[];
  mode: ShiftMode;
  onMode: (mode: ShiftMode) => void;
  selectedJobId: JobId;
  onSelectJob: (jobId: JobId) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onInspect: () => void;
  onSimulate: () => void;
  onFindBottleneck: () => void;
  onCompare: () => void;
  onStageProposal: () => void;
  onStage: () => void;
  onUndo: () => void;
  onDisruption: () => void;
  onRestart: () => void;
  onReasonChange: (reason: string) => void;
  onPendingReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onReject: () => void;
  onOpenFocus: () => void;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}
export function ArenaPage(props: ArenaProps) {
  const { state, evaluation, ghost } = props;
  return (
    <div className="arena" id="arena">
      <ObjectiveRail {...props} />
      <div className="arena__center">
        <PlanBoard
          editable={state.phase === "planning" || state.phase === "disrupted"}
          scenario={state.scenario}
          schedule={state.schedule}
          evaluation={evaluation}
          mode={props.mode}
          onMode={props.onMode}
          selectedJobId={props.selectedJobId}
          onSelectJob={props.onSelectJob}
          onMove={props.onMove}
        />
        <button className="focus-open" type="button" onClick={props.onOpenFocus}>
          Open 3D station view<span aria-hidden="true">↗</span>
        </button>
        <section className="ghost" aria-labelledby="ghost-title" aria-live="polite">
          <header className="ghost__head">
            <h2 id="ghost-title" className="micro micro--mint">Agent counterfactual — if we reorder</h2>
            <span className="tag">◂ Ghost plan (not applied)</span>
          </header>
          {ghost
            ? <ScheduleTimeline scenario={state.scenario} evaluation={ghost} ghost dense legend={false} />
            : <p className="ghost__empty">Run <b>stress-test</b> and <b>compare plan</b>. The auditor's alternative appears here without touching your committed order.</p>}
        </section>
      </div>
      <AgentRail {...props} />
    </div>
  );
}
function ObjectiveRail({ state, evaluation }: ArenaProps) {
  const [hint, setHint] = useState(false);
  const critical = state.scenario.jobs.find((job) => job.priority === "critical") ?? state.scenario.jobs[0];
  const run = evaluation.jobs.find((item) => item.jobId === critical.id);
  const late = run ? !run.onTime : false;
  return (
    <aside className="rail rail--objective">
      <section className="panel">
        <header className="panel__kicker"><span className="micro">Scenario</span><b>01</b></header>
        <h2 className="panel__title">{state.scenario.title}</h2>
        <p>One shared schedule, read from two angles.</p>
      </section>

      <section className="panel">
        <span className="micro micro--mint">Objective</span>
        <h2 className="panel__display">Make the<br /><em>shift hold.</em></h2>
        <p>Build the order, let the auditor expose the weak point, and decide what is worth protecting.</p>
        <button
          className="btn btn--ghost btn--block"
          type="button"
          onClick={() => document.querySelector<HTMLElement>(".queue__list button")?.focus()}
        >
          Enter the operations floor<span aria-hidden="true">→</span>
        </button>
      </section>

      <section className="panel">
        <span className="micro micro--mint">Critical job</span>
        <div className="critical__head">
          <h2 className="panel__display panel__display--coral">{critical.shortLabel}</h2>
          <span className="tag">Out: {critical.dispatchDuration}</span>
        </div>
        <p>Last dispatch of the shift.<br />Missing the deadline voids the shift.</p>
        <div className={`deadline-box${late ? " is-late" : ""}`}>
          <span className="micro">Deadline</span>
          <strong>{critical.code} • D{critical.deadline}</strong>
          <b>{run ? `Slot ${pad(run.dispatchEnd)}` : "—"}</b>
        </div>
      </section>

      <section className="panel">
        <span className="micro micro--mint">Learning check</span>
        <h2 className="panel__ask">Can you explain why the best normal plan breaks?</h2>
        <button className="btn btn--ghost btn--block" type="button" aria-expanded={hint} onClick={() => setHint((open) => !open)}>
          {hint ? "Hide hint" : "Reveal hint"}
          <svg className="btn__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 17h6M10 20.5h4" />
            <path d="M12 3.5a5.5 5.5 0 0 1 3.3 9.9V17H8.7v-3.6A5.5 5.5 0 0 1 12 3.5Z" />
          </svg>
        </button>
        {hint && <p className="hint">Parallel berths hide the queue. When one goes offline the same order makes the critical job wait too long.</p>}
      </section>
    </aside>
  );
}
function AgentRail(props: ArenaProps) {
  const { state, audit, registration, events } = props;
  const blocked = state.phase === "awaiting_review" || state.phase === "applied";
  const critical = state.scenario.jobs.find((job) => job.priority === "critical") ?? state.scenario.jobs[0];
  const stressRun = audit.stress.jobs.find((run) => run.jobId === critical.id);
  const robust = evaluateSchedule(state.scenario, state.scenario.robustSchedule, { dispatchParallelism: state.scenario.disruption.dispatchParallelism });
  const robustRun = robust.jobs.find((run) => run.jobId === critical.id);
  const canStage = (state.phase === "planning" || state.phase === "disrupted") && state.playerReason.trim().length >= 3 && !state.pendingProposal;
  const canUndo = Boolean(state.activeReceipt?.action === "applied" && (state.phase === "applied" || state.phase === "disrupted") && !state.pendingProposal);
  const steps = [
    { n: 1, title: "Inspect", copy: "Read the board.", done: state.agentFocus !== "idle", run: props.onInspect, off: false },
    { n: 2, title: "Stress-test", copy: "Find where it breaks.", done: ["bottleneck", "simulation", "proposal", "incident", "recovery"].includes(state.agentFocus), run: props.onSimulate, off: blocked },
    { n: 3, title: "Propose", copy: "Suggest a fix.", done: Boolean(state.pendingProposal) || state.agentFocus === "proposal", run: props.onStageProposal, off: !canStage },
  ];
  return (
    <aside className="rail rail--agent">
      <section className="panel" aria-labelledby="auditor-title">
        <header className="panel__kicker">
          <span className="dot-label" id="auditor-title"><i />Operations auditor</span>
          <span className="dot-label dot-label--mint"><i />{registration.phase === "registered" ? "Native" : "Ready"}</span>
        </header>
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.n}>
              <button type="button" className={`step${step.done ? " is-done" : ""}`} disabled={step.off} onClick={step.run}>
                <span className="step__n">{step.n}</span>
                <span className="step__copy"><strong>{step.title}</strong><small>{step.copy}</small></span>
                <span className="step__tick" aria-hidden="true">{step.done ? "✓" : ""}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="finding" aria-live="polite">
          <span className="micro micro--coral">Why this plan breaks</span>
          <p>{audit.finding}</p>
        </div>
        <div className="evidence">
          <header><span className="micro micro--coral">Evidence — {critical.shortLabel}</span><b>Out {(stressRun?.dispatchLane ?? 0) + 1}</b></header>
          <dl>
            <div><dt>Earliest start</dt><dd>Slot {pad((stressRun?.dispatchStart ?? 0) + 1)}</dd></div>
            <div><dt>Deadline</dt><dd>Slot {pad(critical.deadline)}</dd></div>
            <div><dt>Result</dt><dd className={stressRun?.onTime ? "is-safe" : "is-miss"}>{stressRun?.onTime ? "On time" : "Miss"}</dd></div>
          </dl>
        </div>
        <div className="proposed">
          <span className="micro micro--mint">Proposed change</span>
          <p>Reorder to: {formatSchedule(state.scenario.robustSchedule, state.scenario)}</p>
          <strong>{critical.shortLabel} completes by slot {pad(robustRun?.dispatchEnd ?? 0)}. {robustRun?.onTime ? "On time." : "Still at risk."}</strong>
        </div>
      </section>

      <details className="tools">
        <summary>
          <span className="micro">Agent tools</span>
          <b>{registration.complete ? "6 / 6 native" : registration.available ? `${registration.registered.length} registered` : "Local guide"}</b>
        </summary>
        <div className="tools__row">
          <button type="button" disabled={blocked} onClick={props.onFindBottleneck}>Find bottleneck</button>
          <button type="button" disabled={blocked} onClick={props.onCompare}>Compare plan</button>
          <button type="button" disabled={!canUndo} onClick={props.onUndo}>Prepare undo</button>
        </div>
        <p className="tools__note">{registration.note}</p>
        <ul className="tools__log">
          {events.length === 0
            ? <li className="is-empty">No tool call yet. {FOCUS_LABEL[state.agentFocus]}.</li>
            : events.slice().reverse().map((event) => <li key={event.id}><b>{event.tool}</b>{event.summary}</li>)}
        </ul>
      </details>

      <DecisionGate {...props} />
    </aside>
  );
}
function PersonIcon() {
  return (
    <svg className="btn__icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

/**
 * The only place a schedule can actually change. Every phase keeps the same shape
 * — one claim, one human reason, one confirming button — so the boundary never
 * moves around on the player.
 */
function DecisionGate({ state, onStage, onConfirm, onReject, onDisruption, onRestart, onUndo, onReasonChange, onPendingReasonChange }: ArenaProps) {
  const pending = state.pendingProposal;
  const canUndo = Boolean(state.activeReceipt?.action === "applied" && (state.phase === "applied" || state.phase === "disrupted") && !pending);
  const recovered = state.phase === "disrupted" && state.activeReceipt?.shockApplied === true;
  const reason = pending ? pending.reason : state.playerReason;
  const needsReason = Boolean(pending) || state.phase === "planning" || (state.phase === "disrupted" && !recovered);
  const ready = reason.trim().length >= 3;

  const primary = pending
    ? { label: pending.kind === "undo" ? "Confirm rollback" : "Confirm change", run: onConfirm, ready }
    : state.phase === "planning"
      ? { label: "Review the plan", run: onStage, ready }
      : state.phase === "applied"
        ? { label: "Start the shift", run: onDisruption, ready: true }
        : recovered
          ? { label: "Play another shift", run: onRestart, ready: true }
          : { label: "Review recovery", run: onStage, ready };

  const copy = pending
    ? pending.kind === "undo"
      ? "The auditor prepared a return to the previous order. The board has not changed yet."
      : `The auditor staged ${formatSchedule(pending.schedule, state.scenario)}. Nothing moves until you confirm.`
    : state.phase === "applied"
      ? "Your plan is committed for the normal shift. Reveal the operating shock."
      : recovered
        ? "The revised order is on the floor. Compare the consequence, then run another shift."
        : "Only you can confirm the change.";

  return (
    <section className="gate" aria-labelledby="gate-title">
      <h2 id="gate-title">Human confirmation required</h2>
      <p className="gate__copy">{copy}</p>
      {needsReason && (
        <label className="gate__reason">
          <span className="micro">{pending ? "Human reason — editable before commit" : "Why does this order fit the shift?"}</span>
          <textarea
            value={reason}
            maxLength={280}
            rows={2}
            placeholder={state.phase === "disrupted" ? "I moved the critical job earlier because…" : "I chose this order because…"}
            onChange={(event) => (pending ? onPendingReasonChange : onReasonChange)(event.target.value)}
          />
        </label>
      )}
      <button className="btn btn--coral btn--block btn--lg" type="button" disabled={!primary.ready} onClick={primary.run}>
        {primary.label}<PersonIcon />
      </button>
      <div className="gate__aside">
        {pending && <button className="link-quiet" type="button" onClick={onReject}>Reject and keep planning</button>}
        {!pending && canUndo && <button className="link-quiet" type="button" onClick={onUndo}>Prepare exact undo</button>}
        {state.activeReceipt && <span className="gate__receipt">{state.activeReceipt.id}</span>}
      </div>
      <small className="gate__note">This decision cannot be automated.</small>
    </section>
  );
}

import { useState } from "react";
import { comparisonIsCurrent, criticalJob, endSlot, formatSchedule, startSlot, type AgentFocus, type GameState, type JobId, type PlanRecommendation, type Scenario, type ScheduleAudit, type ScheduleEvaluation, type ShiftResult, type ToolEvent } from "../domain/model.ts";
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
  /** The auditor's own candidate, searched from the board. Absent once the board is the best plan. */
  recommendation?: PlanRecommendation;
  registration: RegistrationSnapshot;
  events: ToolEvent[];
  mode: ShiftMode;
  onMode: (mode: ShiftMode) => void;
  selectedJobId: JobId;
  onSelectJob: (jobId: JobId) => void;
  onReorder: (from: number, to: number) => void;
  onInspect: () => void;
  onSimulate: () => void;
  onFindBottleneck: () => void;
  onCompare: () => void;
  onStageProposal: () => void;
  onStage: () => void;
  onUndo: () => void;
  onDisruption: () => void;
  onRestart: () => void;
  /** The campaign, in play order. Choosing one is human-only, like confirming a plan. */
  shifts: readonly Scenario[];
  onStartShift: (scenario: Scenario) => void;
  onCloseShift: () => void;
  onReviewShift: () => void;
  onReasonChange: (reason: string) => void;
  onPendingReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onReject: () => void;
  onOpenFocus: () => void;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

type TraceChip = { text: string; wrap?: boolean };

/**
 * The trace panel is the page's evidence that the boundary held, so it reads the
 * event's own recorded fields and re-derives nothing: whether the call was refused and
 * why, whether the committed revision moved, where it moved the focus, and a reduced
 * form of the arguments. A refused call is shown, not hidden — the log would otherwise
 * describe a clean run of tools that never landed.
 */
function traceMeta(event: ToolEvent): TraceChip[] {
  const chips: TraceChip[] = [{ text: event.ok ? "ok" : `refused: ${event.code ?? "error"}` }];
  chips.push({
    text: event.revisionAfter === event.revisionBefore
      ? `rev ${pad(event.revisionBefore)} held`
      : `rev ${pad(event.revisionBefore)} → ${pad(event.revisionAfter)}`,
  });
  // The berth is in the chip when the call named one: "focus dispatch" is true of the
  // bottleneck reading and of the shock alike, and the berth number is the part that
  // tells the trace which of the two moved the floor.
  if (event.focus) {
    const berth = event.focus.berthIndex === undefined ? "" : ` / berth ${event.focus.berthIndex + 1}`;
    chips.push({ text: `focus ${event.focus.stationId}${event.focus.jobId ? ` / ${event.focus.jobId}` : ""}${berth}` });
  }
  // The reduced arguments are the one chip that can run long, so it is given its own
  // line and allowed to wrap: an off-schema key hidden behind an ellipsis is not
  // evidence of anything.
  if (event.input) chips.push({ text: event.input, wrap: true });
  // Only the proposal, which the call produced. A receipt ID arrived as an argument and
  // is already in the reduced input, so printing it twice would just pad the row.
  if (event.proposalId) chips.push({ text: event.proposalId });
  return chips;
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
          onReorder={props.onReorder}
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
function ObjectiveRail(props: ArenaProps) {
  const { state, evaluation } = props;
  const [hint, setHint] = useState(false);
  const critical = criticalJob(state.scenario);
  const run = evaluation.jobs.find((item) => item.jobId === critical.id);
  const late = run ? !run.onTime : false;
  return (
    <aside className="rail rail--objective">
      <section className="panel">
        <header className="panel__kicker"><span className="micro">Scenario</span><b>{pad(state.scenario.order)}</b></header>
        <h2 className="panel__title">{state.scenario.title}</h2>
        <p>One shared schedule, read from two angles.</p>
      </section>

      <section className="panel">
        <span className="micro micro--mint">Objective</span>
        <h2 className="panel__display"><span>Make the</span><em>shift hold.</em></h2>
        <p>{state.scenario.objective}</p>
        {/* Named for what it does. It moves the keyboard into the first job of the queue,
            which is where a shift is actually built, and it is not a second door into a
            page the player is already standing on. */}
        <button
          className="btn btn--ghost btn--block"
          type="button"
          onClick={() => document.querySelector<HTMLElement>(".queue__list button")?.focus()}
        >
          Start with the queue order<span aria-hidden="true">→</span>
        </button>
      </section>

      <section className="panel">
        <span className="micro micro--mint">Critical job</span>
        <div className="critical__head">
          <h2 className="panel__display panel__display--coral">{critical.shortLabel}</h2>
          {/* "Out: 3" read as a berth number beside a berth-numbered board. It is a
              duration, so it says so. */}
          <span className="tag">Dispatch {critical.dispatchDuration} slots</span>
        </div>
        <p>{critical.description} Missing the deadline voids the shift.</p>
        {/* A shift can hold its critical job in intake for the first slots of the clock.
            That is a constraint on the plan, not a detail, so it is stated where the
            deadline is. */}
        {critical.releaseAt > 0 && <p className="hint">Arrives in intake at slot {pad(critical.releaseAt + 1)} — nothing can prepare it before then.</p>}
        <div className={`deadline-box${late ? " is-late" : ""}`}>
          <span className="micro">Deadline</span>
          <strong>{critical.code} • D{critical.deadline}</strong>
          <b>{run ? `Slot ${pad(endSlot(run))}` : "—"}</b>
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
        {hint && <p className="hint">{state.scenario.lesson}</p>}
      </section>

      <CampaignRail {...props} />
    </aside>
  );
}

/**
 * The campaign, and the one thing it is for: a player who has closed a shift can see there is
 * another one, and what they got for the last. Every button here is a human's — `list_shifts`
 * lets an agent read this exact rail and says so, but choosing what to work is not a tool call.
 * The grade shown is the best card earned on that shift, so replaying cannot lower it.
 */
function CampaignRail({ state, shifts, onStartShift, onReviewShift }: ArenaProps) {
  const ordered = [...shifts].sort((a, b) => a.order - b.order);
  const best = (id: string) => state.results
    .filter((result) => result.scenarioId === id)
    .reduce<ShiftResult | undefined>((top, result) => (!top || result.score > top.score ? result : top), undefined);
  return (
    <section className="panel campaign">
      <header className="panel__kicker">
        <span className="micro">Campaign</span>
        <b>{state.results.length} / {ordered.length}</b>
      </header>
      <ul className="campaign__list">
        {ordered.map((shift) => {
          const card = best(shift.id);
          const current = shift.id === state.scenario.id;
          return (
            <li key={shift.id} className={current ? "is-current" : card ? "is-done" : ""}>
              <b>{pad(shift.order)}</b>
              <span>
                <strong>{shift.title}</strong>
                <small>{card ? `Grade ${card.grade} · ${card.objectivesMet}/${card.objectivesGraded} objectives` : current ? "In progress" : `${shift.jobs.length} jobs · ${shift.disruption.shortLabel}`}</small>
              </span>
              {current
                ? <em aria-label="Current shift">●</em>
                : <button type="button" onClick={() => onStartShift(shift)}>{card ? "Again" : "Start"}</button>}
            </li>
          );
        })}
      </ul>
      {state.resultCard && (
        <button className="btn btn--ghost btn--block" type="button" onClick={onReviewShift}>
          See the result card<span aria-hidden="true">↗</span>
        </button>
      )}
    </section>
  );
}
function AgentRail(props: ArenaProps) {
  const { state, audit, recommendation, registration, events } = props;
  const blocked = state.phase === "awaiting_review" || state.phase === "applied";
  const critical = criticalJob(state.scenario);
  const stressRun = audit.stress.jobs.find((run) => run.jobId === critical.id);
  const proposedRun = recommendation?.audit.stress.jobs.find((run) => run.jobId === critical.id);
  // The agent's proposal button is enabled only after the exact candidate has been
  // compared at the current revision. The human review gate below has its own reason
  // requirement and remains available for a player-authored order.
  const canStage = (state.phase === "planning" || state.phase === "disrupted") && !state.pendingProposal && Boolean(recommendation) && comparisonIsCurrent(state);
  const canUndo = Boolean(state.activeReceipt?.action === "applied" && (state.phase === "applied" || state.phase === "disrupted") && !state.pendingProposal);
  const steps = [
    { n: 1, title: "Inspect", copy: "Read the board.", done: state.agentFocus !== "idle", run: props.onInspect, off: false },
    { n: 2, title: "Stress-test", copy: "Find where it breaks.", done: ["bottleneck", "simulation", "proposal", "incident", "recovery"].includes(state.agentFocus), run: props.onSimulate, off: blocked },
    { n: 3, title: "Propose", copy: "Suggest a fix.", done: Boolean(state.pendingProposal) || state.agentFocus === "proposal", run: props.onStageProposal, off: !canStage || !recommendation },
  ];
  return (
    <aside className="rail rail--agent">
      {/* The gate leads this column. Measured at 1440x900 it used to sit last, which put
          its confirming button at y=954 in a 900px viewport — the one control the whole
          design is about, and it was the one thing you had to scroll to find. The auditor's
          case for the change reads underneath it: the claim first, the evidence after. */}
      <DecisionGate {...props} />

      <section className="panel" aria-labelledby="auditor-title">
        <header className="panel__kicker">
          <span className="dot-label" id="auditor-title"><i />Operations auditor</span>
          <span className={`dot-label ${registration.phase === "registered" ? "dot-label--mint" : ""}`}><i />{registration.phase === "registered" ? (registration.provenance === "test-double" ? "Scripted" : "Registered") : registration.phase === "registering" ? "Registering" : registration.phase === "partial" ? "Partial" : "Local guide"}</span>
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
        {/* The heading follows the audit, not the demo: a board that holds is not
            introduced as one that breaks, or the panel would be arguing with its own
            sentence. */}
        <div className="finding" aria-live="polite">
          <span className={`micro ${audit.severity === "clear" ? "micro--mint" : "micro--coral"}`}>
            {audit.severity === "clear" ? "What the audit found" : "Why this plan breaks"}
          </span>
          <p>{audit.finding}</p>
        </div>
        <div className={`evidence${stressRun?.onTime ? " is-clear" : ""}`}>
          <header><span className={`micro ${stressRun?.onTime ? "micro--mint" : "micro--coral"}`}>Evidence — {critical.shortLabel}</span><b>Berth {pad((stressRun?.dispatchLane ?? 0) + 1)}</b></header>
          <dl>
            <div><dt>Earliest start</dt><dd>Slot {pad(stressRun ? startSlot(stressRun) : 0)}</dd></div>
            <div><dt>Deadline</dt><dd>Slot {pad(critical.deadline)}</dd></div>
            <div><dt>Result</dt><dd className={stressRun?.onTime ? "is-safe" : "is-miss"}>{stressRun?.onTime ? "On time" : "Miss"}</dd></div>
          </dl>
        </div>
        {/* The candidate the auditor searched for, and why it won — never the scenario's
            worked example. Before the auditor has read the board there is nothing to show,
            and once the board is the best order there is nothing left to propose: both are
            said in words rather than filled with a plan the page already knows. */}
        <div className="proposed">
          <span className="micro micro--mint">Proposed change</span>
          {state.agentFocus === "idle"
            ? <p>Nothing proposed yet. Run <b>Inspect</b>: the auditor searches the orders this board allows and brings back the one that survives the shift.</p>
            : !recommendation
              ? <strong>No change proposed. This order already clears {critical.shortLabel} inside its slot {critical.deadline} deadline with a berth offline.</strong>
              : (
                <>
                  <p>Reorder to: {formatSchedule(recommendation.schedule, state.scenario)}</p>
                  <strong>{critical.shortLabel} completes by slot {pad(proposedRun ? endSlot(proposedRun) : 0)}. {proposedRun?.onTime ? "On time." : "Still at risk."}</strong>
                  <p className="proposed__why">{recommendation.reason}</p>
                </>
              )}
        </div>
      </section>

      <details className="tools">
        <summary>
          <span className="micro">Agent tools</span>
          {/* Counted from what the runtime reported, never from a number typed here: the
              catalogue is built per shift, and a hardcoded total was already wrong once. */}
          <b>{registration.available ? `${registration.registered.length} / ${registration.registered.length + registration.failed.length} registered` : "Local guide"}</b>
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
            : events.slice().reverse().map((event) => (
              <li key={event.id} className={event.ok ? undefined : "is-refused"}>
                <b>{event.tool}</b>
                <span className="tools__log-body">
                  {event.summary}
                  <span className="tools__log-meta">
                    {traceMeta(event).map((chip) => <i key={chip.text} className={chip.wrap ? "is-wrap" : undefined}>{chip.text}</i>)}
                  </span>
                </span>
              </li>
            ))}
        </ul>
      </details>
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
function DecisionGate({ state, onStage, onConfirm, onReject, onDisruption, onRestart, onCloseShift, onReviewShift, onUndo, onReasonChange, onPendingReasonChange }: ArenaProps) {
  const pending = state.pendingProposal;
  const canUndo = Boolean(state.activeReceipt?.action === "applied" && (state.phase === "applied" || state.phase === "disrupted") && !pending);
  const recovered = state.phase === "disrupted" && state.activeReceipt?.shockApplied === true;
  const closed = state.phase === "closed";
  const reason = pending ? pending.reason : state.playerReason;
  const needsReason = Boolean(pending) || state.phase === "planning" || (state.phase === "disrupted" && !recovered);
  const ready = reason.trim().length >= 3;

  // Closing the shift is the last decision of the round and it belongs here, with the other
  // one a tool cannot make. `review_shift` can read the card afterwards; nothing can write it.
  const primary = pending
    ? { label: pending.kind === "undo" ? "Confirm rollback" : "Confirm change", run: onConfirm, ready }
    : closed
      ? { label: "See the result card", run: onReviewShift, ready: true }
      : state.phase === "planning"
        ? { label: "Review the plan", run: onStage, ready }
        : state.phase === "applied"
          ? { label: "Start the shift", run: onDisruption, ready: true }
          : recovered
            ? { label: "Close the shift", run: onCloseShift, ready: true }
            : { label: "Review recovery", run: onStage, ready };

  // The page does not claim to know who chose a staged plan: the player's own "review"
  // button and the auditor's step 3 both arrive as the same tool call, so the copy states
  // what is waiting rather than crediting whichever side the demo would rather name.
  const copy = pending
    ? pending.kind === "undo"
      ? "A return to the previous order is prepared. The board has not changed yet."
      : `Staged for review: ${formatSchedule(pending.schedule, state.scenario)}. Nothing moves until you confirm.`
    : closed
      ? "This shift is closed and its card is written. Read it, then pick the next shift."
      : state.phase === "applied"
        ? "Your plan is committed for the normal shift. Reveal the operating shock."
        : recovered
          ? "The revised order is on the floor. Close the shift to see what the plan achieved."
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
        {closed && <button className="link-quiet" type="button" onClick={onRestart}>Replay this shift</button>}
        {state.activeReceipt && <span className="gate__receipt">{state.activeReceipt.id}</span>}
      </div>
      <small className="gate__note">This decision cannot be automated.</small>
    </section>
  );
}

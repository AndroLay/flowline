import { useEffect, useRef, useState } from "react";
import { dispatchBerths, formatSchedule, slots, type Scenario, type ShiftResult } from "../domain/model.ts";

export function BootScreen({ progress, onSkip }: { progress: number; onSkip: () => void }) {
  const step = progress < 38 ? "Mapping the floor" : progress < 76 ? "Warming the auditor" : "Opening the shift";
  return (
    <main className="boot" aria-labelledby="boot-title">
      <p className="micro">Initializing shared floor</p>
      <h1 id="boot-title" className="wordmark wordmark--lg">Flow<span>line</span></h1>
      <div className="boot__status">
        <span className="dot-label"><i />{step}</span>
        <b>{String(progress).padStart(3, "0")}%</b>
      </div>
      <div className="boot__bar" role="progressbar" aria-label="Loading Flowline" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="boot__checks">
        <span className={progress >= 25 ? "is-ready" : ""}>01 / scenario</span>
        <span className={progress >= 55 ? "is-ready" : ""}>02 / timeline</span>
        <span className={progress >= 85 ? "is-ready" : ""}>03 / agent bridge</span>
      </div>
      <button className="link-quiet" type="button" onClick={onSkip}>Skip intro <span aria-hidden="true">↗</span></button>
    </main>
  );
}

export function Notice({ tone, text, onDismiss }: { tone: "success" | "error" | "info"; text: string; onDismiss: () => void }) {
  return (
    <div className={`notice notice--${tone}`} role="status">
      <i aria-hidden="true">{tone === "success" ? "✓" : tone === "error" ? "!" : "·"}</i>
      <span>{text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss message">×</button>
    </div>
  );
}
/**
 * Everything a dialog on this page owes a keyboard: Escape closes it, Tab cycles inside it,
 * the page behind it stops scrolling, and focus goes back where it came from. Two dialogs
 * need all four, and a second hand-written copy is how one of them would end up with three.
 */
function useDialogShell(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const restoreTarget = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreTarget instanceof HTMLElement) restoreTarget.focus();
    };
  }, [onClose]);
  return { dialogRef, closeRef };
}

/**
 * The four moves of a shift, in the shift's own numbers: how many jobs are on this floor, and
 * what actually goes wrong in it. The guide used to say "four cards" and "one berth goes
 * offline" on every shift, which was wrong the moment a second shift existed.
 */
function guideSteps(scenario: Scenario): [string, string, string][] {
  const berthsLost = dispatchBerths(scenario) - scenario.disruption.dispatchParallelism;
  const shock = berthsLost > 0
    ? `${berthsLost === 1 ? "A berth" : `${berthsLost} berths`} ${berthsLost === 1 ? "goes" : "go"} offline.`
    : `${scenario.disruption.shortLabel}.`;
  return [
    ["01", "Order the jobs", `Move the ${scenario.jobs.length} cards into a sequence. Preparation feeds the dispatch berths, and a job cannot start before it arrives.`],
    ["02", "Ask the auditor", "Inspect the revision, find the bottleneck, and run the deterministic disruption test."],
    ["03", "Commit the plan", "Stage the schedule, edit your reason, then use the human-only confirmation button."],
    ["04", "Recover and close", `${shock} See what breaks, replan, use exact undo to revisit — then close the shift for your card.`],
  ];
}

export function GuideModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const { dialogRef, closeRef } = useDialogShell(onClose);
  return (
    <div className="modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal__panel" role="dialog" aria-modal="true" aria-labelledby="guide-title" ref={dialogRef}>
        <header className="modal__head">
          <div>
            <span className="micro micro--mint">Flowline field guide</span>
            <h2 id="guide-title">Run the shift. Learn where the slack sits.</h2>
          </div>
          <button className="modal__close" type="button" onClick={onClose} ref={closeRef} aria-label="Close guide">×</button>
        </header>
        <p className="modal__lede">
          You are the planner. The page-aware agent is your operations auditor. The goal is not a perfect answer — it is a
          schedule you can explain when the floor changes.
        </p>
        <ol className="modal__steps">
          {guideSteps(scenario).map(([number, title, copy]) => (
            <li key={number}><span>{number}</span><div><strong>{title}</strong><p>{copy}</p></div></li>
          ))}
        </ol>
        <div className="modal__cols">
          <div>
            <span className="micro">Operating rules</span>
            <ol className="modal__rules">
              {scenario.constraints.map((rule, index) => <li key={rule}><b>{String(index + 1).padStart(2, "0")}</b>{rule}</li>)}
            </ol>
          </div>
          <div>
            <span className="micro">What is synthetic</span>
            <p>Jobs, deadlines, station capacity, and outcomes are fictional. The metrics teach scheduling intuition; they are not an operations guarantee.</p>
            <span className="micro">The boundary</span>
            <p>Agent tools inspect, simulate, compare, and stage. Only you can confirm a plan or its rollback.</p>
          </div>
        </div>
        <footer className="modal__foot">
          <span className="dot-label"><i />Keyboard-friendly reorder controls</span>
          <button className="btn btn--mint" type="button" onClick={onClose}>Back to the floor<span aria-hidden="true">→</span></button>
        </footer>
      </section>
    </div>
  );
}

/**
 * What the shift achieved, in one page a stranger can read. It reports three things and
 * grades only the first: whether the plan held, what it cost the queue, and how the work was
 * divided between the agent and the person. The last of those is the point of the whole
 * package, so the number of human confirmations is on the card rather than in a document.
 *
 * Everything here comes off `ShiftResult`, which the domain wrote at close. The modal does no
 * arithmetic of its own — a card that recomputed its own metrics could disagree with the
 * timeline the player just closed, and then neither would be worth reading.
 */
export function ResultCardModal({ card, shifts, results, onStartShift, onReplay, onClose }: {
  card: ShiftResult;
  shifts: readonly Scenario[];
  results: readonly ShiftResult[];
  onStartShift: (scenario: Scenario) => void;
  onReplay: () => void;
  onClose: () => void;
}) {
  const { dialogRef, closeRef } = useDialogShell(onClose);
  const [copied, setCopied] = useState<"idle" | "done" | "blocked">("idle");
  const scenario = shifts.find((shift) => shift.id === card.scenarioId);
  const order = scenario ? formatSchedule(card.finalSchedule, scenario) : card.finalSchedule.join(" → ");
  const { metrics } = card.evaluation;
  // The first shift in play order that has never produced a card. That is the one thing the
  // player has not seen yet, so it gets the lit button; every other shift stays reachable.
  const nextShift = [...shifts]
    .sort((a, b) => a.order - b.order)
    .find((shift) => !results.some((result) => result.scenarioId === shift.id));

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(card.summary.join("\n"));
      setCopied("done");
    } catch {
      // Clipboard access is refused on plenty of perfectly normal setups. The text is on the
      // page and selectable, so say that instead of failing silently.
      setCopied("blocked");
    }
  }

  return (
    <div className="modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal__panel card" role="dialog" aria-modal="true" aria-labelledby="card-title" ref={dialogRef}>
        <header className="modal__head">
          <div>
            <span className="micro micro--mint">Shift {String(card.shiftOrder).padStart(2, "0")} closed</span>
            <h2 id="card-title">{card.scenarioTitle}</h2>
          </div>
          <button className="modal__close" type="button" onClick={onClose} ref={closeRef} aria-label="Close result card">×</button>
        </header>
        <div className="card__verdict">
          <b className={`card__grade card__grade--${card.grade.toLowerCase()}`} aria-hidden="true">{card.grade}</b>
          <div>
            <strong>Grade {card.grade} — {card.objectivesMet} of {card.objectivesGraded} objectives met</strong>
            <p>Closed on <i>{order}</i>, judged under {scenario ? scenario.disruption.shortLabel : "the disruption"}.</p>
          </div>
          <dl className="card__figures">
            <div><dt>On time</dt><dd>{metrics.onTimeJobs}/{metrics.completedJobs}</dd></div>
            <div><dt>Makespan</dt><dd>{metrics.makespan}</dd></div>
            <div><dt>Board score</dt><dd>{metrics.score}</dd></div>
          </dl>
        </div>

        <ul className="card__objectives">
          {card.objectives.map((objective) => (
            <li key={objective.id} className={objective.graded ? (objective.met ? "is-met" : "is-missed") : "is-noted"}>
              <i aria-hidden="true">{objective.graded ? (objective.met ? "✓" : "✕") : "·"}</i>
              <div>
                <strong>{objective.label}{objective.graded ? "" : " (reported, not graded)"}</strong>
                <p>{objective.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="modal__cols">
          <div>
            <span className="micro">What the queue cost</span>
            <dl className="card__figures card__figures--stack">
              <div><dt>Waiting in intake</dt><dd>{slots(metrics.totalIntakeWait)}</dd></div>
              <div><dt>Waiting for a berth</dt><dd>{slots(metrics.totalWaiting)}</dd></div>
              <div><dt>Prep idle, nothing arrived</dt><dd>{slots(metrics.prepStarved)}</dd></div>
              <div><dt>Berth idle</dt><dd>{slots(metrics.dispatchIdle)}</dd></div>
            </dl>
          </div>
          <div>
            <span className="micro">Who did what</span>
            <dl className="card__figures card__figures--stack">
              <div><dt>Tool calls</dt><dd>{card.activity.toolCalls}</dd></div>
              <div><dt>Refused by the runtime</dt><dd>{card.activity.toolRefusals}</dd></div>
              <div><dt>Human confirmations</dt><dd>{card.activity.humanConfirmations}</dd></div>
              <div><dt>Revisions</dt><dd>{card.activity.revisions}</dd></div>
            </dl>
          </div>
        </div>
        <p className="card__lesson"><span className="micro">The lesson of this shift</span>{card.lesson}</p>

        {/* The card as text, always on the page rather than only in the clipboard: this is the
            part a player shows someone else, and a refused clipboard must not lose it. */}
        <div className="card__share">
          <div className="card__share-head">
            <span className="micro">Card as text</span>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => void copySummary()}>
              {copied === "done" ? "Copied" : copied === "blocked" ? "Select the text below" : "Copy"}
            </button>
          </div>
          <pre className="card__text" tabIndex={0}>{card.summary.join("\n")}</pre>
        </div>

        <div className="card__rail">
          <span className="micro">Shifts</span>
          <ul>
            {[...shifts].sort((a, b) => a.order - b.order).map((shift) => {
              const best = results
                .filter((result) => result.scenarioId === shift.id)
                .reduce<ShiftResult | undefined>((top, result) => (!top || result.score > top.score ? result : top), undefined);
              return (
                <li key={shift.id} className={shift.id === card.scenarioId ? "is-current" : best ? "is-done" : ""}>
                  <b>{String(shift.order).padStart(2, "0")}</b>
                  <span>{shift.title}</span>
                  <em>{best ? `grade ${best.grade}` : "not played"}</em>
                  <button className="btn btn--ghost btn--sm" type="button" onClick={() => onStartShift(shift)}>
                    {shift.id === card.scenarioId ? "Replay" : best ? "Play again" : "Start"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onReplay}>Replay this shift</button>
          {nextShift ? (
            <button className="btn btn--mint" type="button" onClick={() => onStartShift(nextShift)}>
              Start shift {String(nextShift.order).padStart(2, "0")}<span aria-hidden="true">→</span>
            </button>
          ) : (
            <button className="btn btn--mint" type="button" onClick={onClose}>Back to the floor<span aria-hidden="true">→</span></button>
          )}
        </footer>
      </section>
    </div>
  );
}

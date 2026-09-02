import { useEffect, useRef } from "react";
import type { Scenario } from "../domain/model.ts";

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
const GUIDE_STEPS = [
  ["01", "Order the jobs", "Move the four cards into a sequence. Preparation feeds the dispatch berths."],
  ["02", "Ask the auditor", "Inspect the revision, find the bottleneck, and run the deterministic disruption test."],
  ["03", "Commit the plan", "Stage the schedule, edit your reason, then use the human-only confirmation button."],
  ["04", "Recover", "One berth goes offline. See what breaks, replan, and use exact undo to revisit."],
];

export function GuideModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
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
  return (
    <div className="modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal__panel" role="dialog" aria-modal="true" aria-labelledby="guide-title" ref={dialogRef}>
        <header className="modal__head">
          <div>
            <span className="micro micro--mint">Flowline field guide</span>
            <h2 id="guide-title">Run the shift. Learn the trade-off.</h2>
          </div>
          <button className="modal__close" type="button" onClick={onClose} ref={closeRef} aria-label="Close guide">×</button>
        </header>
        <p className="modal__lede">
          You are the planner. The page-aware agent is your operations auditor. The goal is not a perfect answer — it is a
          schedule you can explain when the floor changes.
        </p>
        <ol className="modal__steps">
          {GUIDE_STEPS.map(([number, title, copy]) => (
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

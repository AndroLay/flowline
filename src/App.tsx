import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  applyDisruption,
  auditSchedule,
  confirmPending,
  createInitialState,
  enterArena,
  evaluateSchedule,
  rejectPending,
  reorderJob,
  resetRound,
  setFocus,
  setPlayerReason,
  updatePendingReason,
  type FocusTarget,
  type GameState,
  type JobId,
  type ToolEvent,
} from "./domain/model.ts";
import { createFlowlineRuntime, type FlowlineRuntime, type RegistrationSnapshot } from "./tools/webmcp.ts";
import { deriveSceneModel } from "./visual/scene-model.ts";
import { ArenaPage } from "./ui/ArenaPage.tsx";
import { BriefPage } from "./ui/BriefPage.tsx";
import { FocusView } from "./ui/FocusView.tsx";
import { BootScreen, GuideModal, Notice } from "./ui/Overlays.tsx";
import type { ShiftMode } from "./ui/PlanBoard.tsx";

type NoticeState = { tone: "success" | "error" | "info"; text: string };

const BOOT_DURATION_MS = 1250;

const EMPTY_REGISTRATION: RegistrationSnapshot = {
  available: false,
  complete: false,
  phase: "unsupported",
  registered: [],
  failed: [],
  note: "Starting local operations guide…",
};

function transitionOrNotice(
  transition: { ok: true; state: GameState } | { ok: false; error: { message: string } },
  setState: Dispatch<SetStateAction<GameState>>,
  setNotice: Dispatch<SetStateAction<NoticeState | undefined>>,
) {
  if (transition.ok) {
    setState(transition.state);
    return true;
  }
  setNotice({ tone: "error", text: transition.error.message });
  return false;
}
export function App() {
  const [state, setState] = useState<GameState>(() => createInitialState());
  const [bootReady, setBootReady] = useState(false);
  const [bootProgress, setBootProgress] = useState(6);
  const [runtime, setRuntime] = useState<FlowlineRuntime>();
  const [registration, setRegistration] = useState<RegistrationSnapshot>(EMPTY_REGISTRATION);
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [notice, setNotice] = useState<NoticeState>();
  const [guideOpen, setGuideOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [mode, setMode] = useState<ShiftMode>("normal");
  const [selectedJobId, setSelectedJobId] = useState<JobId>("beacon");
  const stateRef = useRef(state);
  const eventSequence = useRef(0);

  stateRef.current = state;

  useEffect(() => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const ratio = Math.min(1, (performance.now() - startedAt) / BOOT_DURATION_MS);
      setBootProgress(Math.round(6 + ratio * 94));
      if (ratio >= 1) {
        window.clearInterval(timer);
        setBootReady(true);
      }
    }, 42);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextRuntime = createFlowlineRuntime({
      readState: () => stateRef.current,
      writeState: (nextState) => setState(nextState),
      emit: (event) => {
        const id = `tool-${++eventSequence.current}`;
        setEvents((current) => [...current, { ...event, id, at: new Date().toISOString() }].slice(-9));
      },
    });
    setRuntime(nextRuntime);
    setRegistration(nextRuntime.snapshot);
    nextRuntime.settled.then(setRegistration);
    return () => {
      void nextRuntime.cleanup();
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(undefined), 4800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    setMode("normal");
  }, [state.revision, state.shockApplied]);
  // One shift condition drives every surface: a shock is either committed by the
  // scenario or previewed by the switch, never invented per panel.
  const shocked = state.shockApplied || mode === "stress";
  const displayEvaluation = useMemo(
    () => evaluateSchedule(state.scenario, state.schedule, { dispatchParallelism: shocked ? state.scenario.disruption.dispatchParallelism : 2 }),
    [shocked, state.scenario, state.schedule],
  );
  const derivedAudit = useMemo(() => auditSchedule(state.scenario, state.schedule), [state.scenario, state.schedule]);
  const audit = state.lastAudit ?? derivedAudit;
  const ghost = useMemo(() => {
    if (state.pendingProposal) {
      return evaluateSchedule(state.scenario, state.pendingProposal.schedule, { dispatchParallelism: state.shockApplied ? 1 : 2 });
    }
    const compared = state.lastAudit?.baseline;
    return compared && compared.schedule.join(",") !== state.schedule.join(",") ? compared : undefined;
  }, [state.lastAudit, state.pendingProposal, state.scenario, state.schedule, state.shockApplied]);
  const sceneModel = useMemo(
    () => deriveSceneModel(state, displayEvaluation, { ghostEvaluation: ghost }),
    [displayEvaluation, ghost, state],
  );

  function showTransition(transition: Parameters<typeof transitionOrNotice>[0]) {
    return transitionOrNotice(transition, setState, setNotice);
  }

  async function runTool(name: string, input: Record<string, unknown> = {}) {
    if (!runtime) {
      setNotice({ tone: "error", text: "The operations guide is still starting. Try again in a moment." });
      return;
    }
    const result = await runtime.invoke(name, input);
    setNotice(result.ok ? { tone: "success", text: result.summary } : { tone: "error", text: result.message });
  }

  function changeMode(next: ShiftMode) {
    setMode(next);
    if (next === "stress" && state.phase !== "setup" && !state.shockApplied) void runTool("simulate_disruption");
  }

  function moveJob(index: number, direction: -1 | 1) {
    if (showTransition(reorderJob(state, index, index + direction))) {
      setSelectedJobId(state.schedule[index]);
      setNotice({ tone: "info", text: "Schedule revised. Run the audit again against the new revision." });
    }
  }

  function confirm() {
    const pendingKind = state.pendingProposal?.kind;
    const wasDisrupted = state.phase === "disrupted";
    if (showTransition(confirmPending(state))) {
      setNotice({
        tone: "success",
        text: pendingKind === "undo"
          ? "Rollback confirmed. The previous order is back on the timeline."
          : wasDisrupted
            ? "Recovery confirmed. The revised order is back on the floor."
            : "Plan confirmed. Now see whether it survives the shift.",
      });
    }
  }
  const brief = state.phase === "setup";
  if (!bootReady) return <BootScreen progress={bootProgress} onSkip={() => setBootReady(true)} />;

  return (
    <div className={`shell${brief ? " shell--brief" : " shell--arena"}`}>
      <Header
        brief={brief}
        round={state.roundNumber}
        registration={registration}
        onEnter={() => { showTransition(enterArena(state)); window.scrollTo({ top: 0, behavior: "auto" }); }}
        onGuide={() => setGuideOpen(true)}
      />

      <main className="shell__main">
        {brief ? (
          <BriefPage
            state={state}
            evaluation={displayEvaluation}
            mode={mode}
            onMode={changeMode}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
            onEnter={() => { showTransition(enterArena(state)); window.scrollTo({ top: 0, behavior: "auto" }); }}
          />
        ) : (
          <ArenaPage
            state={state}
            evaluation={displayEvaluation}
            audit={audit}
            ghost={ghost}
            registration={registration}
            events={events}
            mode={mode}
            onMode={changeMode}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
            onMove={moveJob}
            onInspect={() => void runTool("inspect_board")}
            onSimulate={() => { setMode("stress"); void runTool("simulate_disruption"); }}
            onFindBottleneck={() => void runTool("find_bottleneck")}
            onCompare={() => void runTool("compare_plans", { schedule: state.scenario.robustSchedule })}
            onStageProposal={() => void runTool("stage_schedule", { schedule: state.scenario.robustSchedule, reason: state.playerReason, expectedRevision: state.revision })}
            onStage={() => void runTool("stage_schedule", { schedule: state.phase === "disrupted" ? state.scenario.robustSchedule : state.schedule, reason: state.playerReason, expectedRevision: state.revision })}
            onUndo={() => { if (state.activeReceipt) void runTool("undo_schedule", { receiptId: state.activeReceipt.id, expectedRevision: state.revision }); }}
            onDisruption={() => { if (showTransition(applyDisruption(state))) setNotice({ tone: "error", text: "Condition changed: one dispatch berth is offline. Re-audit the schedule." }); }}
            onRestart={() => { setState(resetRound(state)); setEvents([]); setNotice({ tone: "info", text: `Round ${state.roundNumber + 1} is ready.` }); }}
            onReasonChange={(reason) => setState(setPlayerReason(state, reason))}
            onPendingReasonChange={(reason) => { const next = updatePendingReason(state, reason); if (next.ok) setState(next.state); }}
            onConfirm={confirm}
            onReject={() => showTransition(rejectPending(state))}
            onOpenFocus={() => setFocusOpen(true)}
          />
        )}
      </main>

      <footer className="shell__foot">
        <span>Flowline © 2026<br />Operations lab</span>
        <span className="shell__foot-note">All jobs and outcomes are synthetic · no external requests · no automatic confirmation</span>
        <span>Built for practice. Designed for trust.</span>
      </footer>

      {guideOpen && <GuideModal scenario={state.scenario} onClose={() => setGuideOpen(false)} />}
      {focusOpen && (
        <FocusView
          model={sceneModel}
          onFocus={(focus: FocusTarget) => setState(setFocus(state, focus))}
          onClose={() => setFocusOpen(false)}
        />
      )}
      {notice && <Notice tone={notice.tone} text={notice.text} onDismiss={() => setNotice(undefined)} />}
    </div>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.2v2.3M12 18.5v2.3M4.8 12H2.5M21.5 12h-2.3M6.9 6.9 5.3 5.3M18.7 18.7l-1.6-1.6M17.1 6.9l1.6-1.6M5.3 18.7l1.6-1.6" />
    </svg>
  );
}

/**
 * One header for both pages. Every nav item does something: the current page is
 * marked, the other one is reachable, and Guide opens the field guide. Nothing is
 * a decorative label. The brief keeps only the wordmark and the nav; the arena
 * adds the round counter and the bridge pill, which reports what the runtime
 * actually registered rather than what the demo would like to claim.
 */
function Header({ brief, round, registration, onEnter, onGuide }: {
  brief: boolean;
  round: number;
  registration: RegistrationSnapshot;
  onEnter: () => void;
  onGuide: () => void;
}) {
  const native = registration.phase === "registered";
  return (
    <header className={`shell__head shell__head--${brief ? "brief" : "arena"}`}>
      <a className="lockup" href={brief ? "#brief" : "#arena"}>
        <b className="wordmark">Flow<span>line</span></b>
        <small>Operations lab / WebMCP learning game</small>
      </a>

      <nav className="shell__nav" aria-label="Sections">
        {brief ? (
          <>
            <a href="#brief" aria-current="page">Brief</a>
            <button type="button" onClick={onEnter}>Arena</button>
          </>
        ) : (
          <>
            <a href="#arena" aria-current="page">Gameplay</a>
            <a href="#auditor-title">Auditor</a>
          </>
        )}
        <button type="button" onClick={onGuide}>Guide</button>
      </nav>

      {!brief && (
        <div className="shell__status">
          <span className="round">Round <b>{String(round).padStart(2, "0")}</b></span>
          <span className={`pill${native ? " pill--mint" : ""}`}>
            <i />{native ? "Native tools" : "Local simulation"}
          </span>
          <button className="icon-btn" type="button" onClick={onGuide} aria-label="Open the field guide">
            <GearIcon />
          </button>
        </div>
      )}
    </header>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  applyDisruption,
  auditSchedule,
  comparisonIsCurrent,
  confirmPending,
  createInitialState,
  enterArena,
  evaluateSchedule,
  recommendSchedule,
  rejectPending,
  reorderJob,
  resetRound,
  setFocus,
  setPlayerReason,
  updatePendingReason,
  type FocusTarget,
  type GameState,
  type JobId,
  type PlanRecommendation,
  type ToolEvent,
} from "./domain/model.ts";
import { createFlowlineRuntime, type FlowlineRuntime, type RegistrationSnapshot } from "./tools/webmcp.ts";
import { deriveSceneModel } from "./visual/scene-model.ts";
import { ArenaPage } from "./ui/ArenaPage.tsx";
import { BriefPage } from "./ui/BriefPage.tsx";
import { FocusView, type RendererState } from "./ui/FocusView.tsx";
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
  commit: (state: GameState) => void,
  setNotice: Dispatch<SetStateAction<NoticeState | undefined>>,
) {
  if (transition.ok) {
    commit(transition.state);
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
  const [focusRenderer, setFocusRenderer] = useState<RendererState>("loading");
  const [mode, setMode] = useState<ShiftMode>("normal");
  const [selectedJobId, setSelectedJobId] = useState<JobId>("beacon");
  const stateRef = useRef(state);
  const eventSequence = useRef(0);

  /**
   * The one way the board changes. React applies `setState` on its own schedule, so a
   * tool call that runs before the next render would otherwise read the board as it
   * was before the call in front of it — the ref advances with the same value React
   * will render, which is the contract the runtime's `readState` relies on.
   */
  const commit = useCallback((next: GameState) => {
    stateRef.current = next;
    setState(next);
  }, []);

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
      writeState: commit,
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
  }, [commit]);

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
  // Both plans are judged under the same shift, so the live strip and the ghost
  // strip stay comparable: a previewed shock must not quietly give the proposal a
  // berth the committed plan has lost.
  const shiftParallelism = shocked ? state.scenario.disruption.dispatchParallelism : 2;
  const displayEvaluation = useMemo(
    () => evaluateSchedule(state.scenario, state.schedule, { dispatchParallelism: shiftParallelism }),
    [shiftParallelism, state.scenario, state.schedule],
  );
  const derivedAudit = useMemo(() => auditSchedule(state.scenario, state.schedule), [state.scenario, state.schedule]);
  const audit = state.lastAudit ?? derivedAudit;
  // The auditor's candidate, searched from the order that is actually on the board rather
  // than read from the scenario's worked example. It is undefined exactly when the board
  // is already the best plan available, which is the state a player reaches by solving
  // the round — and the one case where an agent has nothing to propose.
  const recommendation = useMemo(() => recommendSchedule(state.scenario, state.schedule), [state.scenario, state.schedule]);
  // The ghost strip only ever draws an order nobody has committed: a staged
  // proposal, else the candidate the agent last compared, and that one only while
  // the comparison still describes the plan on the board. Both go through the same
  // evaluation at the same shift as the live strip, so the ghost is never handed a
  // berth the committed plan has lost.
  const ghost = useMemo(() => {
    const candidate = state.pendingProposal
      ? state.pendingProposal.schedule
      : comparisonIsCurrent(state)
        ? state.lastComparison?.schedule
        : undefined;
    if (!candidate) return undefined;
    return evaluateSchedule(state.scenario, candidate, { dispatchParallelism: shiftParallelism });
  }, [shiftParallelism, state]);
  const sceneModel = useMemo(
    () => deriveSceneModel(state, displayEvaluation, { ghostEvaluation: ghost }),
    [displayEvaluation, ghost, state],
  );

  function showTransition(transition: Parameters<typeof transitionOrNotice>[0]) {
    return transitionOrNotice(transition, commit, setNotice);
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

  /**
   * An agent tool call that only makes sense when the auditor actually found something
   * better. Refusing here, in words, beats calling the tool with the order the board is
   * already running: the trace would fill with plans identical to the committed one, and
   * the ghost strip would draw a second copy of the live timeline.
   */
  function withRecommendation(run: (plan: PlanRecommendation) => void) {
    if (!recommendation) {
      setNotice({ tone: "info", text: "The auditor has nothing better to offer: this order already holds the critical deadline with a berth offline." });
      return;
    }
    run(recommendation);
  }

  // One call for every way the queue can be reordered — the arrows, the arrow keys and a
  // dragged chip all land here, so a drag cannot reach a state the buttons cannot.
  function reorderQueue(from: number, to: number) {
    const moved = state.schedule[from];
    if (showTransition(reorderJob(state, from, to))) {
      setSelectedJobId(moved);
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
  const focus = focusOpen && !brief;
  if (!bootReady) return <BootScreen progress={bootProgress} onSkip={() => setBootReady(true)} />;

  return (
    <div className={`shell${brief ? " shell--brief" : focus ? " shell--focus" : " shell--arena"}`}>
      <Header
        brief={brief}
        focus={focus}
        rendererState={focusRenderer}
        round={state.roundNumber}
        registration={registration}
        onEnter={() => { showTransition(enterArena(state)); window.scrollTo({ top: 0, behavior: "auto" }); }}
        onOverview={() => setFocusOpen(false)}
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
        ) : focus ? (
          <FocusView
            model={sceneModel}
            scenario={state.scenario}
            evaluation={displayEvaluation}
            focus={state.focus}
            ghostEvaluation={ghost}
            onFocus={(target: FocusTarget) => { commit(setFocus(state, target)); if (target.jobId) setSelectedJobId(target.jobId); }}
            onClose={() => setFocusOpen(false)}
            onRendererState={setFocusRenderer}
            onRequestConfirm={() => {
              setFocusOpen(false);
              // The gate is the only place a plan is committed, and it is the
              // only place the human reason is recorded. The focus page sends the
              // player there instead of growing a second confirm path.
              window.requestAnimationFrame(() => document.getElementById("auditor-title")?.scrollIntoView({ block: "start" }));
            }}
          />
        ) : (
          <ArenaPage
            state={state}
            evaluation={displayEvaluation}
            audit={audit}
            ghost={ghost}
            recommendation={recommendation}
            registration={registration}
            events={events}
            mode={mode}
            onMode={changeMode}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
            onReorder={reorderQueue}
            onInspect={() => void runTool("inspect_board")}
            onSimulate={() => { setMode("stress"); void runTool("simulate_disruption"); }}
            onFindBottleneck={() => void runTool("find_bottleneck")}
            onCompare={() => withRecommendation((plan) => void runTool("compare_plans", { schedule: plan.schedule }))}
            onStageProposal={() => withRecommendation((plan) => void runTool("stage_schedule", { schedule: plan.schedule, reason: plan.reason, expectedRevision: state.revision }))}
            onStage={() => void runTool("stage_schedule", { schedule: state.schedule, reason: state.playerReason, expectedRevision: state.revision })}
            onUndo={() => { if (state.activeReceipt) void runTool("undo_schedule", { receiptId: state.activeReceipt.id, expectedRevision: state.revision }); }}
            onDisruption={() => { if (showTransition(applyDisruption(state))) setNotice({ tone: "error", text: "Condition changed: one dispatch berth is offline. Re-audit the schedule." }); }}
            onRestart={() => { commit(resetRound(state)); setEvents([]); setNotice({ tone: "info", text: `Round ${state.roundNumber + 1} is ready.` }); }}
            onReasonChange={(reason) => commit(setPlayerReason(state, reason))}
            onPendingReasonChange={(reason) => { const next = updatePendingReason(state, reason); if (next.ok) commit(next.state); }}
            onConfirm={confirm}
            onReject={() => showTransition(rejectPending(state))}
            onOpenFocus={() => { setFocusOpen(true); window.scrollTo({ top: 0, behavior: "auto" }); }}
          />
        )}
      </main>

      {/* The focus mock has no footer band: the floor, its rails and the two plan
          strips own the viewport, and the way back out is the rail's own control.
          Keeping the band here is also what pushed that page 57px past the fold. */}
      {!focus && (
        <footer className="shell__foot">
          <span className="shell__foot-mark"><b>Flowline © 2026</b><small>Operations lab</small></span>
          <span className="shell__foot-note">All jobs and outcomes are synthetic · no external requests · no automatic confirmation</span>
          <span>Built for practice. Designed for trust.</span>
        </footer>
      )}

      {guideOpen && <GuideModal scenario={state.scenario} onClose={() => setGuideOpen(false)} />}
      {notice && <Notice tone={notice.tone} text={notice.text} onDismiss={() => setNotice(undefined)} />}
    </div>
  );
}
/**
 * One header for every page. Every nav item does something: the current page is
 * marked, the others are reachable, and Guide opens the field guide. Nothing is a
 * decorative label. The brief keeps only the wordmark and the nav; the arena adds
 * the round counter and the bridge pill, which reports what the runtime actually
 * registered rather than what the demo would like to claim. The focus page swaps
 * that pill for the renderer's real state, so "WebGL active" is never a guess.
 */
function Header({ brief, focus, rendererState, round, registration, onEnter, onOverview, onGuide }: {
  brief: boolean;
  focus: boolean;
  rendererState: RendererState;
  round: number;
  registration: RegistrationSnapshot;
  onEnter: () => void;
  onOverview: () => void;
  onGuide: () => void;
}) {
  const native = registration.phase === "registered";
  return (
    <header className={`shell__head shell__head--${brief ? "brief" : focus ? "focus" : "arena"}`}>
      {/* On the focus page the wordmark is a real way back, not an anchor to a section
          that is not on the page while the lens is open. The exit standing in the floor's
          own sky is the other one, and there is no third. */}
      <a className="lockup" href={brief ? "#brief" : "#arena"} onClick={focus ? onOverview : undefined}>
        <b className="wordmark">Flow<span>line</span></b>
        <small>Operations lab / {focus ? "focus view" : "WebMCP learning game"}</small>
      </a>

      <nav className="shell__nav" aria-label="Sections">
        {brief ? (
          <>
            <a href="#brief" aria-current="page">Brief</a>
            <button type="button" onClick={onEnter}>Arena</button>
          </>
        ) : focus ? (
          <a href="#focus" aria-current="page">Focus</a>
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
          {focus ? (
            <span className={`pill${rendererState === "ready" ? " pill--mint" : rendererState === "fallback" ? " pill--coral" : ""}`}>
              <i />{rendererState === "ready" ? "WebGL active · fallback available" : rendererState === "fallback" ? "Fallback active · WebGL unavailable" : "Starting renderer…"}
            </span>
          ) : (
            <>
              <span className="round">Round <b>{String(round).padStart(2, "0")}</b></span>
              <span className={`pill${native ? " pill--mint" : ""}`}>
                <i />{native ? "Native tools" : "Local simulation"}
              </span>
            </>
          )}
        </div>
      )}
    </header>
  );
}

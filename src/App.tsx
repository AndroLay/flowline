import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  applyDisruption,
  auditSchedule,
  closeShift,
  comparisonIsCurrent,
  confirmPending,
  createInitialState,
  criticalJob,
  enterArena,
  evaluateSchedule,
  recommendSchedule,
  rejectPending,
  reorderJob,
  resetRound,
  setFocus,
  setPlayerReason,
  shiftOptions,
  stageSchedule,
  startShift,
  updatePendingReason,
  type FocusTarget,
  type GameState,
  type JobId,
  type PlanRecommendation,
  type Scenario,
  type ToolEvent,
} from "./domain/model.ts";
import { shifts } from "./data/fixtures.ts";
import { createFlowlineRuntime, type FlowlineRuntime, type RegistrationSnapshot } from "./tools/webmcp.ts";
import { deriveSceneModel } from "./visual/scene-model.ts";
import { ArenaPage } from "./ui/ArenaPage.tsx";
import { BriefPage } from "./ui/BriefPage.tsx";
import { FocusView, type RendererState } from "./ui/FocusView.tsx";
import { BootScreen, GuideModal, Notice, ResultCardModal } from "./ui/Overlays.tsx";
import type { ShiftMode } from "./ui/PlanBoard.tsx";

type NoticeState = { tone: "success" | "error" | "info"; text: string };

const BOOT_DURATION_MS = 1250;

const EMPTY_REGISTRATION: RegistrationSnapshot = {
  available: false,
  complete: false,
  phase: "unsupported",
  provenance: "absent",
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
  const [selectedJobId, setSelectedJobId] = useState<JobId>(() => criticalJob(state.scenario).id);
  const [resultOpen, setResultOpen] = useState(false);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef(state);
  /**
   * The whole trace, as against the nine lines the rail shows. The result card counts calls
   * and refusals over a shift, and `review_shift` hands that count to an agent, so both need
   * the log rather than the tail of it — the rail's slice is a display decision and must not
   * become the number the card reports.
   */
  const traceRef = useRef<ToolEvent[]>([]);
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

  const shiftId = state.scenario.id;

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

  /**
   * The runtime is rebuilt when the shift changes, and only then. Its catalogue is built from
   * the board it is given — the schedule schema advertises that shift's job ids and its exact
   * length — so a runtime carried across a shift change would go on offering a host the enum
   * of a floor nobody is standing on. Unregister first, then register the new set, which is
   * also what a host sees: the tool list is a property of the page's current state.
   */
  useEffect(() => {
    const nextRuntime = createFlowlineRuntime({
      readState: () => stateRef.current,
      writeState: commit,
      readEvents: () => traceRef.current,
      shifts,
      emit: (event) => {
        const id = `tool-${++eventSequence.current}`;
        const line = { ...event, id, at: new Date().toISOString() };
        traceRef.current = [...traceRef.current, line];
        setEvents((current) => [...current, line].slice(-9));
      },
    });
    setRuntime(nextRuntime);
    setRegistration(nextRuntime.snapshot);
    nextRuntime.settled.then(setRegistration);
    return () => {
      void nextRuntime.cleanup();
    };
  }, [commit, shiftId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(undefined), 4800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    setMode("normal");
  }, [state.revision, state.shockApplied]);

  /**
   * A new shift brings a new floor, so the selection has to move with it: keeping the previous
   * shift's job id would leave every surface highlighting a job that is not in the queue. The
   * critical job is the one the round is graded on, which is the right thing to open on.
   */
  useEffect(() => {
    setSelectedJobId(criticalJob(stateRef.current.scenario).id);
    setResultOpen(false);
  }, [shiftId, state.roundNumber]);
  // One shift condition drives every surface: a shock is either committed by the
  // scenario or previewed by the switch, never invented per panel.
  const shocked = state.shockApplied || mode === "stress";
  // Both plans are judged under the same shift, so the live strip and the ghost
  // strip stay comparable: a previewed shock must not quietly give the proposal a
  // berth the committed plan has lost — and on a shift whose shock is a late arrival
  // rather than a lost berth, both strips have to feel that arrival too.
  const conditions = useMemo(() => shiftOptions(state.scenario, shocked), [shocked, state.scenario]);
  const displayEvaluation = useMemo(
    () => evaluateSchedule(state.scenario, state.schedule, conditions),
    [conditions, state.scenario, state.schedule],
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
    return evaluateSchedule(state.scenario, candidate, conditions);
  }, [conditions, state]);
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

  function closeFocus() {
    setFocusOpen(false);
    // The arena opener is unmounted while the focus page owns the viewport. Restore
    // the user's keyboard position after React puts that button back in the tree.
    window.requestAnimationFrame(() => focusReturnRef.current?.focus());
  }

  function stageHumanPlan() {
    showTransition(stageSchedule(state, state.schedule, state.playerReason, state.revision));
  }

  /**
   * The two ends of a shift, and the reason both are buttons rather than tools. Closing writes
   * the card that says what was achieved, and choosing what to work next is the same class of
   * decision as committing a plan — an agent may read either through `review_shift` and
   * `list_shifts`, and may reach neither. The trace is handed to `closeShift` because the card
   * reports how the work was divided, and it is cleared with the floor: a new shift's card must
   * not count calls made against the last one.
   */
  function closeCurrentShift() {
    if (showTransition(closeShift(state, traceRef.current))) {
      setResultOpen(true);
      setNotice({ tone: "success", text: "Shift closed. The result card reports what this plan achieved." });
    }
  }

  function beginShift(next: Scenario) {
    if (showTransition(startShift(state, next))) {
      setEvents([]);
      traceRef.current = [];
      setNotice({ tone: "info", text: `Shift ${String(next.order).padStart(2, "0")} — ${next.title}. Read the brief, then plan.` });
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  function restartRound() {
    commit(resetRound(state));
    setEvents([]);
    traceRef.current = [];
    setNotice({ tone: "info", text: `Round ${state.roundNumber + 1} is ready.` });
  }

  function openFocus() {
    focusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusOpen(true);
    window.scrollTo({ top: 0, behavior: "auto" });
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
        onOverview={closeFocus}
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
            onClose={closeFocus}
            onRendererState={setFocusRenderer}
            onRequestConfirm={() => {
              closeFocus();
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
            onStage={stageHumanPlan}
            onUndo={() => { if (state.activeReceipt) void runTool("undo_schedule", { receiptId: state.activeReceipt.id, expectedRevision: state.revision }); }}
            onDisruption={() => { if (showTransition(applyDisruption(state))) setNotice({ tone: "error", text: `Condition changed: ${state.scenario.disruption.clause}. Re-audit the schedule.` }); }}
            onRestart={restartRound}
            shifts={shifts}
            onStartShift={beginShift}
            onCloseShift={closeCurrentShift}
            onReviewShift={() => setResultOpen(true)}
            onReasonChange={(reason) => commit(setPlayerReason(state, reason))}
            onPendingReasonChange={(reason) => { const next = updatePendingReason(state, reason); if (next.ok) commit(next.state); }}
            onConfirm={confirm}
            onReject={() => showTransition(rejectPending(state))}
            onOpenFocus={openFocus}
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
      {resultOpen && state.resultCard && (
        <ResultCardModal
          card={state.resultCard}
          shifts={shifts}
          results={state.results}
          onStartShift={(next) => { setResultOpen(false); beginShift(next); }}
          onReplay={() => { setResultOpen(false); restartRound(); }}
          onClose={() => setResultOpen(false)}
        />
      )}
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
  // This pill used to read "Native tools" whenever registration completed, which overstated
  // what had happened: every registry this project has ever registered against was a script
  // that defined `document.modelContext`, and a page cannot tell that apart from a browser's
  // own. It now reports the registry it found, and says so when the registry declared itself
  // a test double, so a screenshot cannot be mistaken for native-client evidence.
  const registered = registration.phase === "registered";
  const surface =
    registration.provenance === "absent"
      ? "Local simulation"
      : registration.provenance === "test-double"
        ? "Scripted test tools"
        : registered
          ? "Tools registered"
          : "Registering tools…";
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
              <span className={`pill${registered ? " pill--mint" : ""}`}>
                <i />{surface}
              </span>
            </>
          )}
        </div>
      )}
    </header>
  );
}

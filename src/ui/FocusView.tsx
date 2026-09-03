import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { endSlot, slots, slotWindow, type FocusTarget, type JobId, type Scenario, type ScheduleEvaluation } from "../domain/model.ts";
import { sceneModelAtSlot, type SceneJob, type SceneModel, type SceneSite } from "../visual/scene-model.ts";
import type { FocusCameraView, Flowline3DController, SceneAnchor } from "../visual/flowline-3d.ts";
import { ScheduleTimeline, VERDICT } from "./PlanBoard.tsx";
import { tipSentence, useTip, type TipBinder, type TipContent } from "./Tip.tsx";

export type RendererState = "loading" | "ready" | "fallback";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * The camera views the page offers, in the order it shows them. The renderer owns what
 * each one stands at and looks at; this is only what they are called on screen.
 */
const VIEWS: { id: FocusCameraView; label: string }[] = [
  { id: "iso", label: "Iso" },
  { id: "top", label: "Top" },
  { id: "prep", label: "Prep" },
  { id: "dispatch", label: "Dispatch" },
];

/**
 * Zoom steps, as multipliers on whichever view's own distance. They live here rather
 * than in the renderer because the renderer is loaded lazily: importing a value out of
 * it would pull three.js into the first chunk to read five numbers. It clamps the ends.
 */
const ZOOMS = [0.85, 1, 1.25, 1.55, 1.9];

/**
 * How long one slot is held while the shift plays. It has to outlast the renderer's own
 * travel tween, or a block would be cut off mid-move by the next slot.
 */
const SLOT_MS = 900;

/**
 * The focus page: one operations floor read in 3D, with every word on it kept in
 * the DOM. The scene projects its own label anchors, so the text sits on the
 * geometry it names instead of being positioned by hand. When WebGL is missing
 * the same floor is listed as text — the page never depends on the canvas to be
 * understood, and it never owns state the timeline does not already prove.
 */
export function FocusView({ model, scenario, evaluation, focus, ghostEvaluation, onFocus, onClose, onRendererState, onRequestConfirm }: {
  model: SceneModel;
  scenario: Scenario;
  evaluation: ScheduleEvaluation;
  /** Where the floor is pointed and why — written by whichever tool or click aimed it. */
  focus: FocusTarget;
  ghostEvaluation?: ScheduleEvaluation;
  onFocus: (focus: FocusTarget) => void;
  onClose: () => void;
  onRendererState: (state: RendererState) => void;
  onRequestConfirm: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<Flowline3DController | undefined>(undefined);
  const [rendererState, setRendererState] = useState<RendererState>("loading");
  const [rendererError, setRendererError] = useState("");
  const [anchors, setAnchors] = useState<SceneAnchor[]>([]);
  const [view, setView] = useState<FocusCameraView>("iso");
  const [zoomStep, setZoomStep] = useState(1);
  /**
   * Which slot of the shift the floor is held at, or `undefined` for the plan as it
   * ends. Those are different readings, not the same one: the live floor shows each
   * berth's last tenant, which is a summary of the whole shift and not a moment in it.
   */
  const [heldSlot, setHeldSlot] = useState<number | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const captureBuffer = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("flowline-capture");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => { onRendererState(rendererState); }, [rendererState, onRendererState]);

  useEffect(() => {
    let active = true;
    void import("../visual/flowline-3d.ts").then(({ createFlowline3D }) => {
      if (!active || !canvasRef.current) return;
      try {
        const controller = createFlowline3D(canvasRef.current, model, {
          reducedMotion,
          preserveDrawingBuffer: captureBuffer,
          onAnchors: (next) => { if (active) setAnchors(next); },
        });
        if (!active) {
          controller.dispose();
          return;
        }
        controllerRef.current = controller;
        // A non-enumerable local inspection hook lets the CDP evidence harness
        // read renderer.info, frame samples and label anchors without adding a
        // production HUD or a second render loop. It goes with the renderer.
        Object.defineProperty(canvasRef.current, "__flowlineController", { configurable: true, value: controller });
        setRendererState("ready");
      } catch (error) {
        setRendererError(error instanceof Error ? error.message : "WebGL could not be started.");
        setRendererState("fallback");
      }
    }).catch((error: unknown) => {
      if (!active) return;
      setRendererError(error instanceof Error ? error.message : "The optional focus renderer could not be loaded.");
      setRendererState("fallback");
    });
    return () => {
      active = false;
      if (canvasRef.current && Object.prototype.hasOwnProperty.call(canvasRef.current, "__flowlineController")) {
        delete (canvasRef.current as HTMLCanvasElement & { __flowlineController?: Flowline3DController }).__flowlineController;
      }
      controllerRef.current?.dispose();
      controllerRef.current = undefined;
    };
  }, [captureBuffer, reducedMotion]);

  /**
   * The floor the page draws: the plan as it ends, or the plan read at one held slot.
   * Only the floor and the words printed on it follow the scrub. The rail keeps the
   * live model, because metrics and verdicts are claims about the whole plan rather
   * than about a moment in it, and `sceneModelAtSlot` re-seats nothing else.
   */
  const floorModel = useMemo(
    () => (heldSlot === undefined ? model : sceneModelAtSlot(model, heldSlot)),
    [model, heldSlot],
  );

  useEffect(() => {
    if (rendererState === "ready") controllerRef.current?.update(floorModel);
  }, [floorModel, rendererState]);

  // Where the camera stands is the renderer's business, not the model's: standing
  // somewhere else changes no fact about the plan, so it never enters game state.
  useEffect(() => {
    if (rendererState === "ready") controllerRef.current?.setCamera(view, ZOOMS[zoomStep] ?? 1);
  }, [view, zoomStep, rendererState]);

  // Playing the shift walks slots the plan already fixed — nothing is simulated per
  // tick — and it stops at the end of the horizon rather than looping, so a finished
  // shift does not sit there asking for frames.
  useEffect(() => {
    if (!playing) return;
    if (heldSlot !== undefined && heldSlot >= scenario.horizon) { setPlaying(false); return; }
    const timer = window.setTimeout(
      () => setHeldSlot((current) => Math.min((current ?? -1) + 1, scenario.horizon)),
      SLOT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, heldSlot, scenario.horizon]);

  const anchor = useMemo(() => {
    const map = new Map<string, SceneAnchor>();
    for (const item of anchors) map.set(item.id, item);
    return map;
  }, [anchors]);
  const jobAt = (site: SceneSite) => floorModel.jobs.find((job) => job.site === site);
  const gateJob = jobAt("gate");
  const dispatch = model.stations.find((station) => station.id === "dispatch");
  const offline = Boolean(dispatch && dispatch.activeCapacity < dispatch.capacity);
  const focusJob = model.focusJob;
  const ghostReady = Boolean(ghostEvaluation && model.ghostJobs.length);
  // The berth the current focus is arguing about, when it names one at all.
  const focusBerth = focus.berthIndex === undefined ? undefined : model.berths.find((berth) => berth.index === focus.berthIndex);

  // A job is chosen on the rail's own timeline now that the page carries no
  // picker row, and the station that focus moves to follows the job's place on
  // the floor: still in prep focuses the prep bay, anything past it dispatch.
  function selectRow(jobId: JobId) {
    const job = model.jobs.find((item) => item.id === jobId);
    const inPrep = job?.site.startsWith("prep") ?? false;
    setPlaying(false);
    onFocus({
      stationId: inPrep ? "prep" : "dispatch",
      jobId,
      reason: job
        ? `You picked ${job.shortLabel}: it dispatches in slots ${slotWindow(job.dispatchStart, job.dispatchEnd)} against D${job.deadline}.`
        : "You picked a job that has no run in this plan.",
      source: "player",
    });
  }

  // Play from the top when the shift is over or was never held, so the button always
  // means "watch this run" rather than "resume from wherever the scrub was left".
  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (heldSlot === undefined || heldSlot >= scenario.horizon) setHeldSlot(0);
    setPlaying(true);
  }

  // Both surfaces answer a cursor through the same popup. Here the panel also has to
  // escape the viewport's own clip — the clip that holds the floor's extruded faces
  // inside the frame — which a fixed panel delivered to the body does for free.
  const { tipProps, dock } = useTip();

  // The floor's interactive layer, built from the anchors the scene already projects.
  // Picking this way costs the renderer nothing — no extra geometry, no raycast, no
  // per-frame state — and it cannot drift from the labels, because a target and the
  // word printed on it read the same projected point.
  // Reaching into the floor stops the clock. A click means "explain this one", and a
  // floor that keeps moving under the cursor answers a later question than the one asked.
  const pickFocus = (next: FocusTarget) => { setPlaying(false); onFocus(next); };
  // The picks read the floor as shown, not the plan as it ends, so the object under the
  // cursor always reports the job actually standing on it at this slot.
  const picks = rendererState === "ready"
    ? buildPicks({ model: floorModel, scenario, anchor, onFocus: pickFocus, selectRow })
    : [];
  return (
    <div className={`focus focus-view focus-view--${rendererState}`} id="focus" aria-busy={rendererState === "loading"}>
      <div className="focus__rail">
        <aside className="focus__summary" aria-label="Focus summary">
          <header className="focus__summary-head">
            <span className="dot-label dot-label--mint dot-label--lg">
              <CrosshairIcon />
              <span className="focus__kicker">Focus / {model.focusedStationId === "prep" ? "Prep bay" : "Dispatch bay"}</span>
            </span>
            <div className="focus__rev">
              <span className="micro">Revision</span>
              <b>{pad(model.revision)}</b>
            </div>
          </header>
          <dl className="focus__facts">
            <div>
              <dt className="micro">Selected job</dt>
              <dd className={`focus__name is-${focusJob?.tint ?? "none"}`}>{focusJob?.shortLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="micro">Capacity</dt>
              <dd>{dispatch ? `${dispatch.activeCapacity}/${dispatch.capacity} berths` : "—"}</dd>
            </div>
          </dl>
          <div className="focus__metrics">
            <Metric label="On time" value={String(model.metrics.onTimeJobs)} total={model.metrics.totalJobs} tone={model.metrics.criticalOnTime ? "mint" : "coral"} />
            <Metric label="Makespan" value={pad(model.metrics.makespan)} />
            <Metric label="Waiting" value={pad(model.metrics.totalWaiting)} tone={model.metrics.totalWaiting ? "gold" : undefined} />
            <Metric label="Idle" value={pad(model.metrics.dispatchIdle)} tone={model.metrics.dispatchIdle ? "blue" : undefined} />
          </div>
          <div className={`focus__state is-${focusJob?.status ?? "on-time"}`}>
            <div>
              <span className="micro">Status</span>
              <strong>
                {(focusJob?.status ?? "on-time").replace("-", " ")}
                {focusJob && focusJob.status !== "on-time" && <WarnIcon />}
              </strong>
            </div>
            <div>
              <span className="micro">Deadline</span>
              <strong>D{model.deadlineSlot}</strong>
            </div>
          </div>
          <section className="focus__mini" aria-label="Slot timeline for the live plan">
            <span className="micro">Slot timeline</span>
            <ScheduleTimeline
              scenario={scenario}
              evaluation={evaluation}
              dense
              rows="jobs"
              legend={false}
              heading={false}
              onSelectRow={selectRow}
              selectedRowId={focusJob?.id}
            />
            <ul className="focus__legend">
              <li><i className="sw sw--ontime" />On time</li>
              <li><i className="sw sw--risk" />At risk</li>
              <li><i className="sw sw--late" />Late</li>
              <li><i className="sw sw--idle" />Idle</li>
              <li><i className="sw sw--offline" />Offline</li>
            </ul>
          </section>
          {/* Why the floor is pointed here — written by whichever tool or click aimed it,
              so it changes when the cause changes. It belongs under the panel that names
              the station rather than over the deck: a scene that moves when a tool runs
              but cannot say what it is showing is decoration, and the kerb below the
              routes is where the slot numbers are read. */}
          <section className="focus__cause" aria-live="polite">
            <header className="focus__cause-head">
              <span className="micro">Why this focus</span>
              {/* Who aimed it, on the same row as the label: the point of the block is that
                  a tool call moved the floor, so the answer to "was that me?" is part of
                  the heading rather than a line of its own. */}
              <small>{focus.source === "player" ? "You" : focus.source === "system" ? "The shift" : "The auditor"}</small>
            </header>
            <p>
              {focus.reason}{" "}
              {focusBerth && (
                // Named and stated, not only tinted: the same badge marks the berth the
                // shift lost and the berth a candidate route runs through, and only the
                // word tells those two apart.
                <b className={focusBerth.active ? "is-active" : "is-offline"}>
                  {focusBerth.label} · {focusBerth.active ? "active" : "offline"}
                </b>
              )}
            </p>
          </section>
        </aside>
      </div>

      <div className="focus__stage">
        <div className="focus__viewport" data-renderer-state={rendererState}>
          <canvas
            ref={canvasRef}
            className="focus-view__canvas focus__canvas"
            aria-label="Operations floor in 3D. The same floor is listed as text below this canvas."
          />
          {/* The way back, standing in the floor's own sky. It used to sit at the foot of
              the rail, which is taller than the frame on a short screen, so the one
              control a player needs to leave with was the one below the fold. */}
          <button className="focus__exit" type="button" onClick={onClose}>
            <span className="focus__exit-arrow" aria-hidden="true">←</span>
            <span>2.5D overview</span>
          </button>
          {rendererState === "ready" && (
            <div className="focus__tags" aria-hidden="true">
              <Tag at={anchor.get("bay-prep")} kind="bay"><b>Prep bay</b><small>1 lane / sequential</small></Tag>
              <Tag at={anchor.get("bay-gate")} kind="bay"><b>Transfer</b><small>Gate</small></Tag>
              <Tag at={anchor.get("bay-dispatch")} kind="bay">
                <b>Dispatch bay</b>
                <small>{dispatch?.activeCapacity ?? 0} of {dispatch?.capacity ?? 0} berths / {offline ? "offline" : "parallel"}</small>
              </Tag>
              {/* The gate holds at most one job, so the queue mark is its depth. */}
              <Tag at={anchor.get("queue")} kind="box"><b>Q{gateJob ? 1 : 0}</b></Tag>
              {/* The gate's callout, which the scene only projects while a job actually
                  stands there. It names the job in the same word the rail uses for it,
                  so the bubble cannot claim a selection the model does not hold. */}
              {gateJob && (
                <Tag at={anchor.get("gate-callout")} kind="bubble">
                  <b>{gateJob.selected ? "Selected" : "Holding"} · {gateJob.shortLabel}</b>
                </Tag>
              )}
              {JOB_SITES.map((site) => {
                const job = jobAt(site);
                if (!job) return null;
                // Two short lines rather than one long one: a job label has to stay
                // inside the lit cap it is printed on, and dark ink that overhangs
                // onto the dark deck cannot be read. The warning is drawn rather than
                // typed for the reason every other mark on this page is.
                return (
                  <Tag key={`${site}-${job.id}`} at={anchor.get(`site-${site}`)} kind={`job is-${job.status}`}>
                    <b>{job.shortLabel}{job.status !== "on-time" && <WarnIcon />}</b>
                    <small>{pad(job.queuePosition + 1)} · {Math.round(job.meter * 100)}%</small>
                  </Tag>
                );
              })}
              {floorModel.berths.map((berth) => (
                <Tag key={berth.index} at={anchor.get(`berth-${berth.index + 1}`)} kind={`berth${berth.active ? "" : " is-offline"}`}>
                  <b>Berth {berth.index + 1}</b>
                  <small>{berth.active ? "active" : "offline"}</small>
                </Tag>
              ))}
              {/* A berth the disruption took out is padlocked on its own bay. The scene
                  projects this anchor only for berths whose active flag is false, so the
                  mark can never land on a berth that is still working. */}
              {floorModel.berths.filter((berth) => !berth.active).map((berth) => (
                <Tag key={`lock-${berth.index}`} at={anchor.get(`lock-${berth.index + 1}`)} kind="lock"><LockIcon /></Tag>
              ))}
              {/* The kerb doubles as the shift clock: the slot the floor is held at is
                  marked on the same numbers the picks already answer for. */}
              {Array.from({ length: scenario.horizon }, (_, index) => index + 1).map((slot) => (
                <Tag
                  key={slot}
                  at={anchor.get(`slot-${slot}`)}
                  kind={`slot${slot === model.deadlineSlot ? " is-deadline" : ""}${slot === heldSlot ? " is-now" : ""}`}
                >
                  <b>{pad(slot)}</b>
                </Tag>
              ))}
              <Tag at={anchor.get("deadline")} kind="deadline"><b>Deadline D{model.deadlineSlot}</b></Tag>
            </div>
          )}
          {/* The floor answers a cursor. Every object on it is a real button sitting on
              its own projected anchor, so hovering, tapping and tabbing all reach the
              same thing and read the same facts. It goes above the tag layer, which
              stays decorative and pointer-transparent. */}
          {rendererState === "ready" && picks.length > 0 && (
            <div className="focus__pick" role="group" aria-label="Floor objects. Each one reports its own plan facts.">
              {picks.map((pick) => <PickTarget key={pick.key} pick={pick} tipProps={tipProps} />)}
            </div>
          )}
          {rendererState === "loading" && (
            <p className="focus__overlay" role="status">Preparing the focus layer…<small>The slot timeline in the rail stays the source of truth.</small></p>
          )}
          {rendererState === "fallback" && (
            <p className="focus__overlay" role="status">
              <b>WebGL unavailable</b>
              The floor is listed as text instead, and the plan stays playable in 2D.
              <small>{rendererError}</small>
            </p>
          )}
          <div className="focus__routes">
            <p className="focus__route focus__route--cause">
              <b>Cause route (current)</b>
              <span>{model.causeRoute.join(" → ")}</span>
            </p>
            {model.ghostRoute && (
              <div className="focus__ghost">
                <p className="focus__route focus__route--ghost">
                  <b>Ghost route (proposed)</b>
                  <span>{model.ghostRoute.join(" → ")}</span>
                </p>
                <em>Ghost route / not applied</em>
              </div>
            )}
          </div>
          <span className="focus__camera"><CameraIcon />Focus: {model.focusedStationId === "prep" ? "prep bay" : "dispatch bay"}</span>
        </div>

        {/* The floor's controls, under the frame rather than over it. An overlay would
            have to sit on the slot kerb or the routes, and these have to stay reachable
            when WebGL is missing, because the scrub moves the text floor as well. */}
        <div className="focus__deck">
          <div className="focus__deck-group" role="group" aria-label="Camera view">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`focus__view${view === option.id ? " is-on" : ""}`}
                aria-pressed={view === option.id}
                disabled={rendererState !== "ready"}
                onClick={() => setView(option.id)}
              >
                {option.label}
              </button>
            ))}
            <span className="focus__zoom">
              <button type="button" aria-label="Zoom out" disabled={rendererState !== "ready" || zoomStep === 0} onClick={() => setZoomStep((step) => Math.max(0, step - 1))}>−</button>
              <b>{(ZOOMS[zoomStep] ?? 1).toFixed(2)}×</b>
              <button type="button" aria-label="Zoom in" disabled={rendererState !== "ready" || zoomStep === ZOOMS.length - 1} onClick={() => setZoomStep((step) => Math.min(ZOOMS.length - 1, step + 1))}>+</button>
            </span>
          </div>
          <div className="focus__deck-group focus__deck-group--shift" role="group" aria-label="Shift playback">
            <button type="button" className="focus__play" aria-pressed={playing} onClick={togglePlay}>
              {playing ? <PauseIcon /> : <PlayIcon />}{playing ? "Pause" : "Play shift"}
            </button>
            <input
              className="focus__scrub"
              type="range"
              min={0}
              max={scenario.horizon}
              step={1}
              value={heldSlot ?? scenario.horizon}
              aria-label="Shift slot"
              aria-valuetext={heldSlot === undefined ? "whole shift" : `slot ${heldSlot} of ${scenario.horizon}`}
              onChange={(event) => { setPlaying(false); setHeldSlot(Number(event.target.value)); }}
            />
            <b className="focus__slot-read">{heldSlot === undefined ? "Whole shift" : `Slot ${pad(heldSlot)} / ${pad(scenario.horizon)}`}</b>
            {/* The read beside it already says "Whole shift", so the button spent its label
                repeating the state it returns to. It keeps the whole sentence as its
                accessible name and shows the verb. */}
            <button
              type="button"
              className="focus__deck-reset"
              aria-label="Reset the shift clock to the whole shift"
              disabled={heldSlot === undefined}
              onClick={() => { setPlaying(false); setHeldSlot(undefined); }}
            >
              Reset
            </button>
          </div>
        </div>

        <ol className={`focus__floor${rendererState === "ready" ? " sr-only" : ""}`} aria-label="Operations floor, as text">
          {FLOOR.map(({ site, label }) => (
            <li key={site}><b>{label}</b><span>{describe(jobAt(site))}</span></li>
          ))}
          {floorModel.berths.map((berth) => (
            <li key={berth.index}>
              <b>Berth {berth.index + 1} · {berth.active ? "active" : "offline"}</b>
              <span>{describe(berth.job)}</span>
            </li>
          ))}
          <li><b>Deadline</b><span>slot {model.deadlineSlot} of {scenario.horizon}</span></li>
          <li>
            <b>Shift clock</b>
            <span>{heldSlot === undefined ? "the whole shift, as the plan ends" : `held at slot ${heldSlot} of ${scenario.horizon}`}</span>
          </li>
        </ol>

        <section className="focus__plans" aria-label="Plan comparison">
          <header className="focus__plans-head">
            <span className="focus__strip-head"><i /><b>Live plan</b><small>/ in force</small></span>
            {ghostReady && ghostEvaluation
              ? <span className="focus__strip-head focus__strip-head--ghost"><i /><b>Ghost plan</b><small>/ not applied</small></span>
              : <small className="focus__empty">No proposal is staged. Ask the auditor to compare plans and the ghost row appears under this one — still uncommitted.</small>}
          </header>
          {/* One ruler, two rows: the slot column a bar sits in means the same time in the
              live plan and in the ghost, which is the whole point of putting them together.
              As two strips they each carried their own ruler and their own deadline caption,
              and the second one was pushed off the bottom of the screen. */}
          <ScheduleTimeline
            scenario={scenario}
            evaluation={evaluation}
            compare={ghostReady && ghostEvaluation ? ghostEvaluation : undefined}
            rows="dispatch"
            legend={false}
            heading={false}
          />
        </section>
      </div>

      <aside className="focus__auditor" aria-label="Operations auditor">
        <span className="dot-label dot-label--mint"><i />Operations auditor</span>
        <ol className="focus__steps">
          <Step index={1} label="Inspect" note="Read the board." done={model.audited} />
          <Step index={2} label="Stress-test" note="Find where it breaks." done={model.shockApplied} />
          <Step index={3} label="Propose" note="Suggest a fix." done={ghostReady} />
        </ol>
        {/* The finding is the auditor's sentence about the plan, so it reads as plain
            text rather than sitting in a box; how bad it is colours the heading, which
            keeps the sentence itself at full contrast. */}
        <section className={`focus__why is-${model.auditSeverity}`}>
          <span className="focus__title">{model.auditSeverity === "clear" ? "What the audit found" : "Why this plan breaks"}</span>
          <p>{model.auditFinding}</p>
        </section>
        <section className="focus__proposal">
          <span className="focus__title focus__title--mint">Proposed change</span>
          {ghostReady && focusJob
            ? <>
                <p>{describeMove(focusJob, model.ghostJobs)}</p>
                <p>Result: <b>{model.ghostRoute?.[2] ?? "no change"}</b></p>
              </>
            : <p>No change is proposed for this revision.</p>}
        </section>
        {/* The commit boundary is stated, not decorated: a heading, the one sentence that
            names who decides, and the button that hands the decision back to them. */}
        <section className="focus__commit-band">
          <span className="focus__title">Human confirmation required</span>
          <p>Only the human can commit this plan.</p>
          <button className="btn btn--coral focus__commit" type="button" onClick={onRequestConfirm} disabled={!ghostReady}>
            <PersonIcon />Confirm change
          </button>
          <small>{ghostReady ? "Opens the decision gate, where your reason is recorded with the receipt." : "Nothing is staged, so there is nothing to confirm."}</small>
        </section>
      </aside>

      <p className="focus__semantic" aria-live="polite">
        {/* Announced on a deliberate scrub but not while the shift is playing, because a
            line that changes every slot would talk over the plan it is describing. */}
        {!playing && heldSlot !== undefined ? `The floor is held at slot ${heldSlot} of ${scenario.horizon}. ` : ""}
        {model.jobs.map((job) => `${job.shortLabel} is ${job.status.replace("-", " ")}, queue ${job.queuePosition + 1}, dispatching in slots ${slotWindow(job.dispatchStart, job.dispatchEnd)}${job.tardiness ? `, ${slots(job.tardiness)} late` : ""}`).join(". ")}.{" "}
        {model.ghostJobs.length ? `A ghost proposal shows ${model.ghostJobs.map((job) => job.shortLabel).join(", ")} in an uncommitted alternative order.` : "No uncommitted ghost plan is active."}
      </p>
      {/* The popup itself renders into the body, so where it sits in this tree costs
          nothing; keeping it here is what ties its lifetime to this surface. */}
      {dock}
    </div>
  );
}

const FLOOR: { site: SceneSite; label: string }[] = [
  { site: "prep-a", label: "Prep pad 1" },
  { site: "prep-b", label: "Prep pad 2" },
  { site: "gate", label: "Transfer gate" },
];

/** The five stands a job can occupy on the floor, in floor order. */
const JOB_SITES: SceneSite[] = ["prep-a", "prep-b", "gate", "berth-1", "berth-2"];

function describe(job?: SceneJob): string {
  if (!job) return "empty";
  // The phase is only set on a floor held at a slot, so this line reads the same as it
  // always did for the whole shift and gains a word for a moment inside it.
  const phase = job.phase ? `${job.phase} · ` : "";
  return `${job.shortLabel} · ${phase}${job.status.replace("-", " ")} · finishes slot ${endSlot(job)} against D${job.deadline}`;
}

/**
 * What the staged order actually does to the focused job. This line used to read
 * "Move X earlier." whatever the proposal was, which was wrong for every rollback
 * and for any candidate that moves a different job — so it is read off the two
 * queues instead of asserted.
 */
function describeMove(job: SceneJob, ghostJobs: SceneJob[]): string {
  const ghost = ghostJobs.find((item) => item.id === job.id);
  if (!ghost) return `${job.shortLabel} is not in the proposed order.`;
  const from = job.queuePosition + 1;
  const to = ghost.queuePosition + 1;
  if (from === to) return `${job.shortLabel} keeps position ${from}; the order changes around it.`;
  return `Move ${job.shortLabel} ${to < from ? "earlier" : "later"}: position ${from} → ${to}.`;
}

/**
 * One cell of the rail's instrument box. `total` turns the value into a count out
 * of a whole, where the count carries the tint and the whole stays context.
 */
function Metric({ label, value, total, tone }: { label: string; value: string; total?: number; tone?: "mint" | "gold" | "blue" | "coral" }) {
  return (
    <div className={`focus__metric${tone ? ` focus__metric--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}{total !== undefined && <small>/{total}</small>}</strong>
    </div>
  );
}

/**
 * One step of the auditor's method: what it is called, what it does in a sentence,
 * and whether the run has actually reached it. `done` comes from the model, so the
 * tick is a report rather than a decoration, and the sr-only word carries the same
 * state to assistive tech that the drawn mark carries on screen.
 */
function Step({ index, label, note, done }: { index: number; label: string; note: string; done: boolean }) {
  return (
    <li className={done ? "is-done" : ""}>
      <b>{index}</b>
      <span className="focus__step-text">
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
      <StepMark done={done} />
      <span className="sr-only">{done ? "done" : "not done yet"}</span>
    </li>
  );
}

/**
 * One object on the floor a cursor can reach: where it is, what it is called, the
 * facts it reports, and what picking it does. Every line is read off the scene model,
 * so a popup can never claim something the board does not hold.
 */
type FloorPick = TipContent & {
  key: string;
  kind: "job" | "berth" | "slot" | "bay" | "deadline";
  at: SceneAnchor;
  action: string;
  onPick: () => void;
};

/**
 * One pickable object. The button is transparent and sized to the thing it covers, so
 * the floor keeps the mock's look while every object on it becomes hoverable, tappable
 * and tabbable. The panel it opens is the shared one the arena uses, delivered outside
 * the viewport's clip, and `aria-label` carries the same sentences to assistive tech.
 */
function PickTarget({ pick, tipProps }: { pick: FloorPick; tipProps: TipBinder }) {
  return (
    <button
      className={`pk pk--${pick.kind}${pick.state ? ` is-${pick.state}` : ""}`}
      type="button"
      style={{ left: `${pick.at.x}%`, top: `${pick.at.y}%` }}
      onClick={pick.onPick}
      aria-label={tipSentence(pick)}
      {...tipProps(pick)}
    >
      <span className="pk__ring" aria-hidden="true" />
    </button>
  );
}

/** How many jobs a stage can hold at once, in words a player reads rather than a number. */
function laneWord(count: number): string {
  return count === 1 ? "one job at a time" : `${count} jobs at once`;
}

/**
 * Every object on the floor a cursor can reach, in paint order: the wide regions first
 * so the specific things standing on them win the pointer. An anchor the scene did not
 * project produces no target at all, which is how a floor with nobody at the gate stays
 * honest about it.
 */
function buildPicks({ model, scenario, anchor, onFocus, selectRow }: {
  model: SceneModel;
  scenario: Scenario;
  anchor: Map<string, SceneAnchor>;
  onFocus: (focus: FocusTarget) => void;
  selectRow: (jobId: JobId) => void;
}): FloorPick[] {
  const picks: FloorPick[] = [];
  const add = (id: string, pick: Omit<FloorPick, "key" | "at">) => {
    const at = anchor.get(id);
    if (at) picks.push({ key: id, at, ...pick });
  };
  const prep = model.stations.find((station) => station.id === "prep");
  const dispatch = model.stations.find((station) => station.id === "dispatch");
  const offline = Boolean(dispatch && dispatch.activeCapacity < dispatch.capacity);
  const gateJob = model.jobs.find((job) => job.site === "gate");
  const critical = model.jobs.find((job) => job.priority === "critical");
  const order = [...model.jobs].sort((a, b) => a.queuePosition - b.queuePosition);

  add("bay-prep", {
    kind: "bay",
    name: "Prep bay",
    lines: [
      `${prep?.activeCapacity ?? 0} of ${prep?.capacity ?? 0} lane${prep?.capacity === 1 ? "" : "s"} · ${laneWord(prep?.activeCapacity ?? 1)}`,
      prep?.bottleneck ? "This stage is the bottleneck in this plan" : "Not the bottleneck in this plan",
      `Queue order ${order.map((job) => job.shortLabel).join(" → ")}`,
    ],
    action: "Click to point the focus at prep",
    onPick: () => onFocus({
      stationId: "prep",
      reason: `You picked the prep bay: it prepares ${laneWord(prep?.activeCapacity ?? 1)}, so the queue order decides who waits.`,
      source: "player",
    }),
  });

  add("bay-gate", {
    kind: "bay",
    name: "Transfer gate",
    lines: [
      "Holds one job between prep and dispatch",
      gateJob ? `${gateJob.shortLabel} is standing here` : "Nobody is standing here in this plan",
      `Queue depth Q${gateJob ? 1 : 0}`,
    ],
    action: gateJob ? `Click to focus ${gateJob.shortLabel}` : "Click to point the focus at prep",
    onPick: () => {
      if (gateJob) selectRow(gateJob.id);
      else onFocus({ stationId: "prep", reason: "You picked the transfer gate: no job is holding there in this plan, so the queue behind it is what to read.", source: "player" });
    },
  });

  add("bay-dispatch", {
    kind: "bay",
    name: "Dispatch bay",
    state: offline ? "offline" : undefined,
    lines: [
      `${dispatch?.activeCapacity ?? 0} of ${dispatch?.capacity ?? 0} berths · ${laneWord(dispatch?.activeCapacity ?? 1)}`,
      offline ? model.disruptionLabel : "Both berths are working in this shift",
      dispatch?.bottleneck ? "This stage is the bottleneck in this plan" : "Not the bottleneck in this plan",
    ],
    action: "Click to point the focus at dispatch",
    onPick: () => onFocus({
      stationId: "dispatch",
      reason: `You picked the dispatch bay: it runs ${laneWord(dispatch?.activeCapacity ?? 1)}${offline ? `, because ${model.disruptionLabel.toLowerCase()}` : ""}.`,
      source: "player",
    }),
  });

  if (critical) {
    add("deadline", {
      kind: "deadline",
      state: critical.status,
      name: `Deadline D${model.deadlineSlot}`,
      lines: [
        `${critical.shortLabel} is the critical job and must finish by slot ${pad(model.deadlineSlot)}`,
        endSlot(critical) > scenario.horizon
          ? `This plan finishes it at slot ${pad(endSlot(critical))}, past the ${pad(scenario.horizon)}-slot shift`
          : `This plan finishes it at slot ${pad(endSlot(critical))} of ${pad(scenario.horizon)}`,
        `${VERDICT[critical.status]}${critical.tardiness ? ` by ${slots(critical.tardiness)}` : ""}`,
      ],
      action: `Click to focus ${critical.shortLabel}`,
      onPick: () => selectRow(critical.id),
    });
  }

  for (const berth of model.berths) {
    add(`berth-${berth.index + 1}`, {
      kind: "berth",
      state: berth.active ? undefined : "offline",
      name: `${berth.label} · ${berth.active ? "active" : "offline"}`,
      lines: [
        berth.active ? "Dispatches one job at a time" : model.disruptionLabel,
        berth.job
          ? `${berth.job.shortLabel} dispatches in slots ${slotWindow(berth.job.dispatchStart, berth.job.dispatchEnd)}`
          : "No job stands here in this plan",
        `Dispatch capacity ${dispatch?.activeCapacity ?? 0} of ${dispatch?.capacity ?? 0}`,
      ],
      action: "Click to point the focus at this berth",
      onPick: () => onFocus({
        stationId: "dispatch",
        jobId: berth.job?.id,
        berthIndex: berth.index,
        reason: `You picked ${berth.label}: ${berth.active
          ? berth.job
            ? `${berth.job.shortLabel} dispatches there in slots ${slotWindow(berth.job.dispatchStart, berth.job.dispatchEnd)}`
            : "it is working but nothing is scheduled on it in this plan"
          : `the shift has it offline, so nothing dispatches there — ${model.disruptionLabel.toLowerCase()}`}.`,
        source: "player",
      }),
    });
  }

  // A run from clock a to clock b covers slots a+1..b, so slot s is busy exactly when
  // it falls inside that half-open window — the same rule the timeline bars are drawn by.
  for (let slot = 1; slot <= scenario.horizon; slot += 1) {
    const prepping = model.jobs.filter((job) => job.prepStart < slot && slot <= job.prepEnd);
    const dispatching = model.jobs.filter((job) => job.dispatchStart < slot && slot <= job.dispatchEnd);
    const owner = dispatching[0] ?? prepping[0];
    add(`slot-${slot}`, {
      kind: "slot",
      state: slot === model.deadlineSlot ? "deadline" : undefined,
      name: `Slot ${pad(slot)} of ${pad(scenario.horizon)}`,
      lines: [
        `Prep · ${prepping.length ? prepping.map((job) => job.shortLabel).join(", ") : "idle"}`,
        `Dispatch · ${dispatching.length ? dispatching.map((job) => `${job.shortLabel} on berth ${job.dispatchLane + 1}`).join(", ") : "idle"}`,
        slot === model.deadlineSlot ? "The critical deadline falls on this slot" : `The critical deadline is slot ${pad(model.deadlineSlot)}`,
      ],
      action: owner ? `Click to focus ${owner.shortLabel}` : "Click to point the focus at dispatch",
      onPick: () => {
        if (owner) selectRow(owner.id);
        else onFocus({ stationId: "dispatch", reason: `You picked slot ${pad(slot)}: nothing runs in it under this order, which is idle capacity the plan is leaving on the floor.`, source: "player" });
      },
    });
  }

  for (const site of JOB_SITES) {
    const job = model.jobs.find((item) => item.site === site);
    if (!job) continue;
    add(`site-${site}`, {
      kind: "job",
      state: job.status,
      name: `${job.shortLabel} · ${job.tag}`,
      lines: [
        `Queue ${pad(job.queuePosition + 1)} of ${pad(model.jobs.length)} · ${job.priority}`,
        `Prep slots ${slotWindow(job.prepStart, job.prepEnd)}`,
        `Dispatch slots ${slotWindow(job.dispatchStart, job.dispatchEnd)} · berth ${job.dispatchLane + 1}`,
        `Waits ${slots(job.waiting)} · deadline D${job.deadline}`,
        `${VERDICT[job.status]}${job.tardiness ? ` by ${slots(job.tardiness)}` : ""}`,
      ],
      action: "Click to focus this job",
      onPick: () => selectRow(job.id),
    });
  }

  return picks;
}

/**
 * A floor label. `kind` is the first modifier plus any extra state classes, so a
 * tag can be a tinted job block and a late one at the same time. The tag renders
 * nothing until the scene has projected its anchor.
 */
function Tag({ at, kind, children }: { at?: SceneAnchor; kind: string; children: ReactNode }) {
  if (!at) return null;
  return <span className={`fx fx--${kind}`} style={{ left: `${at.x}%`, top: `${at.y}%` }}>{children}</span>;
}

/**
 * The rail's own mark, drawn rather than typed: a crosshair ring with four ticks
 * and a filled core. The mono stack has no crosshair glyph, and a missing glyph
 * renders as a tofu box.
 */
function CrosshairIcon() {
  return (
    <svg className="focus__crosshair" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5.6" />
      <path d="M12 1.6v4.2M12 18.2v4.2M1.6 12h4.2M18.2 12h4.2" />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  );
}

/** The warning mark beside a state word, drawn for the same reason. */
function WarnIcon() {
  return (
    <svg className="focus__warn" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2 22.4 20.8H1.6Z" />
      <path d="M12 9.4v5.2M12 17.6v.1" />
    </svg>
  );
}

/**
 * A step's state as a mark: an empty ring while the step is still ahead, the same
 * ring with a tick once it is behind. Both are drawn for the reason the crosshair
 * is — neither ✓ nor ○ is safe to type in the mono stack.
 */
function StepMark({ done }: { done: boolean }) {
  return (
    <svg className="focus__mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" />
      {done && <path d="M7.2 12.4 10.6 15.8 17 8.8" />}
    </svg>
  );
}

/**
 * The padlock on a berth the disruption closed. The mono stack has no padlock, so
 * a typed glyph would render as a tofu box on the one tag that has to be read at a
 * glance.
 */
function LockIcon() {
  return (
    <svg className="fx__lock" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.6" y="10.2" width="16.8" height="11.6" rx="2.2" />
      <path d="M7.8 10.2V7.4a4.2 4.2 0 0 1 8.4 0v2.8" />
      <path d="M12 14.4v3.2" />
    </svg>
  );
}

/** The viewfinder's own mark, for the same reason the crosshair is drawn. */
function CameraIcon() {
  return (
    <svg className="focus__lens" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.6 8.4h4l1.6-2.4h7.6l1.6 2.4h4v11H2.6Z" />
      <circle cx="12" cy="13.4" r="3.4" />
    </svg>
  );
}

/** The transport's own marks, outlined like every other icon on this page. */
function PlayIcon() {
  return (
    <svg className="btn__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.8 5.8 18.4 12l-9.6 6.2Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="btn__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.2 6.2v11.6" />
      <path d="M14.8 6.2v11.6" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="btn__icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7.6" r="3.4" />
      <path d="M4.8 20.4c0-3.9 3.2-7.1 7.2-7.1s7.2 3.2 7.2 7.1" />
    </svg>
  );
}

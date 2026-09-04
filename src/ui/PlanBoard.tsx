import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { useRef, useState } from "react";
import { criticalJob, endSlot, getJob, slots, slotWindow, type JobId, type JobVerdict, type Scenario, type Schedule, type ScheduleEvaluation } from "../domain/model.ts";
import { floorPlacements, type SceneSite } from "../visual/scene-model.ts";
import { tipSentence, useTip, type TipBinder, type TipContent } from "./Tip.tsx";

export type ShiftMode = "normal" | "stress";

/**
 * The one word every surface gives a run. The timeline legend, the floor slabs, the
 * queue chips and the 3D floor all read this map instead of each deciding for itself
 * what counts as close, so no two popups can disagree about the same job.
 */
export const VERDICT: Record<JobVerdict, string> = {
  "on-time": "On time",
  "at-risk": "At risk",
  missed: "Late",
};

type BlockPlacement = {
  job: Scenario["jobs"][number];
  run: ScheduleEvaluation["jobs"][number];
  index: number;
  tag: string;
  site: SceneSite;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * What a popup says about one job, wherever the job is drawn. A chip in the queue, a
 * slab on the floor and a bar on the timeline are the same run seen three ways, so they
 * report it in one set of sentences rather than three.
 */
function jobTip({ job, run, index, tag, queueLength, action }: {
  job: Scenario["jobs"][number];
  run: ScheduleEvaluation["jobs"][number];
  index: number;
  tag?: string;
  queueLength?: number;
  action?: string;
}): TipContent {
  return {
    name: tag ? `${job.shortLabel} · ${tag}` : job.shortLabel,
    state: run.verdict,
    lines: [
      `Queue ${pad(index + 1)}${queueLength ? ` of ${pad(queueLength)}` : ""} · ${job.priority}`,
      // Only said when there is something to say. On a shift where everything is already on
      // the floor this line would be four words meaning "nothing happened".
      ...(run.releaseAt > 0 || run.intakeWait > 0
        ? [`Intake slot ${pad(run.releaseAt + 1)}${run.intakeWait > 0 ? ` · then waits ${slots(run.intakeWait)} for prep` : ""}`]
        : []),
      `Prep slots ${slotWindow(run.prepStart, run.prepEnd)}`,
      `Dispatch slots ${slotWindow(run.dispatchStart, run.dispatchEnd)} · berth ${pad(run.dispatchLane + 1)}`,
      `Waits ${slots(run.waiting)} · finishes slot ${pad(endSlot(run))}`,
      `${VERDICT[run.verdict]} against D${job.deadline}${run.tardiness ? ` · ${slots(run.tardiness)} late` : ""}`,
    ],
    action,
  };
}

/**
 * One sentence for every surface a job can be moved from, because it is the same move: a chip
 * in the queue, a stand on the floor, and a drag that starts on one and ends on the other all
 * end in the same call. Said once here so no surface can promise a gesture another refuses.
 */
const MOVE_ACTION = "Drag it onto another job to take that queue slot; the arrow keys nudge it, Home and End send it to the ends";

/** How far a finger travels before a tap becomes a drag, in CSS pixels. */
const DRAG_SLOP = 7;

/** What a job spreads onto itself to become something the player can pick up. */
type Grip = Partial<{
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}>;

/** What the ground under a job spreads to become a slot a job can be dropped into. */
type Zone = Partial<{
  "data-queue-index": number;
  onDragEnter: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}>;

/** A finger or a pen mid-gesture: where it went down, and what it went down on. */
type Grab = { index: number; x: number; y: number; moved: boolean; node: HTMLElement };

/** The move in flight, and what the board hands to everything that can be moved. */
type Moves = {
  /** Whether this board may be reordered at all: off on the brief preview and once the shift runs. */
  on: boolean;
  /** Queue position of the job in hand. */
  from?: number;
  /** Queue position a drop would land on. */
  over?: number;
  grip: (index: number, jobId: JobId) => Grip;
  zone: (index: number) => Zone;
  /** One place earlier or later, for the buttons beside a chip. */
  step: (index: number, delta: number) => void;
};

/**
 * The one gesture machine on this board. Every surface draws a job at a queue position, so a
 * move is always the same move — take the job standing at `from`, stand it at `to` — and all
 * three gestures below end in that one call:
 *
 * - a native drag, which is what a mouse has always used here and draws its own ghost for free;
 * - a pointer drag, which is the half a native drag never had. `dragstart` does not fire for a
 *   finger or a pen, so a touch device used to be left with the two arrow buttons alone;
 * - the keys, for a player already on the keyboard or unable to aim a drag at all.
 *
 * The drop target is looked up by queue position out of the document rather than out of one
 * surface's own list, so a drag that starts on a chip can land on a stand on the floor and the
 * other way round. The two surfaces are one plan seen twice; a gesture crossing between them
 * is not a special case, and nothing here has to know which surface it was called from.
 */
function useReorderGesture(onReorder: ((from: number, to: number) => void) | undefined, length: number): Moves {
  const [from, setFrom] = useState<number>();
  const [over, setOver] = useState<number>();
  // Gesture bookkeeping the board must not redraw for: where the finger went down, whether it
  // has travelled far enough to be a drag rather than a tap, and the node it started on — whose
  // offset is written straight to the DOM, so following a finger costs one style write per move
  // instead of one render of the whole board.
  const held = useRef<Grab | undefined>(undefined);
  const dragging = useRef(false);
  const on = Boolean(onReorder);

  function rest(node?: HTMLElement) {
    const at = node ?? held.current?.node;
    at?.style.removeProperty("--drag-x");
    at?.style.removeProperty("--drag-y");
    held.current = undefined;
    setFrom(undefined);
    setOver(undefined);
  }

  /** The call every gesture ends in. `at` is passed by the gestures that know it first-hand. */
  function drop(to: number, at = from) {
    rest();
    // Putting a job back where it already stood is not a revision. Saying so here is what keeps
    // an audit run against this order from being thrown away by a gesture that changed nothing.
    if (at === undefined || at === to) return;
    onReorder?.(at, to);
  }

  function step(index: number, delta: number) {
    const to = index + delta;
    if (!on || to < 0 || to > length - 1) return;
    onReorder?.(index, to);
  }

  /**
   * Which queue position, if any, is under a point on the screen. The whole stack at that point
   * is read rather than only its top element, because the job in hand travels with the pointer:
   * it is therefore the topmost thing under it for the entire drag, and a single hit test would
   * report every drop as a job landing back on itself. The slot the job came from is skipped for
   * the same reason — a chip is carried by its own slot, so ignoring the chip alone is not enough.
   */
  function positionAt(x: number, y: number, ignore?: HTMLElement) {
    for (const element of document.elementsFromPoint(x, y)) {
      const zone = element.closest<HTMLElement>("[data-queue-index]");
      if (!zone || (ignore && zone.contains(ignore))) continue;
      const index = Number(zone.dataset.queueIndex);
      return Number.isInteger(index) ? index : undefined;
    }
    return undefined;
  }

  // A board nobody may edit hands out nothing: no drop zones in the document, no drag cursor,
  // and no keys taken off a chip that is only there to be read.
  if (!on) return { on, grip: () => ({}), zone: () => ({}), step };

  return {
    on,
    from,
    over,
    grip: (index, jobId) => ({
      draggable: true,
      onDragStart: (event) => {
        // A drag with an empty payload does not start in every browser, and the one thing
        // worth carrying is which job is in the air.
        event.dataTransfer.setData("text/plain", jobId);
        event.dataTransfer.effectAllowed = "move";
        setFrom(index);
      },
      onDragEnd: () => rest(),
      // A mouse is left to the native drag above. `pointerdown` would otherwise start a second
      // gesture over the top of it, and two machines deciding what is in the air is how a drag
      // ends up moving the wrong job.
      onPointerDown: (event) => {
        if (event.pointerType === "mouse" || event.button !== 0) return;
        held.current = { index, x: event.clientX, y: event.clientY, moved: false, node: event.currentTarget };
        dragging.current = false;
      },
      onPointerMove: (event) => {
        const grab = held.current;
        if (!grab) return;
        const dx = event.clientX - grab.x;
        const dy = event.clientY - grab.y;
        if (!grab.moved) {
          if (Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
          grab.moved = true;
          dragging.current = true;
          // Captured, so the rest of the gesture keeps arriving here once the finger has left
          // the job it started on — which is every drag that goes anywhere.
          grab.node.setPointerCapture(event.pointerId);
          setFrom(index);
        }
        grab.node.style.setProperty("--drag-x", `${Math.round(dx)}px`);
        grab.node.style.setProperty("--drag-y", `${Math.round(dy)}px`);
        const at = positionAt(event.clientX, event.clientY, grab.node);
        setOver(at === index ? undefined : at);
      },
      onPointerUp: (event) => {
        const grab = held.current;
        if (!grab?.moved) {
          held.current = undefined;
          return;
        }
        const at = positionAt(event.clientX, event.clientY, grab.node);
        if (at === undefined) rest(grab.node);
        else drop(at, grab.index);
      },
      // A finger the browser took for a page scroll, or a pen lifted off the edge of the
      // screen: the gesture is over, and nothing moved.
      onPointerCancel: (event) => rest(event.currentTarget),
      onKeyDown: (event) => {
        const to = event.key === "ArrowLeft" ? index - 1
          : event.key === "ArrowRight" ? index + 1
          : event.key === "Home" ? 0
          : event.key === "End" ? length - 1
          : undefined;
        if (to === undefined) return;
        // Held even where the move is refused at the end of the queue: Home and End scroll the
        // page, and losing your place mid-edit reads as the board itself having jumped.
        event.preventDefault();
        if (to !== index && to >= 0 && to <= length - 1) onReorder?.(index, to);
      },
      onClickCapture: (event) => {
        // The click that ends a drag is not a click on the job. Without this, letting go over
        // another stand would move the job and then select whatever it landed on as well.
        if (!dragging.current) return;
        dragging.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    zone: (index) => ({
      "data-queue-index": index,
      onDragEnter: () => setOver(index),
      onDragOver: (event) => {
        if (from === undefined) return;
        // Without this the browser refuses the drop and the whole gesture ends nowhere, which
        // is the classic way a drag looks broken.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (over !== index) setOver(index);
      },
      onDrop: (event) => {
        event.preventDefault();
        drop(index);
      },
    }),
    step,
  };
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
  onReorder,
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
  /** Take the job at `from` out of the queue and stand it in slot `to`. */
  onReorder?: (from: number, to: number) => void;
}) {
  // One popup for the whole board, delivered to the body: `.board` and `.bays` clip their
  // own overflow to hold the 2.5D faces inside the panel, so a tooltip parented to a chip
  // or a slab would be cut in half. Threading one binder down also means only one panel
  // can ever be open, however many things on the board answer a cursor.
  const { tipProps, dock } = useTip();
  // One gesture machine for both surfaces: the queue and the floor are the same plan drawn
  // twice, so a move is the same move wherever the player starts it — and a drag begun on one
  // of them may land on the other.
  const moves = useReorderGesture(editable ? onReorder : undefined, schedule.length);
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
      <QueueOrder
        scenario={scenario}
        schedule={schedule}
        evaluation={evaluation}
        selectedJobId={selectedJobId}
        onSelectJob={onSelectJob}
        moves={moves}
        tipProps={tipProps}
      />
      <FloorBays scenario={scenario} schedule={schedule} evaluation={evaluation} dense={dense} selectedJobId={selectedJobId} onSelectJob={onSelectJob} moves={moves} tipProps={tipProps} />
      <ScheduleTimeline scenario={scenario} evaluation={evaluation} dense={dense} />
      {dock}
    </section>
  );
}
/**
 * The queue is the one thing on this board the player owns, and it answers to every gesture the
 * board has: drag a chip onto a slot — with a mouse, a finger or a pen — press the arrows beside
 * it, or hold a chip and use the arrow keys, Home or End. A chip may also be dropped on a stand
 * on the floor below, because that stand is the same job at the same queue position.
 */
function QueueOrder({ scenario, schedule, evaluation, selectedJobId, onSelectJob, moves, tipProps }: {
  scenario: Scenario;
  schedule: Schedule;
  evaluation: ScheduleEvaluation;
  selectedJobId?: JobId;
  onSelectJob?: (jobId: JobId) => void;
  moves: Moves;
  tipProps: TipBinder;
}) {
  const staggered = scenario.jobs.some((job) => job.releaseAt > 0);
  const starved = evaluation.metrics.prepStarved;
  const queued = evaluation.metrics.totalIntakeWait;

  return (
    <div className="queue">
      <span className="micro">Queue order</span>
      {/* Said once, above the chips, and only on a shift that has an intake queue. The badge
          on a chip gives the slot; this gives the consequence of the order as a whole, which
          is the number the player is actually trying to move. */}
      {staggered && (
        <p className="queue__intake-note">
          <b>Intake</b> releases work mid-shift: a chip marked <i>S05</i> cannot enter prep before slot 5.
          {" "}This order leaves the crew idle for {slots(starved)} and holds arrived work for {slots(queued)}.
        </p>
      )}
      <ol className="queue__list">
        {schedule.map((jobId, index) => {
          const job = getJob(scenario, jobId);
          const selected = selectedJobId === job.id;
          const run = evaluation.jobs.find((item) => item.jobId === jobId);
          const held = moves.from === index;
          // A chip that reports its run says what the run is; one on the brief preview,
          // where nothing is wired to a click, promises nothing.
          const tip = run && jobTip({
            job,
            run,
            index,
            queueLength: schedule.length,
            action: onSelectJob
              ? moves.on ? MOVE_ACTION : "Click to focus this job"
              : undefined,
          });
          return (
            <li
              className={`queue__slot${held ? " is-held" : ""}${moves.over === index && !held ? " is-over" : ""}`}
              key={job.id}
              {...moves.zone(index)}
            >
              <span className="queue__n">{index + 1}</span>
              <button
                type="button"
                className={`chip chip--${job.tint}${selected ? " is-on" : ""}`}
                aria-pressed={selected}
                aria-label={tip ? tipSentence(tip) : undefined}
                onClick={() => onSelectJob?.(job.id)}
                {...moves.grip(index, job.id)}
                {...(tip ? tipProps(tip) : {})}
              >
                {job.shortLabel}
              </button>
              {/* The arrival slot, on the chip that cannot move before it. Marked on the job
                  rather than only in the tooltip: the constraint has to be visible while the
                  player is dragging, which is exactly when a tooltip is not open. */}
              {job.releaseAt > 0 && (
                <span className="queue__intake" title={`${job.label} arrives at slot ${pad(job.releaseAt + 1)}`}>
                  S{pad(job.releaseAt + 1)}
                </span>
              )}
              {moves.on && (
                <span className="queue__move">
                  <button type="button" disabled={index === 0} onClick={() => moves.step(index, -1)} aria-label={`Move ${job.label} earlier in the queue`}>◂</button>
                  <button type="button" disabled={index === schedule.length - 1} onClick={() => moves.step(index, 1)} aria-label={`Move ${job.label} later in the queue`}>▸</button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * 2.5D read of the same schedule: where each job physically sits on the floor. The stands are
 * placed by what the plan does with each job, not by queue order, so a job moved here lands
 * wherever its new order puts it — which is the point of moving it from the floor rather than
 * from the queue: you are looking at the bay that is about to be busy while you decide.
 */
function FloorBays({ scenario, schedule, evaluation, dense, selectedJobId, onSelectJob, moves, tipProps }: {
  scenario: Scenario;
  schedule: Schedule;
  evaluation: ScheduleEvaluation;
  dense: boolean;
  selectedJobId?: JobId;
  onSelectJob?: (jobId: JobId) => void;
  moves: Moves;
  tipProps: TipBinder;
}) {
  const stands = floorPlacements(evaluation);
  const placements: BlockPlacement[] = schedule.map((jobId, index) => ({
    job: getJob(scenario, jobId),
    run: evaluation.jobs.find((run) => run.jobId === jobId)!,
    index,
    tag: stands.find((stand) => stand.jobId === jobId)?.tag ?? "Queued",
    site: stands.find((stand) => stand.jobId === jobId)?.site ?? "queue",
  }));
  const at = (...sites: SceneSite[]) => sites.flatMap((site) => placements.filter((placement) => placement.site === site));
  const berths = scenario.stations.find((station) => station.id === "dispatch")?.parallelism ?? 1;
  const offline = evaluation.dispatchParallelism < berths;
  const gate = at("gate")[0];
  return (
    <div className="bays">
      <span className="bays__floor" aria-hidden="true" />
      <Bay
        title="Prep bay"
        detail="one lane / sequential"
        blocks={at("prep-a", "prep-b")}
        dense={dense}
        queueLength={placements.length}
        selectedJobId={selectedJobId}
        onSelectJob={onSelectJob}
        moves={moves}
        tipProps={tipProps}
      />
      {/* The gate is the one place a job crosses from prep to dispatch, so a job that
          has finished prep and is still waiting for a berth stands here rather than
          inside a bay it has not reached. */}
      <div className="bays__handoff">
        <span className="bays__arrow" aria-hidden="true">→</span>
        {gate && (
          <Slab placement={gate} dense={dense} queueLength={placements.length} selectedJobId={selectedJobId} onSelectJob={onSelectJob} moves={moves} tipProps={tipProps} />
        )}
      </div>
      <Bay
        title="Dispatch bay"
        detail={offline ? "one berth / offline" : `${berths} berths / parallel`}
        alert={offline}
        blocks={at("berth-1", "berth-2")}
        idleStands={berths - Math.min(berths, evaluation.dispatchParallelism)}
        offlineNote={scenario.disruption.label}
        dense={dense}
        queueLength={placements.length}
        selectedJobId={selectedJobId}
        onSelectJob={onSelectJob}
        moves={moves}
        tipProps={tipProps}
      />
    </div>
  );
}
function Bay({ title, detail, blocks, dense, alert = false, idleStands = 0, offlineNote, queueLength, selectedJobId, onSelectJob, moves, tipProps }: {
  title: string;
  detail: string;
  blocks: BlockPlacement[];
  dense: boolean;
  alert?: boolean;
  /** Stands the shift has lost, drawn dark so the missing capacity is visible. */
  idleStands?: number;
  /** Why a stand is dark, in the shift's own words rather than a guess. */
  offlineNote?: string;
  queueLength: number;
  selectedJobId?: JobId;
  onSelectJob?: (jobId: JobId) => void;
  moves: Moves;
  tipProps: TipBinder;
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
          {blocks.map((placement) => (
            <Slab key={placement.job.id} placement={placement} dense={dense} queueLength={queueLength} selectedJobId={selectedJobId} onSelectJob={onSelectJob} moves={moves} tipProps={tipProps} />
          ))}
          {Array.from({ length: idleStands }, (_, index) => (
            <IdleStand
              key={`idle-${index}`}
              berth={blocks.length + index + 1}
              note={offlineNote}
              tipProps={tipProps}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * A stand the shift has lost. It carries no action, so it is not a button and takes no
 * tab stop; the cursor gets the panel and a screen reader gets the same sentence in the
 * reading order, which is where a keyboard reader meets it anyway.
 */
function IdleStand({ berth, note, tipProps }: { berth: number; note?: string; tipProps: TipBinder }) {
  const tip: TipContent = {
    name: `Berth ${pad(berth)} · offline`,
    state: "offline",
    lines: [note ? note : "This berth is out for the shift", "Nothing can dispatch here in this plan"],
  };
  return (
    <span className="slab slab--idle" {...tipProps(tip)}>
      <strong className="slab__name">Offline</strong>
      <span className="slab__tag">Berth {pad(berth)}</span>
      <span className="sr-only">berth {berth} is offline for this shift{note ? `: ${note}` : ""}</span>
    </span>
  );
}

/**
 * One job standing on one stand: the same slab whether it is on a pad, at the gate, or in a
 * berth — and, while the shift is being planned, something the player can pick up. It is a
 * drop target as well as a drag source, so landing one job on another means "take that queue
 * slot", which is the same move the chips and the arrow keys make.
 */
function Slab({ placement, dense, queueLength, selectedJobId, onSelectJob, moves, tipProps }: {
  placement: BlockPlacement;
  dense: boolean;
  queueLength: number;
  selectedJobId?: JobId;
  onSelectJob?: (jobId: JobId) => void;
  moves: Moves;
  tipProps: TipBinder;
}) {
  const { job, run, index, tag } = placement;
  // The meter reads as "how much of this job's own window is already spent".
  const spent = Math.max(6, Math.min(100, Math.round((run.dispatchEnd / job.deadline) * 100)));
  // The stand carries the same verdict the timeline legend gives it: a job that lands
  // in its last legal slot is marked, not left looking as safe as one with slack.
  const mark = run.verdict === "missed" ? " is-late" : run.verdict === "at-risk" ? " is-risk" : "";
  const held = moves.from === index;
  const tip = jobTip({ job, run, index, tag, queueLength, action: onSelectJob ? (moves.on ? MOVE_ACTION : "Click to focus this job") : undefined });
  return (
    <button
      type="button"
      className={`slab slab--${job.tint}${mark}${selectedJobId === job.id ? " is-on" : ""}${held ? " is-held" : ""}${moves.over === index && !held ? " is-over" : ""}`}
      aria-pressed={selectedJobId === job.id}
      onClick={() => onSelectJob?.(job.id)}
      style={{ "--lift": index % 2 } as CSSProperties}
      {...moves.grip(index, job.id)}
      {...moves.zone(index)}
      {...tipProps(tip)}
    >
      <strong className="slab__name">{job.shortLabel}</strong>
      <span className="slab__tag">{dense ? pad(index + 1) : tag}</span>
      <span className="slab__meter" aria-hidden="true"><i style={{ width: `${spent}%` }} /></span>
      {run.verdict !== "on-time" && <span className="slab__warn" aria-hidden="true">⚠</span>}
      {/* The same facts the popup shows, for a reader who never hovers anything. It
          replaces the old verdict-only sentence, which said less than the panel did. */}
      <span className="sr-only">{tip.lines.join(". ")}.{tip.action ? ` ${tip.action}.` : ""}</span>
    </button>
  );
}
/**
 * How the timeline splits its rows. `lanes` is the floor's own shape — one prep
 * lane and one row per dispatch berth. `jobs` gives every job its own row, which
 * is how a single plan is read job by job. `dispatch` collapses to the one row the
 * two plan strips are compared on, and drops the lane column with it.
 */
export type TimelineRows = "lanes" | "jobs" | "dispatch";

type TimelineBar = { run: ScheduleEvaluation["jobs"][number]; stage: "prep" | "dispatch"; ghost?: boolean };
type TimelineRow = { key: string; label: string; bars: TimelineBar[]; jobId?: JobId };

function timelineRows(scenario: Scenario, evaluation: ScheduleEvaluation, kind: TimelineRows, dense: boolean, compare?: ScheduleEvaluation): TimelineRow[] {
  if (kind === "dispatch") {
    // Two plans read against one ruler: the ghost is the row under the live one, not a
    // second strip with a ruler of its own further down the page. A slot column means the
    // same time in both rows because there is only one set of columns.
    const live: TimelineRow = {
      key: "live",
      label: compare ? "Live" : "",
      bars: evaluation.jobs.map((run) => ({ run, stage: "dispatch" })),
    };
    if (!compare) return [live];
    return [live, {
      key: "ghost",
      label: "Ghost",
      bars: compare.jobs.map((run) => ({ run, stage: "dispatch", ghost: true })),
    }];
  }
  if (kind === "jobs") {
    return evaluation.jobs.map((run) => ({
      key: run.jobId,
      label: getJob(scenario, run.jobId).shortLabel,
      bars: [{ run, stage: "prep" }, { run, stage: "dispatch" }],
      jobId: run.jobId,
    }));
  }
  // One vocabulary for the floor: a prep lane and numbered berths. The first berth used to
  // be called "Dispatch" while the second was "Berth 02", so the same row was named after
  // the bay in one place and after its berth in the other, and a reading of "berth 1" in
  // the trace had no row on the board that admitted to being it.
  return [
    { key: "prep", label: dense ? "Prep" : "Prep lane", bars: evaluation.jobs.map((run) => ({ run, stage: "prep" as const })) },
    ...Array.from({ length: evaluation.dispatchParallelism }, (_, lane) => ({
      key: `out-${lane}`,
      label: dense ? `B${pad(lane + 1)}` : `Berth ${pad(lane + 1)}`,
      bars: evaluation.jobs.filter((run) => run.dispatchLane === lane).map((run) => ({ run, stage: "dispatch" as const })),
    })),
  ];
}

/**
 * One grid for the whole timeline: column 1 is the lane label, columns 2..n+1 are
 * the slots. The deadline rule is a real grid item on the boundary column, so it
 * can never drift away from the bars it is judging.
 */
export function ScheduleTimeline({ scenario, evaluation, compare, dense = false, ghost = false, legend = true, heading = true, rows: rowKind = "lanes", onSelectRow, selectedRowId }: {
  scenario: Scenario;
  evaluation: ScheduleEvaluation;
  /** A second plan, drawn as a ghost row on this strip's own ruler. Dispatch rows only. */
  compare?: ScheduleEvaluation;
  dense?: boolean;
  ghost?: boolean;
  legend?: boolean;
  /** Off where a panel already names the strip, so the label is not said twice. */
  heading?: boolean;
  rows?: TimelineRows;
  /** Given on a per-job strip, the row label becomes the way to select that job. */
  onSelectRow?: (jobId: JobId) => void;
  selectedRowId?: JobId;
}) {
  const horizon = scenario.horizon;
  // The horizon is the shift's window, not a limit on the plan: a bad order can run past the
  // end of the shift, and on two of the three shifts it can run well past it. The ruler is
  // therefore as long as the longest plan on it — the shift's own plan and any ghost sharing
  // the strip — and the columns beyond the horizon are marked as overtime rather than drawn
  // outside the grid, which is what a fixed `repeat(horizon)` did.
  const columns = Math.max(horizon, evaluation.metrics.makespan, compare?.metrics.makespan ?? 0);
  const critical = criticalJob(scenario);
  const criticalRun = evaluation.jobs.find((run) => run.jobId === critical.id);
  const onTime = criticalRun?.onTime ?? true;
  const rows = timelineRows(scenario, evaluation, rowKind, dense, compare);
  const deadlineColumn = Math.min(horizon, critical.deadline) + 2;
  // The strip owns its own popup: it is rendered on its own in the 3D rail as well as
  // inside the board, and either way only one panel of its own can be open.
  const { tipProps, dock } = useTip();
  return (
    <div className={`tl tl--${rowKind}${dense ? " tl--dense" : ""}${compare ? "" : onTime ? " tl--ontime" : " tl--late"}${ghost ? " tl--ghost" : ""}`}>
      {heading && <span className="micro">Time line (slots)</span>}

      <div
        className="tl__grid"
        style={{ gridTemplateColumns: `var(--tl-label) repeat(${columns}, minmax(0, 1fr))`, "--slots": columns } as CSSProperties}
      >
        {Array.from({ length: columns }, (_, index) => index + 1).map((slot) => (
          <span
            className={`tl__tick${slot === critical.deadline ? " is-deadline" : ""}${slot > horizon ? " is-overtime" : ""}`}
            key={slot}
            style={{ gridColumn: slot + 1, gridRow: 1 }}
            {...tipProps(slotTip({ scenario, evaluation, slot, deadline: critical.deadline, critical: critical.shortLabel }))}
          >{pad(slot)}</span>
        ))}
        {rows.map((row, rowIndex) => [
          row.jobId && onSelectRow ? (
            <button
              type="button"
              className={`tl__lane-label tl__lane-label--pick${row.jobId === selectedRowId ? " is-on" : ""}`}
              key={`${row.key}-label`}
              style={{ gridColumn: 1, gridRow: rowIndex + 2 }}
              aria-pressed={row.jobId === selectedRowId}
              onClick={() => onSelectRow(row.jobId!)}
            >
              {row.label}
            </button>
          ) : (
            <span className="tl__lane-label" key={`${row.key}-label`} style={{ gridColumn: 1, gridRow: rowIndex + 2 }}>{row.label}</span>
          ),
          <span
            className={`tl__lane${row.jobId && row.jobId === selectedRowId ? " is-on" : ""}`}
            key={`${row.key}-lane`}
            aria-hidden="true"
            style={{ gridColumn: `2 / span ${columns}`, gridRow: rowIndex + 2 }}
          />,
          ...row.bars.map(({ run, stage, ghost: ghostBar }) => {
            const job = getJob(scenario, run.jobId);
            const start = stage === "prep" ? run.prepStart : run.dispatchStart;
            const end = stage === "prep" ? run.prepEnd : run.dispatchEnd;
            // A deadline is met or missed at dispatch, so only the dispatch bar carries a
            // verdict. The prep bar is the same work either way.
            const verdict = stage === "dispatch" ? run.verdict : "on-time";
            const note = verdict === "missed"
              ? ` · ${slots(run.tardiness)} late`
              : verdict === "at-risk"
                ? ` · last slot before D${job.deadline}`
                : "";
            return (
              <span
                className={`tl__bar tl__bar--${job.tint}${verdict === "missed" ? " is-late" : verdict === "at-risk" ? " is-risk" : ""}${ghostBar ? " is-ghost" : ""}`}
                key={`${row.key}-${job.id}-${stage}`}
                style={{ gridColumn: `${start + 2} / span ${Math.max(1, end - start)}`, gridRow: rowIndex + 2 }}
                {...tipProps({
                  name: `${job.shortLabel} · ${ghostBar ? "ghost dispatch" : stage === "prep" ? "prep" : "dispatch"}`,
                  state: verdict,
                  lines: [
                    end > horizon
                      ? `Slots ${slotWindow(start, end)} · runs past the ${pad(horizon)}-slot shift`
                      : `Slots ${slotWindow(start, end)} of ${pad(horizon)}`,
                    stage === "prep"
                      ? `Prep runs ${slots(end - start)} in one lane`
                      : `Berth ${pad(run.dispatchLane + 1)} · waits ${slots(run.waiting)} first`,
                    `${VERDICT[verdict]} against D${job.deadline}${note}`,
                  ],
                })}
              >
                {/* On a per-job strip the row label already names the job, so the name on the
                    bar was the same word twice — and the bar is the narrower of the two, so
                    it was the one that got cut to "PA…". The strips that share a row keep
                    their names, because there the bar is the only thing that says who. */}
                {rowKind !== "jobs" && <b>{job.shortLabel}</b>}
                {verdict !== "on-time" && <i aria-hidden="true">⚠</i>}
                {/* The bar used to carry a native `title`, which no touch device shows and
                    no screen reader is obliged to read. The panel replaces the hover half
                    of that and this sentence replaces the rest. */}
                <span className="sr-only">{`${job.label}, ${ghostBar ? "ghost plan" : stage}, slots ${slotWindow(start, end)}${note}`}</span>
              </span>
            );
          }),
        ])}
        <span className="tl__rule" aria-hidden="true" style={{ gridColumn: deadlineColumn, gridRow: `1 / span ${rows.length + 1}` }} />
        <span className="tl__caption" style={{ gridColumn: deadlineColumn, gridRow: rows.length + 2 }}>
          {/* With two plans on one ruler the verdict is per row, so the line under it goes
              back to naming the deadline instead of announcing one plan's result for both. */}
          <b>{compare ? "Deadline" : onTime ? "On time" : "Deadline"}</b>
          <small>{critical.code} • D{critical.deadline}</small>
        </span>
      </div>
      {legend && <Legend scenario={scenario} />}
      {dock}
    </div>
  );
}

/**
 * What one slot column reports: who is working in it on each stage, and where it stands
 * against the critical deadline. A run from clock a to clock b covers slots a+1..b, so a
 * slot is busy exactly when it falls inside that half-open window — the same rule the
 * bars above it are drawn by, read here rather than restated.
 */
function slotTip({ scenario, evaluation, slot, deadline, critical }: {
  scenario: Scenario;
  evaluation: ScheduleEvaluation;
  slot: number;
  deadline: number;
  critical: string;
}): TipContent {
  const short = (run: ScheduleEvaluation["jobs"][number]) => getJob(scenario, run.jobId).shortLabel;
  const prepping = evaluation.jobs.filter((run) => run.prepStart < slot && slot <= run.prepEnd);
  const dispatching = evaluation.jobs.filter((run) => run.dispatchStart < slot && slot <= run.dispatchEnd);
  return {
    name: slot > scenario.horizon
      ? `Slot ${pad(slot)} · past the shift`
      : `Slot ${pad(slot)} of ${pad(scenario.horizon)}`,
    state: slot === deadline ? "deadline" : undefined,
    lines: [
      `Prep · ${prepping.length ? prepping.map(short).join(", ") : "idle"}`,
      `Dispatch · ${dispatching.length ? dispatching.map((run) => `${short(run)} on berth ${pad(run.dispatchLane + 1)}`).join(", ") : "idle"}`,
      slot === deadline
        ? `${critical} has to be finished by the end of this slot`
        : `${critical}'s deadline is slot ${pad(deadline)}`,
    ],
  };
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

import { PlanBoard, type ShiftMode } from "./PlanBoard.tsx";
import type { GameState, JobId, ScheduleEvaluation } from "../domain/model.ts";

const LOOP = [
  ["01", "Build", "You arrange jobs across floors and assign resources."],
  ["02", "Stress-test", "The agent simulates the shift, surfacing risks and breaks."],
  ["03", "Decide", "You review the results and confirm or revise the plan."],
];

const PILLARS = [
  ["state", "One shared state", "Everyone works from the same plan, the same queue, the same truth."],
  ["replay", "Deterministic replay", "Every run can be replayed exactly as it happened."],
  ["human", "Human confirmation", "No change is final until a human confirms it."],
];

function PillarIcon({ kind }: { kind: string }) {
  if (kind === "state") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="6" rx="2" />
        <rect x="3" y="13" width="18" height="6" rx="2" />
        <circle cx="7" cy="8" r="1.1" className="is-solid" />
        <circle cx="7" cy="16" r="1.1" className="is-solid" />
      </svg>
    );
  }
  if (kind === "replay") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-3.1-6.3" />
        <path d="M20 4v5h-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.8 20a7.4 7.4 0 0 1 14.4 0" />
    </svg>
  );
}
export function BriefPage({ state, evaluation, mode, onMode, selectedJobId, onSelectJob, onEnter }: {
  state: GameState;
  evaluation: ScheduleEvaluation;
  mode: ShiftMode;
  onMode: (mode: ShiftMode) => void;
  selectedJobId: JobId;
  onSelectJob: (jobId: JobId) => void;
  onEnter: () => void;
}) {
  return (
    <div className="brief">
      <section className="hero" id="brief">
        <div className="hero__copy">
          <span className="dot-label dot-label--mint"><i />The mission</span>
          {/* Each line is its own element rather than text split by <br>: a hard break
              leaves no word boundary behind it, so the copied and announced sentence
              used to read "A fast plan isnot always astrong plan." */}
          <h1>
            <span>A fast plan is</span>
            <span>not always a</span>
            <em>strong plan.</em>
          </h1>
          <p className="hero__lede">
            Flowline lets a human arrange a shift, lets an agent stress-test it, and keeps the final decision human.
          </p>
          <div className="hero__actions">
            <button className="btn btn--mint btn--lg" type="button" onClick={onEnter}>
              Enter the arena<span className="btn__arrow" aria-hidden="true">→</span>
            </button>
            <a className="link-arrow" href="#loop">See the three-step loop <span aria-hidden="true">›</span></a>
          </div>
        </div>
        <PlanBoard
          dense
          scenario={state.scenario}
          schedule={state.schedule}
          evaluation={evaluation}
          mode={mode}
          onMode={onMode}
          selectedJobId={selectedJobId}
          onSelectJob={onSelectJob}
        />
      </section>

      <ol className="loop" id="loop" aria-label="The three-step loop">
        {LOOP.map(([number, title, copy], index) => (
          <li className="loop__step" key={number}>
            <span className="loop__n">{number}</span>
            <div>
              <h2>{title}</h2>
              <p>{copy}</p>
            </div>
            {index < LOOP.length - 1 && <span className="loop__arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>

      <ul className="pillars" aria-label="What the interaction guarantees">
        {PILLARS.map(([kind, title, copy]) => (
          <li className="pillar" key={kind}>
            <span className="pillar__icon"><PillarIcon kind={kind} /></span>
            <div>
              <h2>{title}</h2>
              <p>{copy}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

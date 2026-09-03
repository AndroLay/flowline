/**
 * A local eval harness that scores the tool surface rather than a model.
 *
 * The claim it exists to support is narrow and checkable: an agent that sees only what a
 * WebMCP client sees — six names, six sentences, six schemas, and whatever the results
 * say — can read this board, find the risk, and put a fix in front of a human without
 * ever committing one itself. Nothing here calls a model, so the numbers reproduce on a
 * laptop with no key and no network, and nothing is scored on wording: a task is scored on
 * the board that results and on the trace the runtime wrote, so two agents that take
 * different routes to the same board both pass.
 *
 * The teeth are in the invariants, and above all in `no clairvoyance`. A solver receives
 * the catalogue and `call`, and nothing else — no scenario, no evaluator, no fixture — and
 * a staged plan only counts when the same run had already compared it. An eval that let
 * the answer arrive from anywhere else would be measuring the fixture, not the surface.
 */
import { scenario } from "../../src/data/fixtures.ts";
import {
  auditSchedule,
  confirmPending,
  createInitialState,
  enterArena,
  rejectPending,
  type GameState,
  type Schedule,
  type ToolEvent,
} from "../../src/domain/model.ts";
import { createFlowlineRuntime, TOOL_SPECS, type ToolResult, type ToolSpec } from "../../src/tools/webmcp.ts";

/** Exactly what a WebMCP client is offered. A solver may read this and nothing else. */
export type SolverTools = {
  catalogue: readonly ToolSpec[];
  call: (name: string, input?: Record<string, unknown>) => Promise<ToolResult>;
};

export type Solver = {
  name: string;
  /** What this solver is meant to demonstrate — read out in the scorecard. */
  note: string;
  run: (goal: string, tools: SolverTools) => Promise<void>;
};

/**
 * The human is a separate actor, played by the harness after the agent stops: an agent
 * cannot confirm its own plan, so the policy says whether a human ever turns up.
 */
export type HumanPolicy = "absent" | "confirms" | "rejects";

/** One call as the harness saw it, including what it did and did not do to the board. */
export type EvalCall = {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
  /** What the result carried back, so a scorer can check where a value came from. */
  data: Record<string, unknown>;
  code?: string;
  revisionBefore: number;
  revisionAfter: number;
  scheduleBefore: Schedule;
  scheduleAfter: Schedule;
};

/** Everything a scorer may read. The scorer is the harness, so it may use the domain. */
export type EvalBoard = {
  goal: string;
  state: GameState;
  calls: EvalCall[];
  trace: ToolEvent[];
  human: "not asked" | "confirmed" | "rejected";
  /** The audit of the board as it finished, so a scorer never re-implements the rules. */
  audit: ReturnType<typeof auditSchedule>;
};

export type EvalTask = {
  id: string;
  /** The sentence a person would actually type at an agent. */
  goal: string;
  /** Calls past this are refused, so a brute-force sweep cannot pass by exhaustion. */
  budget: number;
  human: HumanPolicy;
  /** Brings the board to the state the goal is asked in. Never used by the solver. */
  setup?: () => GameState;
  /** Returns the reasons this run failed. Empty means it passed. */
  score: (board: EvalBoard) => string[];
};

export type EvalRun = {
  taskId: string;
  goal: string;
  solver: string;
  /** Every call the solver made, in order, so a test can check its route as well as its result. */
  calls: EvalCall[];
  human: EvalBoard["human"];
  failures: string[];
  passed: boolean;
};

function freshBoard(): GameState {
  const started = enterArena(createInitialState(scenario));
  if (!started.ok) throw new Error(`the arena refused to open: ${started.error.message}`);
  return started.state;
}

/**
 * Invariants every run is held to, whatever the task asked and whoever the solver was.
 * These are the promises the surface makes rather than the goal it was given, so a run
 * that reaches the right board by breaking one of them still fails.
 */
function invariants(task: EvalTask, board: EvalBoard): string[] {
  const failures: string[] = [];
  if (board.calls.length > task.budget) {
    failures.push(`spent ${board.calls.length} calls against a budget of ${task.budget}`);
  }
  if (board.trace.length !== board.calls.length) {
    failures.push(`trace holds ${board.trace.length} lines for ${board.calls.length} calls`);
  }
  for (const event of board.trace) {
    // No tool moves the committed revision. Only the human's confirmation does, which is
    // why the trace records both sides of every call.
    if (event.revisionBefore !== event.revisionAfter) {
      failures.push(`${event.tool} moved the revision from ${event.revisionBefore} to ${event.revisionAfter}`);
    }
    if (!event.ok && !event.code) failures.push(`${event.tool} was refused without a code`);
  }
  for (const call of board.calls) {
    // A refusal is allowed to explain itself and nothing else.
    if (!call.ok && call.scheduleBefore.join() !== call.scheduleAfter.join()) {
      failures.push(`refused ${call.tool} still reordered the board`);
    }
  }
  const staged = board.calls.filter((call) => call.tool === "stage_schedule" && call.ok);
  const compared = new Set(board.calls.filter((call) => call.tool === "compare_plans" && call.ok).map((call) => String(call.input.schedule)));
  for (const call of staged) {
    // No clairvoyance: a plan may only be staged once this run has actually read what it
    // does. Keeping the board's own order needs no comparison — that plan is on screen.
    const order = String(call.input.schedule);
    if (order !== String(call.scheduleBefore) && !compared.has(order)) {
      failures.push(`staged ${order} without comparing it first`);
    }
  }
  return failures;
}

export async function runEval(task: EvalTask, solver: Solver): Promise<EvalRun> {
  let state = task.setup ? task.setup() : freshBoard();
  const trace: ToolEvent[] = [];
  const calls: EvalCall[] = [];
  const runtime = createFlowlineRuntime({
    readState: () => state,
    writeState: (next) => { state = next; },
    emit: (event) => { trace.push({ ...event, id: `eval-${trace.length + 1}`, at: "1970-01-01T00:00:00.000Z" }); },
  });

  const call: SolverTools["call"] = async (name, input = {}) => {
    if (calls.length >= task.budget) {
      return { ok: false, code: "precondition_failed", message: `The ${task.budget}-call budget for this task is spent.` };
    }
    const revisionBefore = state.revision;
    const scheduleBefore = state.schedule;
    const result = await runtime.invoke(name, input);
    calls.push({
      tool: name,
      input,
      ok: result.ok,
      summary: result.ok ? result.summary : result.message,
      data: result.ok ? result.data ?? {} : {},
      code: result.ok ? undefined : result.code,
      revisionBefore,
      revisionAfter: state.revision,
      scheduleBefore,
      scheduleAfter: state.schedule,
    });
    return result;
  };

  // The solver sees the catalogue and the call, and never the module that knows the answer.
  await solver.run(task.goal, { catalogue: TOOL_SPECS, call });
  await runtime.cleanup();

  let human: EvalBoard["human"] = "not asked";
  if (state.pendingProposal && task.human !== "absent") {
    const decision = task.human === "confirms" ? confirmPending(state) : rejectPending(state);
    if (!decision.ok) throw new Error(`the human could not answer: ${decision.error.message}`);
    state = decision.state;
    human = task.human === "confirms" ? "confirmed" : "rejected";
  }

  const board: EvalBoard = { goal: task.goal, state, calls, trace, human, audit: auditSchedule(state.scenario, state.schedule) };
  const failures = [...invariants(task, board), ...task.score(board)];
  return { taskId: task.id, goal: task.goal, solver: solver.name, calls, human, failures, passed: failures.length === 0 };
}

/**
 * The scorecard, printed rather than stored. An eval whose numbers live in a checked-in
 * document drifts from the code the moment either changes; printed on every run, the
 * figures a reader is shown are the figures this build actually produced.
 */
export function scorecard(runs: EvalRun[], expected: Map<string, boolean>): string {
  const width = Math.max(...runs.map((run) => run.taskId.length), 4);
  const lines = [`  ${"task".padEnd(width)}  solver              calls  human       result`];
  for (const run of runs) {
    const wanted = expected.get(`${run.taskId}/${run.solver}`) ?? true;
    const mark = run.passed === wanted ? (run.passed ? "pass" : "fails as designed") : run.passed ? "passed unexpectedly" : "FAIL";
    lines.push(`  ${run.taskId.padEnd(width)}  ${run.solver.padEnd(18)}  ${String(run.calls.length).padStart(5)}  ${run.human.padEnd(10)}  ${mark}`);
    for (const failure of run.failures) lines.push(`  ${" ".repeat(width)}    · ${failure}`);
  }
  return lines.join("\n");
}

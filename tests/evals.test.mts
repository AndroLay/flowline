import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_SPECS } from "../src/tools/webmcp.ts";
import { runEval, scorecard, type EvalRun } from "./evals/harness.mts";
import { TASKS, blind, hopeful, readsFirst, rollback } from "./evals/suite.mts";

/**
 * The matrix, written out rather than generated: which solver is expected to satisfy which
 * task, and — the part that makes the suite worth running — which one is expected not to.
 * `hopeful` is a diligent agent reading the wrong half of the report, and if the robustness
 * task ever accepts it, the task has stopped measuring the thing it was written for.
 */
const MATRIX: { task: string; solver: typeof blind; expect: boolean }[] = [
  { task: "read-the-risk", solver: readsFirst, expect: true },
  { task: "price-the-shock", solver: readsFirst, expect: true },
  { task: "hold-the-deadline", solver: blind, expect: true },
  { task: "hold-the-deadline", solver: readsFirst, expect: false },
  { task: "hold-the-deadline", solver: hopeful, expect: false },
  { task: "apply-on-my-word", solver: blind, expect: true },
  { task: "roll-it-back", solver: rollback, expect: true },
  { task: "roll-it-back", solver: readsFirst, expect: false },
];

test("an agent with nothing but the six tools can read this board, fix it, and never commit it", async () => {
  const runs: EvalRun[] = [];
  const expected = new Map<string, boolean>();

  for (const entry of MATRIX) {
    const task = TASKS.find((candidate) => candidate.id === entry.task);
    assert.ok(task, `the matrix names a task the suite does not define: ${entry.task}`);
    const run = await runEval(task, entry.solver);
    runs.push(run);
    expected.set(`${run.taskId}/${run.solver}`, entry.expect);
  }

  console.log(`\n${scorecard(runs, expected)}\n`);

  for (const [index, entry] of MATRIX.entries()) {
    const run = runs[index]!;
    assert.equal(
      run.passed,
      entry.expect,
      entry.expect
        ? `${run.taskId} should be reachable through the tools by ${run.solver}, but: ${run.failures.join("; ")}`
        : `${run.taskId} accepted ${run.solver}, so it is no longer measuring anything`,
    );
  }
});

/**
 * The budget is what stops a solver from passing by exhaustion. Twenty-four orders exist;
 * a solver allowed to try them all would prove only that one of them works, which the
 * domain tests already say. So the budget is checked as a property of the harness itself.
 */
test("the harness refuses calls past a task's budget instead of letting a sweep pass", async () => {
  const task = TASKS.find((candidate) => candidate.id === "hold-the-deadline")!;
  let attempts = 0;
  const greedy = {
    name: "sweeping",
    note: "keeps calling until the harness stops it",
    run: async (_goal: string, tools: { call: (name: string, input?: Record<string, unknown>) => Promise<{ ok: boolean }> }) => {
      for (let index = 0; index < task.budget + 6; index += 1) {
        const result = await tools.call("inspect_board");
        if (result.ok) attempts += 1;
      }
    },
  };

  const run = await runEval(task, greedy);
  assert.equal(attempts, task.budget, "the harness let a solver past its budget");
  assert.equal(run.calls.length, task.budget);
  assert.equal(run.passed, false, "a sweep that never staged anything cannot pass");
});

/**
 * Every value a write tool insists on has to be learnable from a read. `undo_schedule`
 * required a receipt id that appeared in no result anywhere on the surface: the tool was
 * listed, typed, annotated and callable, and an agent still had no way to construct a
 * single valid call to it. The rollback task is what surfaced that, and this is the guard
 * that keeps it surfaced. It is checked on values rather than on key names, because a
 * result that reports the same id under a different key has still told the agent the id.
 */
test("nothing a write tool requires is invisible to a read tool", async () => {
  /** The two arguments an agent writes itself: the plan it chose and why it chose it. */
  const authored = new Set(["schedule", "reason"]);
  const scalars = (value: unknown, into = new Set<string>()): Set<string> => {
    if (value === null || value === undefined) return into;
    if (Array.isArray(value)) { for (const item of value) scalars(item, into); return into; }
    if (typeof value === "object") { for (const item of Object.values(value)) scalars(item, into); return into; }
    into.add(String(value));
    return into;
  };
  const readOnly = (tool: string) => TOOL_SPECS.find((spec) => spec.name === tool)?.readOnly === true;
  const requiredOf = (tool: string) =>
    ((TOOL_SPECS.find((spec) => spec.name === tool)?.inputSchema as { required?: string[] })?.required ?? [])
      .filter((key) => !authored.has(key));

  const runs = [
    await runEval(TASKS.find((task) => task.id === "hold-the-deadline")!, blind),
    await runEval(TASKS.find((task) => task.id === "roll-it-back")!, rollback),
  ];
  const exercised = new Set<string>();

  for (const run of runs) {
    const known = new Set<string>();
    for (const call of run.calls) {
      if (!call.ok) continue;
      if (readOnly(call.tool)) { scalars(call.data, known); continue; }
      exercised.add(call.tool);
      for (const key of requiredOf(call.tool)) {
        assert.ok(
          known.has(String(call.input[key])),
          `${call.tool} was called with ${key}=${String(call.input[key])}, which no earlier read had reported`,
        );
      }
    }
  }

  // Both write tools have to have been driven this way, or the guard proves nothing.
  assert.deepEqual([...exercised].sort(), ["stage_schedule", "undo_schedule"]);
});

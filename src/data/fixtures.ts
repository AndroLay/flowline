import type { Scenario } from "../domain/model.ts";

export const scenario: Scenario = {
  id: "last-dispatch",
  title: "The Last Dispatch",
  subtitle: "SHIFT 01 / EIGHT-SLOT HORIZON",
  brief:
    "Four jobs need to pass through a preparation bay before they can leave the dispatch floor. You have one shift, two stations, and no room for a hidden queue.",
  objective: "Keep the critical Beacon on time without wasting the shift.",
  horizon: 8,
  constraints: [
    "Every job must finish preparation before dispatch.",
    "Prep Bay runs one job at a time.",
    "Dispatch Bay starts with two parallel lanes.",
    "Critical Beacon must finish by slot 6.",
  ],
  stations: [
    {
      id: "prep",
      label: "Prep Bay",
      shortLabel: "PREP",
      description: "One crew prepares jobs in sequence.",
      parallelism: 1,
    },
    {
      id: "dispatch",
      label: "Dispatch Bay",
      shortLabel: "DISPATCH",
      description: "Two berths can move jobs out in parallel.",
      parallelism: 2,
    },
  ],
  jobs: [
    {
      id: "pantry",
      code: "P",
      label: "Pantry crates",
      shortLabel: "PANTRY",
      description: "A two-slot preparation batch with a flexible departure.",
      prepDuration: 2,
      dispatchDuration: 1,
      deadline: 8,
      priority: "standard",
      tint: "azure",
    },
    {
      id: "archive",
      code: "A",
      label: "Archive cases",
      shortLabel: "ARCHIVE",
      description: "A careful load that occupies the dispatch bay for two slots.",
      prepDuration: 1,
      dispatchDuration: 2,
      deadline: 8,
      priority: "standard",
      tint: "violet",
    },
    {
      id: "beacon",
      code: "B",
      label: "Critical Beacon",
      shortLabel: "BEACON",
      description: "The one job with a hard delivery window.",
      prepDuration: 1,
      dispatchDuration: 2,
      deadline: 6,
      priority: "critical",
      tint: "ice",
    },
    {
      id: "relay",
      code: "R",
      label: "Relay kit",
      shortLabel: "RELAY",
      description: "A short job that can use a late gap in the shift.",
      prepDuration: 1,
      dispatchDuration: 1,
      deadline: 7,
      priority: "standard",
      tint: "cobalt",
    },
  ],
  defaultSchedule: ["pantry", "archive", "beacon", "relay"],
  // A worked example, not an answer key: the tests and the docs use it as a known-good
  // order, and nothing in the running game reads it. The auditor's candidate is searched
  // with `recommendSchedule`, so it stays right because the plan survives the shift rather
  // than because a fixture said so.
  robustSchedule: ["beacon", "pantry", "archive", "relay"],
  disruption: {
    id: "berth-down",
    label: "Dispatch Bay loses one berth",
    shortLabel: "BERTH 02 OFFLINE",
    description:
      "One dispatch lane goes offline after the shift starts. The work still moves, but the queue can no longer hide behind parallel capacity.",
    dispatchParallelism: 1,
  },
};

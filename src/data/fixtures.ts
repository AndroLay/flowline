import type { Scenario } from "../domain/model.ts";

/**
 * Three shifts, all fictional and all local. They are ordered by the thing they teach rather
 * than by size: the first is a capacity shock on a floor where everything has already
 * arrived, the second adds an intake queue so the order has to respect arrival times, and
 * the third takes the arrival away from the one job that cannot be late.
 *
 * Every number here is deliberate and checked by `tests/model.test.mts`: each shift's default
 * order has a real problem under its own disruption, and each has at least one order that
 * survives it. A shift nobody can win and a shift nobody can lose both teach nothing.
 */

const lastDispatch: Scenario = {
  id: "last-dispatch",
  order: 1,
  title: "The Last Dispatch",
  subtitle: "SHIFT 01 / EIGHT-SLOT HORIZON",
  brief:
    "Four jobs need to pass through a preparation bay before they can leave the dispatch floor. You have one shift, two stations, and no room for a hidden queue.",
  objective: "Keep the critical Beacon on time without wasting the shift.",
  lesson:
    "An order that is on time with both berths can miss by a slot when one goes offline. What saves it is which job leaves first, not how hard the floor works.",
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
      releaseAt: 0,
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
      releaseAt: 0,
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
      releaseAt: 0,
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
      releaseAt: 0,
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
    clause: "a dispatch berth goes offline",
    dispatchParallelism: 1,
  },
};

const rollingIntake: Scenario = {
  id: "rolling-intake",
  order: 2,
  title: "Rolling Intake",
  subtitle: "SHIFT 02 / TEN-SLOT HORIZON / STAGGERED ARRIVALS",
  brief:
    "Five jobs, and three of them are not on the floor yet. Intake releases them as the shift runs, so the order you choose has to respect when work can start — and the berth you are about to lose has not been announced yet.",
  objective: "Get Seedbank out by slot 6 without letting the queue starve the prep crew.",
  lesson:
    "Prep cannot start a job that has not arrived. An order that ignores intake times buys idle crew early and pays for it at a deadline later.",
  horizon: 10,
  constraints: [
    "A job cannot enter prep before its intake slot.",
    "Prep Bay runs one job at a time.",
    "Dispatch Bay starts with two parallel lanes.",
    "Critical Seedbank arrives at slot 2 and must finish by slot 6.",
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
      id: "coolant",
      code: "C",
      label: "Coolant drums",
      shortLabel: "COOLANT",
      description: "On the floor at open, and slow to prepare.",
      prepDuration: 2,
      dispatchDuration: 1,
      deadline: 10,
      releaseAt: 0,
      priority: "standard",
      tint: "azure",
    },
    {
      id: "ledger",
      code: "L",
      label: "Ledger crates",
      shortLabel: "LEDGER",
      description: "Quick to prepare, but holds a berth for two slots.",
      prepDuration: 1,
      dispatchDuration: 2,
      deadline: 9,
      releaseAt: 0,
      priority: "standard",
      tint: "violet",
    },
    {
      id: "seedbank",
      code: "S",
      label: "Seedbank pallet",
      shortLabel: "SEEDBANK",
      description: "Arrives mid-shift and cannot be late.",
      prepDuration: 1,
      dispatchDuration: 2,
      deadline: 6,
      releaseAt: 2,
      priority: "critical",
      tint: "ice",
    },
    {
      id: "transit",
      code: "T",
      label: "Transit spares",
      shortLabel: "TRANSIT",
      description: "A short job that arrives after the shift has started.",
      prepDuration: 1,
      dispatchDuration: 1,
      deadline: 8,
      releaseAt: 3,
      priority: "standard",
      tint: "cobalt",
    },
    {
      id: "charter",
      code: "H",
      label: "Charter kit",
      shortLabel: "CHARTER",
      description: "The last intake of the shift, with the loosest window.",
      prepDuration: 2,
      dispatchDuration: 1,
      deadline: 10,
      releaseAt: 5,
      priority: "standard",
      tint: "quartz",
    },
  ],
  defaultSchedule: ["coolant", "ledger", "seedbank", "transit", "charter"],
  robustSchedule: ["seedbank", "transit", "ledger", "coolant", "charter"],
  disruption: {
    id: "berth-down-intake",
    label: "Dispatch Bay loses one berth mid-intake",
    shortLabel: "BERTH 02 OFFLINE",
    description:
      "The second berth goes offline while intake is still releasing work. Every job now leaves through one lane, and the jobs that have not arrived cannot be pulled forward to fill the gap.",
    clause: "a dispatch berth goes offline",
    dispatchParallelism: 1,
  },
};

const nightHandover: Scenario = {
  id: "night-handover",
  order: 3,
  title: "Night Handover",
  subtitle: "SHIFT 03 / TEN-SLOT HORIZON / LATE CRITICAL ARRIVAL",
  brief:
    "Both berths stay up all shift. What goes wrong is upstream: the one job that cannot be late is the one that does not turn up on time, and the crew has a floor full of other work while it waits.",
  objective: "Hold Vault's slot 7 window when its intake slips, and keep the rest of the floor inside its deadlines.",
  lesson:
    "When the critical job is the one running late, the shift is won by the work you complete while waiting for it.",
  horizon: 10,
  constraints: [
    "A job cannot enter prep before its intake slot.",
    "Prep Bay runs one job at a time.",
    "Both dispatch berths stay online for the whole shift.",
    "Critical Vault must finish by slot 7, whenever it arrives.",
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
      id: "vault",
      code: "V",
      label: "Vault transfer",
      shortLabel: "VAULT",
      description: "The hard window, and the job the disruption delays.",
      prepDuration: 1,
      dispatchDuration: 2,
      deadline: 7,
      releaseAt: 0,
      priority: "critical",
      tint: "ice",
    },
    {
      id: "manifest",
      code: "M",
      label: "Manifest boxes",
      shortLabel: "MANIFEST",
      description: "Two slots of preparation, available from the open.",
      prepDuration: 2,
      dispatchDuration: 1,
      deadline: 9,
      releaseAt: 0,
      priority: "standard",
      tint: "violet",
    },
    {
      id: "courier",
      code: "K",
      label: "Courier sacks",
      shortLabel: "COURIER",
      description: "Short work with a mid-shift deadline.",
      prepDuration: 1,
      dispatchDuration: 1,
      deadline: 7,
      releaseAt: 1,
      priority: "standard",
      tint: "azure",
    },
    {
      id: "bulkhead",
      code: "D",
      label: "Bulkhead panels",
      shortLabel: "BULKHEAD",
      description: "The heaviest load on the floor, and the loosest window.",
      prepDuration: 2,
      dispatchDuration: 2,
      deadline: 10,
      releaseAt: 2,
      priority: "standard",
      tint: "cobalt",
    },
    {
      id: "signal",
      code: "G",
      label: "Signal spares",
      shortLabel: "SIGNAL",
      description: "A late, quick arrival that still has to clear by slot 8.",
      prepDuration: 1,
      dispatchDuration: 1,
      deadline: 8,
      releaseAt: 4,
      priority: "standard",
      tint: "quartz",
    },
  ],
  defaultSchedule: ["vault", "manifest", "courier", "bulkhead", "signal"],
  robustSchedule: ["manifest", "vault", "courier", "signal", "bulkhead"],
  disruption: {
    id: "vault-late",
    label: "Vault transfer clears customs three slots late",
    shortLabel: "VAULT DELAYED 3 SLOTS",
    description:
      "The critical job is held upstream and reaches intake at slot 3 instead of the open. No capacity is lost — what is lost is the head start, and every plan that put Vault first is now waiting with an idle crew.",
    clause: "Vault arrives three slots late",
    dispatchParallelism: 2,
    releaseDelays: [{ jobId: "vault", slots: 3 }],
  },
};

/** The campaign, in the order it is meant to be played. */
export const shifts: Scenario[] = [lastDispatch, rollingIntake, nightHandover];

/** The shift the game opens on. */
export const scenario: Scenario = lastDispatch;

export function findShift(id: string): Scenario | undefined {
  return shifts.find((shift) => shift.id === id);
}

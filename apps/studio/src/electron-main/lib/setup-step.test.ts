import { type SetupFacts, type SetupRecord, SETUP_STEPS } from "@/shared/setup";
import { describe, expect, it } from "vitest";

import {
  answeredByFolderChange,
  answeredStep,
  currentSetupStep,
  finishedRecord,
  isEveryStepAnswered,
  isNewStepOnly,
  setupStateFrom,
  stepBefore,
  unansweredStep,
} from "./setup-step";

/** A first launch on a Mac nobody has asked about notifications. */
const NEW: SetupFacts = {
  folderSettled: false,
  hasInstrumentAccount: false,
  hasInstrumentPlan: false,
  hasUsableAI: false,
  isCheckingPlan: false,
  notificationsAskable: true,
  hasChats: false,
  testedBefore: false,
};

const EMPTY: SetupRecord = { answered: {} };
const AT = new Date("2026-10-21T12:00:00.000Z");

function answered(...steps: (typeof SETUP_STEPS)[number][]): SetupRecord {
  return steps.reduce((record, step) => answeredStep(record, step, AT), EMPTY);
}

/**
 * Goes through setup the way a person would: at each step, `act` says what
 * answering it changes, and the walk records the step answered.
 */
function walk(
  start: SetupFacts,
  act: Partial<Record<(typeof SETUP_STEPS)[number], Partial<SetupFacts>>>,
  record = EMPTY,
) {
  const seen: string[] = [];
  let facts = start;
  let step = currentSetupStep(facts, record);
  while (step !== null && seen.length < 20) {
    seen.push(step);
    facts = { ...facts, ...act[step] };
    // `way-in` keeps no answer: connecting is what moves past it.
    if (step !== "way-in") {
      record = answeredStep(record, step, AT);
    }
    step = currentSetupStep(facts, record);
  }
  return seen;
}

describe("currentSetupStep", () => {
  it("walks a new person in through Google and a trial", () => {
    expect(
      walk(NEW, {
        folder: { folderSettled: true },
        plan: { hasInstrumentPlan: true },
        "way-in": { hasInstrumentAccount: true, hasUsableAI: true },
      }),
    ).toMatchInlineSnapshot(`
      [
        "way-in",
        "plan",
        "model",
        "folder",
        "notifications",
        "look",
      ]
    `);
  });

  it("walks a new person in through ChatGPT, offering the free account", () => {
    expect(
      walk(NEW, {
        "way-in": { hasUsableAI: true },
      }),
    ).toMatchInlineSnapshot(`
      [
        "way-in",
        "free-account",
        "model",
        "folder",
        "notifications",
        "look",
      ]
    `);
  });

  it("walks a beta tester from Welcome back through the folder move", () => {
    expect(
      walk(
        { ...NEW, hasUsableAI: true, hasChats: true, testedBefore: true },
        { folder: { folderSettled: true } },
      ),
    ).toMatchInlineSnapshot(`
      [
        "welcome-back",
        "free-account",
        "model",
        "folder",
        "notifications",
        "look",
      ]
    `);
  });

  // Each row is a relaunch: the facts as they stand, and the steps answered
  // before the quit. Setup picks up at the step the person quit on.
  it.each<[string, Partial<SetupFacts>, SetupRecord, null | string]>([
    ["quit on the first page", {}, EMPTY, "way-in"],
    [
      "quit after connecting ChatGPT",
      { hasUsableAI: true },
      EMPTY,
      "free-account",
    ],
    [
      "quit after signing in with Google, before a plan",
      { hasInstrumentAccount: true, hasUsableAI: true },
      EMPTY,
      "plan",
    ],
    [
      "quit after starting a trial",
      {
        hasInstrumentAccount: true,
        hasInstrumentPlan: true,
        hasUsableAI: true,
      },
      EMPTY,
      "model",
    ],
    [
      "quit on the folder",
      { hasUsableAI: true },
      answered("free-account", "model"),
      "folder",
    ],
    [
      "quit while the folder move waits on its restart",
      { folderSettled: true, hasUsableAI: true },
      answered("free-account", "model"),
      "notifications",
    ],
    [
      "quit on notifications",
      { folderSettled: true, hasUsableAI: true },
      answered("free-account", "model", "folder"),
      "notifications",
    ],
    [
      "quit on the look",
      { folderSettled: true, hasUsableAI: true },
      answered("free-account", "model", "folder", "notifications"),
      "look",
    ],
    [
      "answered everything but never finished",
      { folderSettled: true, hasUsableAI: true },
      answered("free-account", "model", "folder", "notifications", "look"),
      null,
    ],
    [
      "a beta tester's first launch",
      { hasUsableAI: true, hasChats: true, testedBefore: true },
      EMPTY,
      "welcome-back",
    ],
    [
      "a release user's chats on a second computer",
      { hasUsableAI: true, hasChats: true },
      EMPTY,
      "free-account",
    ],
    [
      "a beta tester who quit after Welcome back",
      { hasUsableAI: true, hasChats: true, testedBefore: true },
      answered("welcome-back"),
      "free-account",
    ],
    [
      "a beta tester signed out of everything",
      { hasChats: true, testedBefore: true },
      answered("welcome-back"),
      "way-in",
    ],
    [
      "lost every AI before finishing",
      { folderSettled: true },
      answered("free-account", "model"),
      "way-in",
    ],
    [
      "notifications off macOS",
      { folderSettled: true, hasUsableAI: true, notificationsAskable: false },
      answered("free-account", "model"),
      "look",
    ],
    [
      "a pinned or picked folder",
      { folderSettled: true, hasUsableAI: true },
      answered("free-account", "model"),
      "notifications",
    ],
    [
      "folder answered while it stays in app data",
      { hasUsableAI: true },
      answered("free-account", "model", "folder"),
      "notifications",
    ],
  ])("%s", (_name, facts, record, expected) => {
    expect(currentSetupStep({ ...NEW, ...facts }, record)).toBe(expected);
    expect(isNewStepOnly({ ...NEW, ...facts }, record)).toBe(false);
  });

  it("asks the plan step only of an Instrument account without a plan", () => {
    const withAccount = {
      ...NEW,
      hasInstrumentAccount: true,
      hasUsableAI: true,
    };
    expect(currentSetupStep(withAccount, EMPTY)).toBe("plan");
    expect(
      currentSetupStep({ ...withAccount, hasInstrumentPlan: true }, EMPTY),
    ).toBe("model");
    expect(currentSetupStep({ ...NEW, hasUsableAI: true }, EMPTY)).toBe(
      "free-account",
    );
  });
});

describe("after finishing", () => {
  const finished = finishedRecord(answered("free-account", "model"), AT);

  it.each<[string, Partial<SetupFacts>]>([
    ["everything as it was", { folderSettled: true, hasUsableAI: true }],
    ["signed out of everything", {}],
    ["folder back in app data", { hasUsableAI: true }],
    ["tested before", { hasChats: true, testedBefore: true }],
    [
      "an Instrument account without a plan",
      { hasInstrumentAccount: true, hasUsableAI: true },
    ],
  ])("stays closed with %s", (_name, facts) => {
    expect(currentSetupStep({ ...NEW, ...facts }, finished)).toBeNull();
    expect(isNewStepOnly({ ...NEW, ...facts }, finished)).toBe(false);
  });

  it("shows only a step a later build added", () => {
    // Finished on a build that had no notifications step.
    const { notifications: _added, ...older } = finished.answered;
    const record = { ...finished, answered: older };
    const facts = { ...NEW, hasUsableAI: true };
    expect(currentSetupStep(facts, record)).toBe("notifications");
    expect(isNewStepOnly(facts, record)).toBe(true);
    // The added step still has to be one the person can do here.
    expect(
      currentSetupStep({ ...facts, notificationsAskable: false }, record),
    ).toBeNull();
    // Answering it closes setup again.
    expect(
      currentSetupStep(facts, answeredStep(record, "notifications", AT)),
    ).toBeNull();
  });

  it("never brings Welcome back once finished", () => {
    const { "welcome-back": _added, ...older } = finished.answered;
    expect(
      currentSetupStep(
        { ...NEW, hasChats: true, testedBefore: true },
        { ...finished, answered: older },
      ),
    ).toBeNull();
  });
});

describe("the record", () => {
  it("answers every step at finishing, keeping earlier times", () => {
    const record = finishedRecord(
      answeredStep(
        {
          answered: { "a-step-from-a-newer-build": "2026-01-01T00:00:00.000Z" },
        },
        "model",
        new Date("2026-10-01T00:00:00.000Z"),
      ),
      AT,
    );
    expect(record).toMatchInlineSnapshot(`
      {
        "answered": {
          "a-step-from-a-newer-build": "2026-01-01T00:00:00.000Z",
          "folder": "2026-10-21T12:00:00.000Z",
          "free-account": "2026-10-21T12:00:00.000Z",
          "look": "2026-10-21T12:00:00.000Z",
          "model": "2026-10-01T00:00:00.000Z",
          "notifications": "2026-10-21T12:00:00.000Z",
          "plan": "2026-10-21T12:00:00.000Z",
          "way-in": "2026-10-21T12:00:00.000Z",
          "welcome-back": "2026-10-21T12:00:00.000Z",
        },
        "finishedAt": "2026-10-21T12:00:00.000Z",
      }
    `);
    expect(isEveryStepAnswered(record)).toBe(true);
    expect(isEveryStepAnswered(EMPTY)).toBe(false);
  });

  it("keeps the first finishing time", () => {
    const first = finishedRecord(EMPTY, AT);
    expect(
      finishedRecord(first, new Date("2027-01-01T00:00:00.000Z")).finishedAt,
    ).toBe(AT.toISOString());
  });
});

describe("a workspace setup opened or moved", () => {
  // A new person connected ChatGPT, chose a model and opened a folder that
  // already holds a workspace with chats. After the restart the facts are
  // that workspace's: used before, with the accounts carried over.
  const OPENED: SetupFacts = {
    ...NEW,
    folderSettled: true,
    hasChats: true,
    hasUsableAI: true,
    testedBefore: true,
  };
  const BEFORE_OPEN = answered("free-account", "model");

  it("greets them again without the folder change answering Welcome back", () => {
    expect(currentSetupStep(OPENED, BEFORE_OPEN)).toBe("welcome-back");
  });

  it("lands on the step after the folder", () => {
    expect(
      currentSetupStep(OPENED, answeredByFolderChange(BEFORE_OPEN, AT)),
    ).toBe("notifications");
  });

  it("keeps a Welcome back answered earlier, and answers the folder", () => {
    const earlier = answeredStep(
      EMPTY,
      "welcome-back",
      new Date("2026-10-01T00:00:00.000Z"),
    );
    expect(answeredByFolderChange(earlier, AT)).toMatchInlineSnapshot(`
      {
        "answered": {
          "folder": "2026-10-21T12:00:00.000Z",
          "welcome-back": "2026-10-01T00:00:00.000Z",
        },
      }
    `);
  });
});

describe("setupStateFrom", () => {
  it("hides setup under SKIP_ONBOARDING without changing the facts", () => {
    expect(setupStateFrom({ facts: NEW, record: EMPTY, skip: true }))
      .toMatchInlineSnapshot(`
        {
          "back": null,
          "facts": {
            "folderSettled": false,
            "hasChats": false,
            "hasInstrumentAccount": false,
            "hasInstrumentPlan": false,
            "hasUsableAI": false,
            "isCheckingPlan": false,
            "notificationsAskable": true,
            "testedBefore": false,
          },
          "isNewStepOnly": false,
          "step": null,
        }
      `);
    expect(
      setupStateFrom({ facts: NEW, record: EMPTY, skip: false }).step,
    ).toBe("way-in");
  });
});

describe("stepBefore", () => {
  const signedIn: SetupFacts = {
    ...NEW,
    hasInstrumentAccount: true,
    hasInstrumentPlan: true,
    hasUsableAI: true,
  };

  it("passes over a step a fact settled and one not needed", () => {
    // The plan was answered before a trial made it unneeded; way-in keeps
    // no answer at all.
    const record = answered("plan", "model");
    expect(stepBefore(signedIn, record, "folder")).toBe("model");
    expect(stepBefore(signedIn, record, "model")).toBeNull();
  });

  it("goes back to an answered step that would ask again", () => {
    const keyOnly = { ...NEW, hasUsableAI: true };
    const record = answered("free-account");
    expect(stepBefore(keyOnly, record, "model")).toBe("free-account");
    expect(
      currentSetupStep(keyOnly, unansweredStep(record, "free-account")),
    ).toBe("free-account");
  });

  it("has nowhere to go once setup finished", () => {
    const record = { ...answered("model"), finishedAt: AT.toISOString() };
    expect(stepBefore(signedIn, record, "notifications")).toBeNull();
  });
});

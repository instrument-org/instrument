import ms from "ms";
import { describe, expect, it } from "vitest";

import {
  AGENT_PROTECTION_MS,
  DRIVEN_SLEEP_AFTER_MS,
  type MemoryLevel,
  nextLookInMs,
  nextPageState,
  type PageEvent,
  type PageFacts,
  type PageState,
  pagesToClose,
  SEEN_TAB_DISCARD_MS,
  SLEEP_AFTER_MS,
  SLEEP_RECHECK_MS,
  UNSEEN_TAB_DISCARD_MS,
} from "./page-lifetime";

/** A page no agent has sent a command, nothing keeps, and the person has not seen, just hidden. */
const quiet: PageFacts = {
  agentQuietForMs: Number.POSITIVE_INFINITY,
  busy: false,
  drivenByWorkingAgent: false,
  edited: false,
  hiddenForMs: 0,
  seen: false,
};

const shown = { type: "shown" } as const;
const hidden = { type: "hidden" } as const;
const agentCommand = { type: "agentCommand" } as const;
const tick = (facts: Partial<PageFacts> = {}): PageEvent => ({
  facts: { ...quiet, ...facts },
  type: "tick",
});
/** A memory reading for a page out of sight a minute, unless `facts` say otherwise. */
const memory = (
  level: MemoryLevel,
  facts: Partial<PageFacts> = {},
): PageEvent => ({
  facts: { ...quiet, hiddenForMs: ms("1 minute"), ...facts },
  level,
  type: "memory",
});

/** Seen and out of sight for an hour: past its clock, so only a protection keeps it. */
const pastClock = { hiddenForMs: SEEN_TAB_DISCARD_MS, seen: true };

describe("nextPageState", () => {
  // One row per rule: the rule, the state a page is in, what happens, and
  // the state it goes to.
  // prettier-ignore
  const rules: [rule: string, from: PageState, event: PageEvent, to: PageState][] = [
    // Shown, hidden, and sent commands.
    ["a hidden page shown is drawn", "hidden", shown, "drawn"],
    ["a sleeping page shown wakes, with no reload", "asleep", shown, "drawn"],
    ["a closed page shown loads its address again", "closed", shown, "drawn"],
    ["a drawn page leaves the screen", "drawn", hidden, "hidden"],
    ["an agent's command wakes a sleeping page", "asleep", agentCommand, "hidden"],
    ["an agent's command leaves a drawn page drawn", "drawn", agentCommand, "drawn"],

    // Sleep.
    ["a hidden page sleeps after 5 s out of sight", "hidden", tick({ hiddenForMs: SLEEP_AFTER_MS }), "asleep"],
    ["a hidden page stays awake before 5 s out of sight", "hidden", tick({ hiddenForMs: SLEEP_AFTER_MS - 1 }), "hidden"],
    ["a hidden page stays awake within 5 s of an agent's command", "hidden", tick({ agentQuietForMs: SLEEP_AFTER_MS - 1, hiddenForMs: ms("1 minute") }), "hidden"],
    ["a page a working agent drives stays awake 2 min after its last command", "hidden", tick({ agentQuietForMs: DRIVEN_SLEEP_AFTER_MS - 1, drivenByWorkingAgent: true, hiddenForMs: ms("1 minute") }), "hidden"],
    ["a page a working agent drives sleeps 2 min after its last command", "hidden", tick({ agentQuietForMs: DRIVEN_SLEEP_AFTER_MS, drivenByWorkingAgent: true, hiddenForMs: ms("1 minute") }), "asleep"],
    ["a busy page stays awake", "hidden", tick({ busy: true, hiddenForMs: ms("1 minute") }), "hidden"],
    ["a page holding typed text sleeps", "hidden", tick({ edited: true, hiddenForMs: ms("1 minute") }), "asleep"],
    ["a drawn page never sleeps or closes on a tick", "drawn", tick(pastClock), "drawn"],

    // Closing on the clock.
    ["a seen page closes after 1 h out of sight", "asleep", tick(pastClock), "closed"],
    ["a seen page stays before 1 h out of sight", "asleep", tick({ hiddenForMs: SEEN_TAB_DISCARD_MS - 1, seen: true }), "asleep"],
    ["a page only an agent saw closes after 15 min out of sight", "asleep", tick({ hiddenForMs: UNSEEN_TAB_DISCARD_MS }), "closed"],
    ["a page only an agent saw stays before 15 min out of sight", "asleep", tick({ hiddenForMs: UNSEEN_TAB_DISCARD_MS - 1 }), "asleep"],
    ["a page past its clock closes awake as well as asleep", "hidden", tick(pastClock), "closed"],
    ["a page an agent sent a command in the last 10 min stays past its clock", "asleep", tick({ ...pastClock, agentQuietForMs: AGENT_PROTECTION_MS - 1 }), "asleep"],
    ["a page an agent last sent a command 10 min ago closes past its clock", "asleep", tick({ ...pastClock, agentQuietForMs: AGENT_PROTECTION_MS }), "closed"],
    ["a page a working agent drives stays past its clock", "hidden", tick({ ...pastClock, agentQuietForMs: ms("1 minute"), drivenByWorkingAgent: true }), "hidden"],
    ["a busy page stays past its clock", "hidden", tick({ ...pastClock, busy: true }), "hidden"],
    ["a page holding typed text stays past its clock, asleep", "asleep", tick({ ...pastClock, edited: true }), "asleep"],
    ["a closed page stays closed on a tick", "closed", tick(pastClock), "closed"],

    // Memory.
    ["normal memory closes nothing", "asleep", memory("normal"), "asleep"],
    ["low memory closes a sleeping page", "asleep", memory("low"), "closed"],
    ["low memory leaves a hidden page that is awake", "hidden", memory("low"), "hidden"],
    ["critical memory closes a hidden page that is awake", "hidden", memory("critical"), "closed"],
    ["critical memory closes a sleeping page", "asleep", memory("critical"), "closed"],
    ["memory never closes a drawn page", "drawn", memory("critical"), "drawn"],
    ["memory never closes a page left less than 5 s ago", "hidden", memory("critical", { hiddenForMs: SLEEP_AFTER_MS - 1 }), "hidden"],
    ["memory never closes a page an agent sent a command in the last 10 min", "asleep", memory("critical", { agentQuietForMs: AGENT_PROTECTION_MS - 1 }), "asleep"],
    ["memory never closes a page a working agent drives", "hidden", memory("critical", { drivenByWorkingAgent: true }), "hidden"],
    ["memory never closes a busy page", "asleep", memory("critical", { busy: true }), "asleep"],
    ["memory never closes a page holding typed text", "asleep", memory("critical", { edited: true }), "asleep"],
  ];

  it.each(rules)("%s", (_rule, from, event, to) => {
    expect(nextPageState(from, event)).toBe(to);
  });
});

describe("pagesToClose", () => {
  const page = (name: string, state: PageState, facts: Partial<PageFacts>) => ({
    facts: { ...quiet, ...facts },
    name,
    state,
  });
  const pages = [
    page("asleep 2 min", "asleep", { hiddenForMs: ms("2 minutes") }),
    page("awake 20 min", "hidden", { hiddenForMs: ms("20 minutes") }),
    page("asleep 10 min", "asleep", { hiddenForMs: ms("10 minutes") }),
    page("asleep 30 min, typed in", "asleep", {
      edited: true,
      hiddenForMs: ms("30 minutes"),
    }),
    page("drawn", "drawn", {}),
  ];

  it.each<{ level: MemoryLevel; order: string[]; rule: string }>([
    { level: "normal", order: [], rule: "normal memory closes nothing" },
    {
      level: "low",
      order: ["asleep 10 min", "asleep 2 min"],
      rule: "low memory closes sleeping pages, the one hidden longest first",
    },
    {
      level: "critical",
      order: ["awake 20 min", "asleep 10 min", "asleep 2 min"],
      rule: "critical memory closes hidden pages awake or asleep, the one hidden longest first",
    },
  ])("$rule", ({ level, order }) => {
    expect(pagesToClose(pages, level).map(({ name }) => name)).toEqual(order);
  });
});

describe("nextLookInMs", () => {
  // prettier-ignore
  const waits: [rule: string, state: PageState, facts: Partial<PageFacts>, wait: number][] = [
    ["a page just hidden is looked at once it could sleep", "hidden", { hiddenForMs: ms("2 seconds") }, SLEEP_AFTER_MS - ms("2 seconds")],
    ["a page just sent a command is looked at once it has been quiet 5 s", "hidden", { agentQuietForMs: ms("1 second"), hiddenForMs: ms("1 minute") }, SLEEP_AFTER_MS - ms("1 second")],
    ["a busy page is looked at every 10 s", "hidden", { busy: true, hiddenForMs: ms("1 minute") }, SLEEP_RECHECK_MS],
    ["a driven page is looked at every 10 s while its agent works", "hidden", { agentQuietForMs: ms("1 minute"), drivenByWorkingAgent: true, hiddenForMs: ms("1 minute") }, SLEEP_RECHECK_MS],
    ["a driven page is looked at when its agent's 2 min of quiet end", "hidden", { agentQuietForMs: DRIVEN_SLEEP_AFTER_MS - ms("3 seconds"), drivenByWorkingAgent: true, hiddenForMs: ms("1 minute") }, ms("3 seconds")],
    ["a sleeping page is looked at every 10 s", "asleep", { hiddenForMs: ms("1 minute") }, SLEEP_RECHECK_MS],
    ["a sleeping page is looked at the moment its clock runs out", "asleep", { hiddenForMs: SEEN_TAB_DISCARD_MS - ms("4 seconds"), seen: true }, ms("4 seconds")],
  ];

  it.each(waits)("%s", (_rule, state, facts, wait) => {
    expect(nextLookInMs(state, { ...quiet, ...facts })).toBe(wait);
  });
});

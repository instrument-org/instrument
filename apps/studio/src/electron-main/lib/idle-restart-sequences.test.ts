import fc from "fast-check";
import { expect, it } from "vitest";

import {
  attemptsAt,
  IDLE_RESTART,
  type IdleRestartFacts,
  type IdleRestartState,
  nextAttempts,
  type RestartAttempts,
  stepIdleRestart,
} from "./idle-restart-policy";

/**
 * Random stretches of a computer's life with a staged update: the person at
 * it, away, or locked out; a window focused, showing, hidden or full screen;
 * work running or not, or its check failing; updates staging, and installs
 * that go or fail. Readings are taken every 30 seconds, as `idle-restart.ts`
 * takes them, and a restart verdict is read again for the last look, then
 * recorded as `recordAutomaticInstall` records it. The rules are checked
 * against what really held over time, never against the policy's own state.
 *
 * Off unless `RESTART_SEQUENCES` gives the number of sequences to run;
 * `RESTART_SEQUENCES_SEED` picks other ones:
 *
 *   RESTART_SEQUENCES=5000 pnpm --filter @instrument-org/studio exec vitest run src/electron-main/lib/idle-restart-sequences.test.ts
 */
const env: Record<string, string | undefined> = process.env;

const T = IDLE_RESTART;
const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 26, 9, 0);

const RULES = {
  away: "an update waiting while nothing holds it back restarts once the person has stepped away",
  backstop: "the backstop goes only after three days and ten quiet minutes",
  attempts: "one version tries one update at most twice",
  focused:
    "never restarts over a focused window on an unlocked screen, nor a full-screen one",
  reason: "a restart's reason held for its full time",
  spacing: "two automatic restarts are an hour apart",
  work: "never restarts while work runs or could not be checked",
} as const;

type Rule = keyof typeof RULES;

type Person = "active" | "away" | "locked";
type Window = "focused" | "full-screen" | "hidden" | "shown";

type Stretch = {
  /** Minutes this stretch lasts. */
  minutes: number;
  person: Person;
  window: Window;
  work: IdleRestartFacts["work"];
  /** Stage a new version at the start of this stretch. */
  stage: boolean;
  /** Whether an install started in this stretch comes back on the new version. */
  installs: boolean;
};

const stretchArb: fc.Arbitrary<Stretch> = fc.record({
  installs: fc.boolean(),
  minutes: fc.oneof(
    fc.integer({ max: 30, min: 1 }),
    fc.integer({ max: 180, min: 30 }),
    fc.constantFrom(24 * 60, 3 * 24 * 60),
  ),
  person: fc.constantFrom(
    "active" as const,
    "away" as const,
    "locked" as const,
  ),
  stage: fc.boolean(),
  window: fc.constantFrom(
    "focused" as const,
    "full-screen" as const,
    "hidden" as const,
    "shown" as const,
  ),
  work: fc.constantFrom("busy" as const, "idle" as const, "unknown" as const),
});

class Computer {
  attempts: RestartAttempts | undefined;
  lastAt: number | undefined;
  /** Since when, in true time, each condition has held; undefined when it does not. */
  lockedSince: number | undefined;
  lastInput = T0;
  hiddenSince: number | undefined;
  /** Since when no blocker has held, by the readings. */
  clearSince: number | undefined;
  /** Since when the reading has been one the person stepped away in with nothing in the way. */
  owedSince: number | undefined;
  now = T0;
  policy: IdleRestartState = {
    noWindowSince: undefined,
    quietSince: undefined,
  };
  restarts: { at: number; from: string; reason: string; to: string }[] = [];
  running = 1;
  staged: { since: number; version: number } | undefined;
  window: Window = "shown";
  steps: { label: string; violations: { detail: string; rule: Rule }[] }[] = [];
  #violations: { detail: string; rule: Rule }[] = [];

  break(rule: Rule, detail: string): void {
    this.#violations.push({ detail, rule });
  }

  live(stretch: Stretch): { detail: string; rule: Rule }[] {
    this.#violations = [];
    if (stretch.stage) {
      const version = (this.staged?.version ?? this.running) + 1;
      this.staged = { since: this.now, version };
    }
    if (stretch.window === "focused" && this.window !== "focused") {
      // `browser-window-focus` starts both clocks over.
      this.policy = { noWindowSince: undefined, quietSince: undefined };
    }
    this.window = stretch.window;
    const shown = stretch.window !== "hidden";
    this.hiddenSince = shown ? undefined : (this.hiddenSince ?? this.now);
    if (stretch.person === "locked") {
      this.lockedSince ??= this.now;
    } else {
      this.lockedSince = undefined;
    }
    const end = this.now + stretch.minutes * MINUTE;
    while (this.now < end) {
      if (stretch.person === "active") {
        this.lastInput = this.now;
      }
      this.#read(stretch);
      this.now += T.recheckMs;
    }
    this.steps.push({
      label: JSON.stringify(stretch),
      violations: this.#violations,
    });
    return this.#violations;
  }

  #facts(stretch: Stretch): IdleRestartFacts {
    const update: IdleRestartFacts["update"] = this.staged
      ? {
          stagedSince: this.staged.since,
          type: "ready",
          version: String(this.staged.version),
        }
      : { type: "none" };
    return {
      attempts: this.staged
        ? attemptsAt({
            attempts: this.attempts,
            current: String(this.running),
            to: String(this.staged.version),
          })
        : 0,
      lastAutomaticRestartAt: this.lastAt,
      now: this.now,
      person: {
        awayMs: this.now - this.lastInput,
        lockedSince: this.lockedSince,
      },
      update,
      windows: {
        focused: stretch.window === "focused",
        fullScreen: stretch.window === "full-screen",
        shown: stretch.window !== "hidden",
      },
      work: this.staged ? stretch.work : "unknown",
    };
  }

  #read(stretch: Stretch): void {
    const facts = this.#facts(stretch);
    const step = stepIdleRestart({ facts, state: this.policy });
    this.policy = step.state;
    const blocked =
      !this.staged ||
      facts.attempts >= T.maxAttempts ||
      (this.lastAt !== undefined && this.now - this.lastAt < T.spacingMs) ||
      stretch.work !== "idle" ||
      (stretch.window === "focused" && stretch.person !== "locked") ||
      stretch.window === "full-screen";
    this.clearSince = blocked ? undefined : (this.clearSince ?? this.now);
    const stepped =
      (this.lockedSince !== undefined &&
        this.now - this.lockedSince >= T.lockedMs) ||
      (this.hiddenSince !== undefined &&
        this.now - this.hiddenSince >= T.noWindowMs) ||
      this.now - this.lastInput >= T.personAwayMs;
    this.owedSince =
      !blocked && stepped ? (this.owedSince ?? this.now) : undefined;
    if (step.verdict.type !== "restart" || !this.staged) {
      if (
        this.owedSince !== undefined &&
        this.now - this.owedSince > T.recheckMs
      ) {
        this.break(
          "away",
          `${String((this.now - this.owedSince) / MINUTE)} min owed, waiting on ${step.verdict.type === "wait" ? step.verdict.blocker : ""}`,
        );
      }
      return;
    }
    // The last look: one more reading of the same facts.
    const last = stepIdleRestart({ facts, state: this.policy });
    this.policy = last.state;
    if (last.verdict.type !== "restart") {
      return;
    }
    const reason = last.verdict.reason;
    this.#checkRestart(stretch, facts, reason);
    const to = String(this.staged.version);
    this.attempts = nextAttempts({
      attempts: this.attempts,
      current: String(this.running),
      to,
    });
    this.lastAt = this.now;
    this.restarts.push({
      at: this.now,
      from: String(this.running),
      reason,
      to,
    });
    // A new process: the policy's clocks start over.
    this.policy = { noWindowSince: undefined, quietSince: undefined };
    this.owedSince = undefined;
    if (stretch.installs) {
      this.running = this.staged.version;
      this.staged = undefined;
      this.attempts = undefined;
    }
  }

  #checkRestart(
    stretch: Stretch,
    facts: IdleRestartFacts,
    reason: string,
  ): void {
    const at = `${reason} at ${String((this.now - T0) / MINUTE)} min`;
    if (stretch.work !== "idle") {
      this.break("work", `${at} with work ${stretch.work}`);
    }
    if (
      (stretch.window === "focused" && stretch.person !== "locked") ||
      stretch.window === "full-screen"
    ) {
      this.break(
        "focused",
        `${at} over a ${stretch.window} window, person ${stretch.person}`,
      );
    }
    const previous = this.restarts.at(-1);
    if (previous && this.now - previous.at < T.spacingMs) {
      this.break(
        "spacing",
        `${at}, ${String((this.now - previous.at) / MINUTE)} min after the last`,
      );
    }
    const tries = this.restarts.filter(
      (each) =>
        each.from === String(this.running) &&
        each.to === String(this.staged?.version),
    ).length;
    if (facts.attempts >= T.maxAttempts || tries >= T.maxAttempts) {
      this.break("attempts", `${at}, attempt ${String(facts.attempts + 1)}`);
    }
    const held = (since: number | undefined, ms: number) =>
      since !== undefined && this.now - since >= ms;
    const truth = {
      away: this.now - this.lastInput >= T.personAwayMs,
      backstop:
        this.staged !== undefined &&
        this.now - this.staged.since >= T.backstopAfterMs &&
        held(this.clearSince, T.backstopQuietMs),
      locked: held(this.lockedSince, T.lockedMs),
      "no-window": held(this.hiddenSince, T.noWindowMs),
    };
    if (!truth[reason as keyof typeof truth]) {
      this.break(
        reason === "backstop" ? "backstop" : "reason",
        `${at} ${JSON.stringify(truth)}`,
      );
    }
  }
}

function play(stretches: readonly Stretch[]): Computer {
  const computer = new Computer();
  for (const stretch of stretches) {
    if (computer.live(stretch).length > 0) {
      break;
    }
  }
  return computer;
}

it.runIf(env.RESTART_SEQUENCES)(
  "no stretch of a computer's life breaks a restart rule",
  { timeout: 600_000 },
  () => {
    const result = fc.check(
      fc.property(
        fc.array(stretchArb, { maxLength: 12, size: "max" }),
        (stretches) => !play(stretches).steps.at(-1)?.violations.length,
      ),
      {
        numRuns: Number(env.RESTART_SEQUENCES),
        seed: Number(env.RESTART_SEQUENCES_SEED ?? 1),
      },
    );
    const [shortest] = result.counterexample ?? [];
    if (shortest) {
      const story = play(shortest).steps.map(({ label, violations }) =>
        [
          label,
          ...violations.map(
            ({ detail, rule }) => `  BROKE "${RULES[rule]}": ${detail}`,
          ),
        ].join("\n"),
      );
      expect.fail(
        `found after ${String(result.numRuns)} sequences\n${story.join("\n")}`,
      );
    }
  },
);

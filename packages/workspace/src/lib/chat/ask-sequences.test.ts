import { isFreshAsk } from "@instrument-org/shared";
import fc from "fast-check";
import { expect, it } from "vitest";

import {
  type AnswerGiven,
  type AskAnswer,
  type AskRecord,
} from "../../schemas/ask";
import { DeviceIdSchema } from "../../schemas/device-id";
import { StoreId } from "../../schemas/store-id";
import { askStates, type AskState, type MovedPast } from "./ask-states";

/**
 * Random sequences of what happens around a chat's asks, checked after
 * every step: the ask's computer raising asks and driving them (the steps
 * `driveAsks` documents, with carrying an answer out reduced to closing on
 * it, or failing once), a phone and the computer answering and stopping,
 * the person writing past or stopping the chat, and time passing. Each
 * device reads where the asks stand with `askStates`, by its own clock.
 *
 * Off unless `ASK_SEQUENCES` gives the number of sequences to run;
 * `ASK_SEQUENCES_SEED` picks other ones:
 *
 *   ASK_SEQUENCES=20000 pnpm --filter @instrument-org/workspace exec vitest run src/lib/chat/ask-sequences.test.ts
 */
const env: Record<string, string | undefined> = process.env;

const owner = DeviceIdSchema.parse("dev_0WNER000");
const phone = DeviceIdSchema.parse("dev_PH0NE000");
const T0 = Date.UTC(2026, 10, 26, 12, 0);
const MINUTE = 60_000;

const RULES = {
  agree: "every device agrees on which asks wait on the person",
  askers: "an ask that waits has someone waiting on it",
  carriedOnce: "an answer is carried out at most once",
  closed: "a closed ask waits on nobody and has nothing pending",
  fresh: "the computer takes only a fresh answer",
  oneSet: "only the newest set of questions waits",
  owed: "after a pass nothing the computer could take is left",
  pending: "a pending answer is fresh, of the ask's kind, and not used",
  pendingOrAway: "an open ask shows an unused answer as pending or away",
  wokenOnce: "an ask's askers are woken at most once",
} as const;

type Rule = keyof typeof RULES;

type Action =
  | { ask: number; by: "owner" | "phone"; t: "answer"; yes: boolean }
  | { ask: number; by: "owner" | "phone"; t: "stop" }
  | { ask: number; t: "join" }
  | { then: "carry" | "fail" | "quit"; t: "drive" }
  | { kind: AskRecord["kind"]; newSet: boolean; t: "raise" }
  | { minutes: number; t: "wait" }
  | { t: "personStop" }
  | { t: "type" };

const who = fc.constantFrom("owner" as const, "phone" as const);
const askIndex = fc.nat({ max: 3 });

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constantFrom(
      "permission" as const,
      "question" as const,
      "sign-in" as const,
    ),
    newSet: fc.boolean(),
    t: fc.constant("raise" as const),
  }),
  fc.record({
    ask: askIndex,
    by: who,
    t: fc.constant("answer" as const),
    yes: fc.boolean(),
  }),
  fc.record({ ask: askIndex, by: who, t: fc.constant("stop" as const) }),
  fc.record({ ask: askIndex, t: fc.constant("join" as const) }),
  fc.record({
    t: fc.constant("drive" as const),
    then: fc.constantFrom("carry" as const, "fail" as const, "quit" as const),
  }),
  fc.record({
    minutes: fc.integer({ max: 14, min: 0 }),
    t: fc.constant("wait" as const),
  }),
  fc.constant({ t: "personStop" as const }),
  fc.constant({ t: "type" as const }),
);

const refKey = ({ at, device }: { at: Date; device: string }) =>
  `${device} ${String(at.getTime())}`;

class World {
  answers: AskAnswer[] = [];
  asks: AskRecord[] = [];
  carried = new Map<string, number>();
  lastSet: string | undefined;
  movedPast: MovedPast = {};
  now = T0;
  readonly phoneSkew: number;
  steps: { label: string; violations: { detail: string; rule: Rule }[] }[] = [];
  wakes = new Map<string, number>();
  #violations: { detail: string; rule: Rule }[] = [];

  constructor(phoneSkew: number) {
    this.phoneSkew = phoneSkew;
  }

  clock(device: "owner" | "phone"): number {
    return device === "owner" ? this.now : this.now + this.phoneSkew;
  }

  states(device: "owner" | "phone"): AskState[] {
    return askStates({
      answers: this.answers,
      asks: this.asks,
      movedPast: this.movedPast,
      now: this.clock(device),
    });
  }

  break(rule: Rule, detail: string): void {
    this.#violations.push({ detail, rule });
  }

  write(ask: AskRecord): void {
    this.asks = this.asks.map((each) => (each.id === ask.id ? ask : each));
  }

  do(action: Action): { detail: string; rule: Rule }[] {
    this.#violations = [];
    this.#apply(action);
    this.#check();
    if (action.t === "drive" && action.then !== "quit") {
      this.#checkNothingOwed();
    }
    this.steps.push({
      label: JSON.stringify(action),
      violations: this.#violations,
    });
    return this.#violations;
  }

  #apply(action: Action): void {
    switch (action.t) {
      case "wait":
        this.now += action.minutes * MINUTE;
        return;
      case "type":
        this.movedPast = {
          ...this.movedPast,
          typed: StoreId.newMessageId(),
          typedAt: new Date(this.now),
        };
        return;
      case "personStop":
        this.movedPast = { ...this.movedPast, stoppedAt: new Date(this.now) };
        return;
      case "raise":
        this.#raise(action);
        return;
      case "join": {
        const ask = this.asks[action.ask];
        if (ask && ask.stage.is !== "closed") {
          this.write({
            ...ask,
            askers: [
              ...ask.askers,
              { at: new Date(this.now), sessionId: StoreId.newSessionId() },
            ],
          });
        }
        return;
      }
      case "answer":
      case "stop":
        this.#answer(action);
        return;
      case "drive":
        this.#drive(action.then);
        return;
    }
  }

  #raise({ kind, newSet }: { kind: AskRecord["kind"]; newSet: boolean }): void {
    if (this.asks.length >= 4) {
      return;
    }
    const base = {
      askedAt: new Date(this.now),
      askers: [{ at: new Date(this.now), sessionId: StoreId.newSessionId() }],
      device: owner,
      id: `ask${String(this.asks.length)}`,
      stage: { is: "open" as const },
    };
    if (kind === "permission") {
      this.asks.push({ ...base, kind, on: "folder", target: `/f/${base.id}` });
      return;
    }
    const messageId = StoreId.newMessageId();
    if (kind === "question") {
      const set = newSet || this.lastSet === undefined ? base.id : this.lastSet;
      this.lastSet = set;
      this.asks.push({
        ...base,
        kind,
        messageId,
        partId: StoreId.newPartId(),
        questions: ["Which?"],
        set,
      });
      return;
    }
    this.asks.push({
      ...base,
      apps: [{ name: "App", slug: "app", standing: "waiting" }],
      kind,
      messageId,
      partId: StoreId.newPartId(),
    });
  }

  /** An answer or a Stop, given on a card the device shows: one that waits on the person. */
  #answer(action: Extract<Action, { t: "answer" | "stop" }>): void {
    const ask = this.asks[action.ask];
    const state = this.states(action.by).find(
      (each) => each.ask.id === ask?.id,
    );
    if (!ask || !state?.live) {
      return;
    }
    let given: AnswerGiven;
    if (action.t === "stop") {
      given = {
        askers: state.askers.map(({ at, sessionId }) => ({ at, sessionId })),
        kind: "stopped",
      };
    } else if (ask.kind === "permission") {
      given = {
        decision: action.yes ? "allowed" : "declined",
        kind: "permission",
      };
    } else if (ask.kind === "question") {
      given = {
        answer: {
          replies: [action.yes ? { picked: ["A"] } : { skipped: true }],
        },
        kind: "question",
      };
    } else {
      given = { decision: "declined", kind: "sign-in" };
    }
    const at = new Date(this.clock(action.by));
    const device = action.by === "owner" ? owner : phone;
    // Two answers from one device in one millisecond are one answer's identity.
    if (
      this.answers.some(
        (each) => each.device === device && each.at.getTime() === at.getTime(),
      )
    ) {
      return;
    }
    this.answers.push({ ask: ask.id, at, device, given });
  }

  /** One pass of the ask's computer, by `driveAsks`'s four steps. */
  #drive(then: "carry" | "fail" | "quit"): void {
    let failOnce = then === "fail";
    for (let round = 0; round < 16; round++) {
      let moved = false;
      for (const state of this.states("owner")) {
        const { ask, askers, live, pending } = state;
        const { stage } = ask;
        if (stage.is === "closed") {
          if (!stage.woken) {
            const count = (this.wakes.get(ask.id) ?? 0) + 1;
            this.wakes.set(ask.id, count);
            if (count > 1) {
              this.break("wokenOnce", `${ask.id} woken ${String(count)} times`);
            }
            this.write({ ...ask, stage: { ...stage, woken: true } });
            moved = true;
          }
          continue;
        }
        if (askers.length === 0 || !live) {
          this.write({
            ...ask,
            stage: { is: "closed", outcome: { kind: "left" }, woken: true },
          });
          moved = true;
          continue;
        }
        if (pending) {
          if (!isFreshAsk(pending.at, this.now)) {
            this.break(
              "fresh",
              `${ask.id} took ${refKey(pending)} at ${String(this.now)}`,
            );
          }
          const { failed: _failed, ...rest } = ask;
          this.write({
            ...rest,
            stage: { answer: pending, is: "taken" },
          });
          if (then === "quit") {
            // The app quits with the answer taken and not carried out.
            return;
          }
          moved = true;
          continue;
        }
        if (stage.is === "taken") {
          const ref = { at: stage.answer.at, device: stage.answer.device };
          if (failOnce) {
            failOnce = false;
            this.write({
              ...ask,
              failed: { ...stage.answer, message: "failed" },
              spent: [...(ask.spent ?? []), ref],
              stage: { is: "open" },
            });
          } else {
            const key = refKey(ref);
            const count = (this.carried.get(key) ?? 0) + 1;
            this.carried.set(key, count);
            if (count > 1) {
              this.break(
                "carriedOnce",
                `${key} carried out ${String(count)} times`,
              );
            }
            this.write({
              ...ask,
              stage: {
                answer: ref,
                closedAt: new Date(this.now),
                is: "closed",
                outcome: { kind: "left" },
                woken: false,
              },
            });
          }
          moved = true;
        }
      }
      if (!moved) {
        return;
      }
    }
  }

  #check(): void {
    const byDevice = {
      owner: this.states("owner"),
      phone: this.states("phone"),
    };
    for (const [device, states] of Object.entries(byDevice)) {
      const now = this.clock(device === "owner" ? "owner" : "phone");
      const liveSets = new Set<string>();
      for (const { ask, askers, away, live, pending } of states) {
        const at = `${device} ${ask.id}`;
        if (ask.stage.is === "closed" && (live || pending || away)) {
          this.break(
            "closed",
            `${at} live=${String(live)} pending=${String(!!pending)} away=${String(!!away)}`,
          );
        }
        if (live && askers.length === 0) {
          this.break("askers", at);
        }
        if (pending) {
          const used = [
            ...(ask.spent ?? []),
            ...(ask.stage.is === "taken" ? [ask.stage.answer] : []),
          ].map(refKey);
          if (
            !isFreshAsk(pending.at, now) ||
            pending.kind !== ask.kind ||
            used.includes(refKey(pending))
          ) {
            this.break("pending", `${at} ${JSON.stringify(pending)}`);
          }
          if (away) {
            this.break("pendingOrAway", `${at} has both`);
          }
        }
        if (live && ask.stage.is === "open" && !pending && !away) {
          const spent = (ask.spent ?? []).map(refKey);
          const unused = this.answers.find(
            (answer) =>
              answer.ask === ask.id &&
              answer.given.kind === ask.kind &&
              !spent.includes(refKey(answer)),
          );
          if (unused) {
            this.break(
              "pendingOrAway",
              `${at} shows nothing of ${refKey(unused)}`,
            );
          }
        }
        if (live && ask.kind === "question") {
          liveSets.add(ask.set ?? ask.id);
        }
      }
      if (liveSets.size > 1) {
        this.break("oneSet", `${device} ${[...liveSets].join(", ")}`);
      }
    }
    for (const [index, state] of byDevice.owner.entries()) {
      const other = byDevice.phone[index];
      if (state.live !== other?.live || state.replied !== other.replied) {
        this.break(
          "agree",
          `${state.ask.id} owner live=${String(state.live)} phone live=${String(other?.live)}`,
        );
      }
    }
  }

  #checkNothingOwed(): void {
    for (const { ask, pending } of this.states("owner")) {
      if (pending) {
        this.break("owed", `${ask.id} still has ${refKey(pending)} pending`);
      }
    }
  }
}

function play(phoneSkew: number, actions: readonly Action[]): World {
  const world = new World(phoneSkew);
  for (const action of actions) {
    if (world.do(action).length > 0) {
      break;
    }
  }
  return world;
}

it.runIf(env.ASK_SEQUENCES)(
  "no sequence of answers, stops and passes breaks a rule",
  { timeout: 600_000 },
  () => {
    const result = fc.check(
      fc.property(
        fc.integer({ max: 3 * MINUTE, min: -3 * MINUTE }),
        fc.array(actionArb, { maxLength: 30, size: "max" }),
        (skew, actions) => !play(skew, actions).steps.at(-1)?.violations.length,
      ),
      {
        numRuns: Number(env.ASK_SEQUENCES),
        seed: Number(env.ASK_SEQUENCES_SEED ?? 1),
      },
    );
    const [skew, shortest] = result.counterexample ?? [];
    if (skew !== undefined && shortest) {
      const story = play(skew, shortest).steps.map(({ label, violations }) =>
        [
          label,
          ...violations.map(
            ({ detail, rule }) => `  BROKE "${RULES[rule]}": ${detail}`,
          ),
        ].join("\n"),
      );
      expect.fail(
        `found after ${String(result.numRuns)} sequences, phone clock ${String(skew / 1000)}s off\n${story.join("\n")}`,
      );
    }
  },
);

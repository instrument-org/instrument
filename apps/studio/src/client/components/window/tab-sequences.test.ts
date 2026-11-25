import fc from "fast-check";
import { expect, it } from "vitest";

import { actionArb, RULES, Window } from "./tab-sequences";

/**
 * Off unless `TAB_SEQUENCES` gives the number of sequences to run, 25,000
 * taking about five seconds; `TAB_SEQUENCES_SEED` picks other ones. Run after a change
 * to how tabs open, move, close or come back:
 *
 *   TAB_SEQUENCES=25000 pnpm --filter @instrument-org/studio exec vitest run src/client/components/window/tab-sequences.test.ts
 */
const env: Record<string, string | undefined> = process.env;

function play(actions: readonly Parameters<Window["do"]>[0][]) {
  const window = new Window();
  for (const action of actions) {
    if (window.do(action).length > 0) {
      break;
    }
  }
  return window;
}

it.runIf(env.TAB_SEQUENCES)(
  "no sequence of actions breaks a rule",
  { timeout: 600_000 },
  () => {
    const result = fc.check(
      fc.property(
        fc.array(actionArb, { maxLength: 25, size: "max" }),
        (actions) => !play(actions).steps.at(-1)?.violations.length,
      ),
      {
        numRuns: Number(env.TAB_SEQUENCES),
        seed: Number(env.TAB_SEQUENCES_SEED ?? 1),
      },
    );
    const [shortest] = result.counterexample ?? [];
    if (shortest) {
      const story = play(shortest).steps.map(({ after, label, violations }) =>
        [
          label,
          `  ${JSON.stringify(after)}`,
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

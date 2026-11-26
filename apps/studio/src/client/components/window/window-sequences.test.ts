import fc from "fast-check";
import { expect, it, vi } from "vitest";

import {
  type WindowAction,
  windowActionArb,
  WINDOW_RULES,
  Windows,
} from "./window-sequences";

// `listedWith` sits beside the hooks, whose module reaches the RPC client.
vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

/**
 * Off unless `WINDOW_SEQUENCES` gives the number of sequences to run;
 * `WINDOW_SEQUENCES_SEED` picks other ones. Run after a change to how tabs or
 * groups move between windows, or how a window closes or comes back:
 *
 *   WINDOW_SEQUENCES=25000 pnpm --filter @instrument-org/studio exec vitest run src/client/components/window/window-sequences.test.ts
 */
const env: Record<string, string | undefined> = process.env;

function play(actions: readonly WindowAction[]) {
  const windows = new Windows();
  for (const action of actions) {
    if (windows.do(action).length > 0) {
      break;
    }
  }
  return windows;
}

it.runIf(env.WINDOW_SEQUENCES)(
  "no sequence of actions across windows breaks a rule",
  { timeout: 600_000 },
  () => {
    const result = fc.check(
      fc.property(
        fc.array(windowActionArb, { maxLength: 25, size: "max" }),
        (actions) => !play(actions).steps.at(-1)?.violations.length,
      ),
      {
        numRuns: Number(env.WINDOW_SEQUENCES),
        seed: Number(env.WINDOW_SEQUENCES_SEED ?? 1),
      },
    );
    const [shortest] = result.counterexample ?? [];
    if (shortest) {
      const story = play(shortest).steps.map(({ label, violations }) =>
        [
          label,
          ...violations.map(
            ({ detail, rule }) => `  BROKE "${WINDOW_RULES[rule]}": ${detail}`,
          ),
        ].join("\n"),
      );
      expect.fail(
        `found after ${String(result.numRuns)} sequences\n${story.join("\n")}`,
      );
    }
  },
);

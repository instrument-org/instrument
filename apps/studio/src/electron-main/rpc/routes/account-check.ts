import {
  type CheckedProvider,
  checkAccount,
  connectAccount,
} from "@/electron-main/lib/account-check";
import { noteAccountCheckForSetup } from "@/electron-main/lib/setup-facts";
import { base } from "@/electron-main/rpc/base";
import { z } from "zod";

const ProviderSchema = z.enum(["chatgpt", "claude", "grok"]);

const InputSchema = z.object({
  accountId: z.string().optional(),
  provider: ProviderSchema,
});

/**
 * The check running for each provider. A newer one replaces it, and
 * `cancel` ends it, which ends its request rather than only its answer.
 */
const running = new Map<CheckedProvider, AbortController>();

async function whileRunning<T>(
  provider: CheckedProvider,
  callerSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  running.get(provider)?.abort();
  const controller = new AbortController();
  running.set(provider, controller);
  try {
    return await run(
      callerSignal
        ? AbortSignal.any([controller.signal, callerSignal])
        : controller.signal,
    );
  } finally {
    if (running.get(provider) === controller) {
      running.delete(provider);
    }
  }
}

/**
 * Whether the account signed in to `provider` can run a turn now, without
 * changing anything; see `checkAccount`. Takes seconds, since it spends one
 * short request on the plan.
 */
const check = base.input(InputSchema).handler(async ({ input, signal }) => {
  const outcome = await whileRunning(input.provider, signal, (combined) =>
    checkAccount({ ...input, signal: combined }),
  );
  noteAccountCheckForSetup({ ...input, outcome });
  return outcome;
});

/**
 * The check a sign-in ends on: the answer, and the default model it chose
 * when the account is worth running on; see `connectAccount`.
 */
const connect = base.input(InputSchema).handler(async ({ input, signal }) => {
  const result = await whileRunning(input.provider, signal, (combined) =>
    connectAccount({ ...input, signal: combined }),
  );
  noteAccountCheckForSetup({ ...input, outcome: result.outcome });
  return result;
});

/** Ends the check running for `provider`, which then answers `canceled`. */
const cancel = base
  .input(z.object({ provider: ProviderSchema }))
  .handler(({ input }) => {
    running.get(input.provider)?.abort();
  });

export const accountCheck = { cancel, check, connect };

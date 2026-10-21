import { type ConnectOutcome } from "@/shared/connect-outcome";

import type { CheckedProvider } from "./account-check";

/** The config types the account check covers, and the provider each is. */
const CHECKED_TYPES: Record<string, CheckedProvider | undefined> = {
  "chatgpt-account": "chatgpt",
  "claude-account": "claude",
  "grok-account": "grok",
};

/** The answers that say an account can't run anything here. */
const UNUSABLE: ReadonlySet<ConnectOutcome["kind"]> = new Set([
  "no-plan",
  "signed-out",
]);

interface Config {
  id: string;
  type: string;
}

/**
 * What setup knows about each plan account's check, by its config id, and
 * whether that leaves a model to run on. An account counts as usable until
 * its check answers no plan or signed out, so a launch never waits on a
 * request; keys and the Instrument sign-in always count.
 */
export function createSetupAccountAnswers({
  check,
  onChange,
}: {
  /** The account check (`checkAccount`). */
  check: (input: {
    accountId?: string;
    provider: CheckedProvider;
  }) => Promise<ConnectOutcome>;
  /** An answer landed that may change whether AI is usable. */
  onChange: () => void;
}) {
  const answers = new Map<string, ConnectOutcome["kind"]>();

  const note = (configId: string, outcome: ConnectOutcome) => {
    // Canceled says nothing about the account.
    if (outcome.kind === "canceled") {
      return;
    }
    answers.set(configId, outcome.kind);
    onChange();
  };

  return {
    /** Whether any config can run a model, by the answers so far. */
    hasUsableAI: (configs: Config[]) =>
      configs.some((config) => {
        if (CHECKED_TYPES[config.type] === undefined) {
          return true;
        }
        const answer = answers.get(config.id);
        return answer === undefined || !UNUSABLE.has(answer);
      }),

    /**
     * Records a check made elsewhere (a sign-in's own), for the account it
     * was about: `accountId`, or the first of the provider's accounts.
     */
    noteCheck: ({
      accountId,
      configs,
      outcome,
      provider,
    }: {
      accountId?: string;
      configs: Config[];
      outcome: ConnectOutcome;
      provider: CheckedProvider;
    }) => {
      const id =
        accountId ??
        configs.find((config) => CHECKED_TYPES[config.type] === provider)?.id;
      if (id !== undefined) {
        note(id, outcome);
      }
    },

    /**
     * Checks every plan account with no answer yet, each answer landing as
     * it comes. One a sign-in answered meanwhile keeps that newer answer.
     */
    checkAll: async (configs: Config[]) => {
      await Promise.all(
        configs.map(async (config) => {
          const provider = CHECKED_TYPES[config.type];
          if (provider === undefined || answers.has(config.id)) {
            return;
          }
          const outcome = await check({
            ...(provider !== "claude" && { accountId: config.id }),
            provider,
          });
          if (!answers.has(config.id)) {
            note(config.id, outcome);
          }
        }),
      );
    },
  };
}

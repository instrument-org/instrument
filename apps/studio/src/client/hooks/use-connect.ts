import { rpcClient } from "@/client/rpc/client";
import { type ConnectOutcome } from "@/shared/connect-outcome";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import {
  type ConnectFlow,
  type ConnectResult,
  useConnectFlow,
} from "./use-connect-flow";

/**
 * One connect flow per way in, each starting its own sign-in, then checking
 * the plan and choosing the default model in main (`accountCheck.connect`),
 * and answering with a `ConnectOutcome`. Setup, the Add a provider sheet,
 * Settings and the notes above the reply box all connect through these and
 * differ only in how they draw the answer (`lib/connect-copy.ts`).
 */

const failed = (error: unknown): ConnectResult => ({
  outcome: {
    kind: "failed",
    message: error instanceof Error ? error.message : String(error),
  },
});

/** Signing in to Instrument with Google. Its plan comes from billing. */
export function useInstrumentConnect(): ConnectFlow<void> {
  return useConnectFlow<void>({
    onCancel: () => {
      void rpcClient.auth.cancelSignIn.call();
    },
    run: async (_, { onPhase, signal }) => {
      const outcome = await rpcClient.auth.signInSocial.call().catch(failed);
      if (typeof outcome !== "string") {
        return outcome;
      }
      if (outcome === "on-web") {
        onPhase("on-web");
        const back = await rpcClient.auth.finishOnWeb
          .call(undefined, { signal })
          .catch(() => "signed-in" as const);
        return {
          outcome:
            back === "use-subscription"
              ? { kind: "ready", next: "subscriptions" }
              : { kind: "ready" },
        };
      }
      return {
        outcome:
          outcome === "signed-in"
            ? { kind: "ready" }
            : ({ kind: outcome } satisfies ConnectOutcome),
      };
    },
  });
}

/**
 * Signing in with ChatGPT. `accountId` signs in to that account again; left
 * out, the next attempt after plan access was left unchecked asks the same
 * account again, with the consent screen.
 */
export function useChatGPTConnect(): ConnectFlow<{
  accountId?: string;
} | void> {
  const declinedAccount = useRef<string>(undefined);
  return useConnectFlow<{ accountId?: string } | void>({
    onCancel: (phase) => {
      void (phase === "checking"
        ? rpcClient.accountCheck.cancel.call({ provider: "chatgpt" })
        : rpcClient.chatgptAccount.cancelSignIn.call());
    },
    run: async (input, { onPhase, signal }) => {
      const accountId = input?.accountId ?? declinedAccount.current;
      const result = await rpcClient.chatgptAccount.signIn
        .call({ accountId }, { signal })
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
          outcome: "failed" as const,
        }));
      declinedAccount.current = undefined;
      switch (result.outcome) {
        case "failed": {
          return { outcome: { kind: "failed", message: result.error } };
        }
        case "canceled":
        case "declined": {
          return { outcome: { kind: result.outcome } };
        }
        case "plan-off": {
          // Plan access left unchecked on OpenAI's page.
          declinedAccount.current = result.account?.id;
          return { outcome: { kind: "declined" } };
        }
        case "signed-in": {
          onPhase("checking");
          return rpcClient.accountCheck.connect.call(
            { accountId: result.account?.id, provider: "chatgpt" },
            { signal },
          );
        }
      }
    },
  });
}

/**
 * Connecting a Claude account: Instrument's copy of Claude Code installs when
 * it needs to, the sign-in finishes on Anthropic's page (or with a code pasted
 * from another device), and an account signed in already connects at once.
 * `status` is Claude Code's, for the install's progress and the sign-in link.
 */
export function useClaudeConnect() {
  const { data: status } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const flow = useConnectFlow<void>({
    onCancel: (phase) => {
      void (phase === "checking"
        ? rpcClient.accountCheck.cancel.call({ provider: "claude" })
        : rpcClient.claudeAccount.cancelSignIn.call({}));
    },
    run: async (_input, { onPhase, signal }) => {
      const signedIn = await rpcClient.claudeAccount.signIn
        .call({}, { signal })
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
          status: undefined,
        }));
      if (signedIn.error !== undefined) {
        return { outcome: { kind: "failed", message: signedIn.error } };
      }
      if (signedIn.status?.kind === "not-a-plan") {
        // Signed in to an API key or a cloud provider rather than a plan.
        return { outcome: { kind: "no-plan" } };
      }
      if (signedIn.status?.kind !== "signed-in") {
        return {
          outcome: {
            kind: "failed",
            message: "The Claude sign-in ended without finishing",
          },
        };
      }
      onPhase("checking");
      return rpcClient.accountCheck.connect.call(
        { provider: "claude" },
        { signal },
      );
    },
  });
  return { ...flow, status };
}

/**
 * Signing in with Grok through xAI's device code: `userCode` is the code the
 * browser page asks for, while it waits. xAI names the plan at sign-in, so an
 * account without an eligible paid plan answers at once.
 */
export function useGrokConnect() {
  const flow = useConnectFlow<void>({
    onCancel: (phase) => {
      void (phase === "checking"
        ? rpcClient.accountCheck.cancel.call({ provider: "grok" })
        : rpcClient.grokAccount.cancelSignIn.call());
    },
    run: async (_input, { onPhase, signal }) => {
      const result = await rpcClient.grokAccount.signIn
        .call({}, { signal })
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
          outcome: "failed" as const,
        }));
      if (result.outcome === "failed") {
        return { outcome: { kind: "failed", message: result.error } };
      }
      if (result.outcome !== "signed-in") {
        return { outcome: { kind: result.outcome } };
      }
      const { account } = result;
      if (!account) {
        return failed(new Error("Grok signed in without an account"));
      }
      if (account.state === "no-subscription") {
        return { outcome: { kind: "no-plan" } };
      }
      onPhase("checking");
      return rpcClient.accountCheck.connect.call(
        { accountId: account.id, provider: "grok" },
        { signal },
      );
    },
  });
  const { data: status } = useQuery({
    ...rpcClient.grokAccount.live.status.experimental_liveOptions(),
    enabled: flow.phase === "signing-in",
  });
  return {
    ...flow,
    userCode:
      flow.phase === "signing-in" ? status?.pending?.userCode : undefined,
  };
}

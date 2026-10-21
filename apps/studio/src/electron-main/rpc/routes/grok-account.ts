import { liveRead } from "@instrument-org/workspace/electron";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  cancelGrokSignIn,
  checkGrokSubscriptions,
  type GrokSignInResult,
  grokAccountsStatus,
  signInWithGrok,
  signOutOfGrok,
} from "@/electron-main/lib/grok-account";
import { base } from "@/electron-main/rpc/base";
import { setProviderConfigEnabled } from "@/electron-main/stores/workspace/provider-configs";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { z } from "zod";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("grok-account.updated", { signal });
    // A subscription can lapse or start while the app runs, and xAI says so
    // only when asked, so the card asks when it opens.
    void checkGrokSubscriptions({ recent: true });
    yield* liveRead({ changes: [changes], read: grokAccountsStatus });
  }),
};

/**
 * Signs in with a Grok account in the browser, through xAI's device code,
 * adding it when it is new. Answers how it ended, with what went wrong when
 * it failed.
 */
const signIn = base.handler(
  async (): Promise<
    GrokSignInResult | { error: string; outcome: "failed" }
  > => {
    try {
      const result = await signInWithGrok();
      if (result.account?.state === "signed-in") {
        getWorkspaceState().set("hasCompletedProviderSetup", true);
      }
      return result;
    } catch (error) {
      captureServerException(
        new Error("Grok sign-in failed", { cause: error }),
        { area: "auth" },
      );
      return {
        error: error instanceof Error ? error.message : "Sign-in failed",
        outcome: "failed",
      };
    }
  },
);

const signOut = base
  .input(z.object({ accountId: z.string() }))
  .handler(async ({ input }) => {
    await signOutOfGrok(input);
    setProviderConfigEnabled(
      AIProviderConfigIdSchema.parse(input.accountId),
      true,
    );
  });

const cancelSignIn = base.handler(() => {
  cancelGrokSignIn();
});

/** Asks xAI again which subscription the account has. */
const checkSubscription = base
  .input(z.object({ accountId: z.string() }))
  .handler(async ({ input }) => {
    await checkGrokSubscriptions(input);
  });

export const grokAccount = {
  cancelSignIn,
  checkSubscription,
  live,
  signIn,
  signOut,
};

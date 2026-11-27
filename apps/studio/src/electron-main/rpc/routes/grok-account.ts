import {
  appChanged,
  grokPlanSignedInHere,
  liveRead,
} from "@instrument-org/workspace/electron";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  cancelGrokSignIn,
  checkGrokSubscriptions,
  type GrokSignInResult,
  grokAccountsStatus,
  signInWithGrok,
  signOutOfGrok,
} from "@/electron-main/lib/grok-account";
import { PlanSignInOpensInSchema } from "@/electron-main/lib/plan-sign-in-page";
import { base } from "@/electron-main/rpc/base";
import { setProviderConfigEnabled } from "@/electron-main/stores/workspace/provider-configs";
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
 * it failed. A plan signed in is what X's search runs on, so X hears of it
 * (`grokPlanSignedInHere`); one turned down on xAI's page turns down the
 * plan row of the app that asked for it, if one did, and leaves that app's
 * own connection, which is its site's.
 */
const signIn = base
  .input(
    z.object({
      /** The app whose sign-in card row asked for the plan. */
      forApp: z.string().optional(),
      opensIn: PlanSignInOpensInSchema,
    }),
  )
  .handler(
    async ({
      input: { forApp, opensIn },
    }): Promise<GrokSignInResult | { error: string; outcome: "failed" }> => {
      try {
        const result = await signInWithGrok({ opensIn });
        if (
          result.outcome === "signed-in" &&
          result.account?.state === "signed-in"
        ) {
          await grokPlanSignedInHere().catch((error: unknown) => {
            captureServerException(
              new Error("Setting up X after a Grok sign-in failed", {
                cause: error,
              }),
              { area: "auth" },
            );
          });
        }
        if (result.outcome === "declined" && forApp !== undefined) {
          await appChanged(forApp, { event: "declined", plan: "grok" });
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

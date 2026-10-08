import { liveRead } from "@instrument-org/workspace/electron";
import { startAuthCallbackServer } from "@/electron-main/auth/server";
import { checkChatGPTAccount } from "@/electron-main/lib/account-check";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  cancelChatGPTSignIn,
  type ChatGPTSignInResult,
  chatGPTAccountsStatus,
  signInWithChatGPT,
  signOutOfChatGPT,
  verifyAccounts,
} from "@/electron-main/lib/chatgpt-account";
import { setChatGPTAccountDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { z } from "zod";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("chatgpt-account.updated", { signal });
    void verifyAccounts();
    yield* liveRead({ changes: [changes], read: chatGPTAccountsStatus });
  }),
};

/**
 * Signs in to the account `accountId` names, or, without one, to whichever
 * account the browser signs in to, adding it when it is new. Answers how it
 * ended, with what went wrong when it failed.
 */
const signIn = base
  .input(z.object({ accountId: z.string().optional() }))
  .handler(
    async ({
      context,
      input,
    }): Promise<ChatGPTSignInResult | { error: string; outcome: "failed" }> => {
      try {
        const server = await startAuthCallbackServer();
        if (!server) {
          throw new Error("The sign-in callback server isn't running");
        }
        const result = await signInWithChatGPT({
          accountId: input.accountId,
          callbackPort: server.port,
        });
        if (result.outcome === "signed-in") {
          // A plan is a way to run models like a provider or an account, so
          // the app opens on the window from now on, as it does after either
          // of those.
          getWorkspaceState().set("hasCompletedProviderSetup", true);
          context.workspaceConfig.captureEvent("provider.created", {
            provider_type: "chatgpt-account",
          });
        }
        return result;
      } catch (error) {
        captureServerException(
          new Error("ChatGPT sign-in failed", { cause: error }),
          { scopes: ["auth"] },
        );
        return {
          error: error instanceof Error ? error.message : "Sign-in failed",
          outcome: "failed",
        };
      }
    },
  );

/**
 * Makes the account's everyday model the default when it is the only account
 * signed in, and answers with the model's name. Apart from `signIn` because it
 * reads the plan's catalog, which can take seconds, and the sign-in itself is
 * done before that.
 */
const chooseDefaultModel = base
  .input(z.object({ accountId: z.string() }))
  .handler(async ({ input }) => ({
    name: await setChatGPTAccountDefaultModel(input),
  }));

const signOut = base
  .input(z.object({ accountId: z.string() }))
  .handler(({ input }) => signOutOfChatGPT(input));

/** The user gave up on the sign-in waiting in their browser. */
const cancelSignIn = base.handler(() => {
  cancelChatGPTSignIn();
});

/**
 * Whether the account can run a turn now: ready, signed out, a plan that
 * can't be used here, or out of usage. Sends one short request on the plan,
 * so it takes a few seconds; see `checkChatGPTAccount`.
 */
const check = base
  .input(z.object({ accountId: z.string() }))
  .handler(({ context, input }) =>
    checkChatGPTAccount(input.accountId, context.workspaceConfig),
  );

export const chatgptAccount = {
  cancelSignIn,
  check,
  chooseDefaultModel,
  live,
  signIn,
  signOut,
};

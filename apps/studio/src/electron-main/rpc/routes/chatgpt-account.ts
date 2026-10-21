import { liveRead } from "@instrument-org/workspace/electron";
import { startAuthCallbackServer } from "@/electron-main/auth/server";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  cancelChatGPTSignIn,
  type ChatGPTSignInResult,
  chatGPTAccountsStatus,
  signInWithChatGPT,
  signOutOfChatGPT,
  verifyAccounts,
} from "@/electron-main/lib/chatgpt-account";
import { base } from "@/electron-main/rpc/base";
import { setProviderConfigEnabled } from "@/electron-main/stores/workspace/provider-configs";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
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
        }
        return result;
      } catch (error) {
        captureServerException(
          new Error("ChatGPT sign-in failed", { cause: error }),
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
    await signOutOfChatGPT(input);
    setProviderConfigEnabled(
      AIProviderConfigIdSchema.parse(input.accountId),
      true,
    );
  });

/** The user gave up on the sign-in waiting in their browser. */
const cancelSignIn = base.handler(() => {
  cancelChatGPTSignIn();
});

export const chatgptAccount = {
  cancelSignIn,
  live,
  signIn,
  signOut,
};

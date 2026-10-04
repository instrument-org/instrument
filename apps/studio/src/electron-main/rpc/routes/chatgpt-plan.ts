import { startAuthCallbackServer } from "@/electron-main/auth/server";
import {
  cancelChatGPTSignIn,
  chatGPTPlanStatus,
  signInWithChatGPT,
  signOutOfChatGPT,
  verifyAccounts,
} from "@/electron-main/lib/chatgpt-plan";
import { setChatGPTPlanDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { z } from "zod";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    yield chatGPTPlanStatus();
    void verifyAccounts();
    for await (const _ of publisher.subscribe("chatgpt-plan.updated", {
      signal,
    })) {
      yield chatGPTPlanStatus();
    }
  }),
};

/**
 * Signs in to the account `accountId` names, or, without one, to whichever
 * account the browser signs in to, adding it when it is new.
 */
const signIn = base
  .input(z.object({ accountId: z.string().optional() }))
  .handler(async ({ context, errors, input }) => {
    try {
      const server = await startAuthCallbackServer();
      if (!server) {
        throw new Error("The sign-in callback server isn't running");
      }
      const account = await signInWithChatGPT({
        accountId: input.accountId,
        callbackPort: server.port,
      });
      if (account?.state === "signed-in") {
        // A plan is a way to run models like a provider or an account, so the
        // app opens on the window from now on, as it does after either of
        // those.
        getWorkspaceState().set("hasCompletedProviderSetup", true);
        context.workspaceConfig.captureEvent("provider.created", {
          provider_type: "chatgpt",
        });
      }
      return account;
    } catch (error) {
      throw errors.API_ERROR({
        cause: error,
        message: error instanceof Error ? error.message : "Sign-in failed",
      });
    }
  });

/**
 * Makes the account's everyday model the default when it is the only account
 * signed in, and answers with the model's name. Apart from `signIn` because it
 * reads the plan's catalog, which can take seconds, and the sign-in itself is
 * done before that.
 */
const chooseDefaultModel = base
  .input(z.object({ accountId: z.string() }))
  .handler(async ({ input }) => ({
    name: await setChatGPTPlanDefaultModel(input),
  }));

const signOut = base
  .input(z.object({ accountId: z.string() }))
  .handler(({ input }) => signOutOfChatGPT(input));

/** The user gave up on the sign-in waiting in their browser. */
const cancelSignIn = base.handler(() => {
  cancelChatGPTSignIn();
});

export const chatgptPlan = {
  cancelSignIn,
  chooseDefaultModel,
  live,
  signIn,
  signOut,
};

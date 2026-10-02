import { startAuthCallbackServer } from "@/electron-main/auth/server";
import {
  chatGPTPlanStatus,
  signInWithChatGPT,
  signOutOfChatGPT,
  verifyActiveAccount,
} from "@/electron-main/lib/chatgpt-plan";
import { setChatGPTPlanDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    yield chatGPTPlanStatus();
    void verifyActiveAccount();
    for await (const _ of publisher.subscribe("chatgpt-plan.updated", {
      signal,
    })) {
      yield chatGPTPlanStatus();
    }
  }),
};

const signIn = base.handler(async ({ context, errors }) => {
  try {
    const server = await startAuthCallbackServer();
    if (!server) {
      throw new Error("The sign-in callback server isn't running");
    }
    const status = await signInWithChatGPT({ callbackPort: server.port });
    if (status.state === "signed-in") {
      // A plan is a way to run models like a provider or an account, so the
      // app opens on the window from now on, as it does after either of those.
      getWorkspaceState().set("hasCompletedProviderSetup", true);
      context.workspaceConfig.captureEvent("provider.created", {
        provider_type: "chatgpt",
      });
    }
    return status;
  } catch (error) {
    throw errors.API_ERROR({
      cause: error,
      message: error instanceof Error ? error.message : "Sign-in failed",
    });
  }
});

/**
 * Makes the plan's everyday model the default and answers with its name. Apart
 * from `signIn` because it reads the plan's catalog, which can take seconds,
 * and the sign-in itself is done before that.
 */
const chooseDefaultModel = base.handler(async () => ({
  name: await setChatGPTPlanDefaultModel(),
}));

const signOut = base.handler(() => signOutOfChatGPT());

export const chatgptPlan = {
  chooseDefaultModel,
  live,
  signIn,
  signOut,
};

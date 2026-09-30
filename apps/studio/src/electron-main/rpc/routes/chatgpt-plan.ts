import { startAuthCallbackServer } from "@/electron-main/auth/server";
import {
  cancelChatGPTSignIn,
  chatGPTPlanStatus,
  signInWithChatGPT,
  signOutOfChatGPT,
} from "@/electron-main/lib/chatgpt-plan";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    yield chatGPTPlanStatus();
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
      context.workspaceConfig.captureEvent("provider.created", {
        provider_type: "chatgpt",
      });
      void setDefaultModel({ onlyIfUnset: true });
    }
    return status;
  } catch (error) {
    throw errors.API_ERROR({
      cause: error,
      message: error instanceof Error ? error.message : "Sign-in failed",
    });
  }
});

const cancelSignIn = base.handler(() => {
  cancelChatGPTSignIn();
});

const signOut = base.handler(() => signOutOfChatGPT());

export const chatgptPlan = {
  cancelSignIn,
  live,
  signIn,
  signOut,
};

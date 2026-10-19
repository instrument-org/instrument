import { liveRead } from "@instrument-org/workspace/electron";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  cancelGrokSignIn,
  checkGrokAccess,
  type GrokSignInResult,
  grokAccountStatus,
  signInWithGrok,
  signOutOfGrok,
} from "@/electron-main/lib/grok-account";
import { setGrokAccountDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { setProviderConfigEnabled } from "@/electron-main/stores/workspace/provider-configs";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import {
  AIProviderConfigIdSchema,
  GROK_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("grok-account.updated", { signal });
    // A subscription can lapse or start while the app runs, and xAI says so
    // only when asked, so the card asks when it opens.
    void checkGrokAccess({ recent: true });
    yield* liveRead({ changes: [changes], read: grokAccountStatus });
  }),
};

/**
 * Signs in with a Grok subscription in the browser, through xAI's device
 * code. Answers how it ended, with what went wrong when it failed.
 */
const signIn = base.handler(
  async (): Promise<
    GrokSignInResult | { error: string; outcome: "failed" }
  > => {
    try {
      const result = await signInWithGrok();
      if (result.outcome === "signed-in") {
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

/** Makes the account's default model the default, and answers with its name. */
const chooseDefaultModel = base.handler(async () => ({
  name: await setGrokAccountDefaultModel(),
}));

const signOut = base.handler(async () => {
  await signOutOfGrok();
  setProviderConfigEnabled(
    AIProviderConfigIdSchema.parse(GROK_ACCOUNT_PROVIDER_CONFIG.id),
    true,
  );
});

const cancelSignIn = base.handler(() => {
  cancelGrokSignIn();
});

/** Asks xAI again whether a refused account may use its models now. */
const checkAccess = base.handler(async () => {
  await checkGrokAccess();
});

export const grokAccount = {
  cancelSignIn,
  checkAccess,
  chooseDefaultModel,
  live,
  signIn,
  signOut,
};

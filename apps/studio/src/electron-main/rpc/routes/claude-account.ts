import { liveRead } from "@instrument-org/workspace/electron";
import {
  cancelClaudeSignIn,
  claudeAccountStatus,
  claudeAccountUsage,
  signInToClaude,
  signOutOfClaude,
  submitClaudeSignInCode,
  refreshClaudeAccountStatus,
} from "@/electron-main/lib/claude-account";
import { base } from "@/electron-main/rpc/base";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { setProviderConfigEnabled } from "@/electron-main/stores/workspace/provider-configs";
import {
  AIProviderConfigIdSchema,
  CLAUDE_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { z } from "zod";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("claude-account.updated", { signal });
    void refreshClaudeAccountStatus({ force: true });
    yield* liveRead({ changes: [changes], read: claudeAccountStatus });
  }),
};

/**
 * Signs in to Claude: installs our copy of Claude Code when it is not in yet,
 * opens Anthropic's sign-in page in the browser, and answers once the sign-in
 * ends, with the account read back. Signed in already, it answers at once.
 * Connecting the account (the check and the default model) is
 * `accountCheck.connect`.
 */
const signIn = base.handler(async () => {
  const result = await signInToClaude();
  if (result.status.kind === "signed-in") {
    // A plan is a way to run models, so the app opens on the window from
    // now on, as it does after a provider or another account.
    getWorkspaceState().set("hasCompletedProviderSetup", true);
  }
  return result;
});

/**
 * Passes the waiting sign-in the code Anthropic's page showed on another
 * device, for when the browser could not get back on its own.
 */
const submitSignInCode = base
  .input(z.object({ code: z.string().min(1) }))
  .handler(({ input }) => submitClaudeSignInCode(input.code));

/** Gives up on a sign-in still waiting on the browser. */
const cancelSignIn = base.handler(() => {
  cancelClaudeSignIn();
});

/** Signs Instrument's copy of Claude Code out of its Claude account. */
const signOut = base.handler(async () => {
  const status = await signOutOfClaude();
  // Signing in again later starts the account on.
  setProviderConfigEnabled(
    AIProviderConfigIdSchema.parse(CLAUDE_ACCOUNT_PROVIDER_CONFIG.id),
    true,
  );
  return status;
});

/** The subscription's usage by window, read fresh from Claude Code each time. */
const usage = base.handler(() => claudeAccountUsage());

export const claudeAccount = {
  cancelSignIn,
  live,
  signIn,
  signOut,
  submitSignInCode,
  usage,
};

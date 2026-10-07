import { liveRead } from "@instrument-org/workspace/electron";
import {
  cancelClaudeSignIn,
  claudeAccountStatus,
  claudeAccountUsage,
  installClaudeCode,
  openClaudeSignIn,
  signOutOfClaude,
  submitClaudeSignInCode,
  refreshClaudeAccountStatus,
} from "@/electron-main/lib/claude-account";
import { setClaudeAccountDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
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
 * then opens Anthropic's sign-in page in the browser.
 */
const signIn = base.handler(() => openClaudeSignIn());

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
const signOut = base.handler(() => signOutOfClaude());

/** Looks again, after the person says they have signed in. */
const refresh = base.handler(() => refreshClaudeAccountStatus({ force: true }));

/**
 * Uses the Claude account Claude Code is signed in to, when it is: setup is
 * done, and the model Claude Code recommends becomes the default. Answers the
 * status either way, and the model's name when one was chosen.
 */
const connect = base.handler(async ({ context }) => {
  const status = await refreshClaudeAccountStatus({ force: true });
  if (status.kind !== "signed-in") {
    return { modelName: undefined, status };
  }
  getWorkspaceState().set("hasCompletedProviderSetup", true);
  context.workspaceConfig.captureEvent("provider.created", {
    provider_type: "claude-account",
  });
  return { modelName: await setClaudeAccountDefaultModel(), status };
});

/**
 * Installs our copy of Claude Code, the release this build drives. The status
 * carries its progress; this answers once it is in or has failed.
 */
const install = base.handler(() => installClaudeCode());

/** The subscription's usage by window, read fresh from Claude Code each time. */
const usage = base.handler(() => claudeAccountUsage());

export const claudeAccount = {
  cancelSignIn,
  connect,
  install,
  live,
  refresh,
  signIn,
  signOut,
  submitSignInCode,
  usage,
};

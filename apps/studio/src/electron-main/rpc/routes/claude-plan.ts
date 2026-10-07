import { liveRead } from "@instrument-org/workspace/electron";
import {
  claudePlanStatus,
  claudePlanUsage,
  installClaudeCode,
  openClaudeSignIn,
  refreshClaudePlanStatus,
  setClaudeCodeSetup,
} from "@/electron-main/lib/claude-plan";
import { setClaudePlanDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { dialog } from "electron";
import { homedir } from "node:os";
import { z } from "zod";

import { publisher } from "../publisher";

const live = {
  status: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("claude-plan.updated", { signal });
    void refreshClaudePlanStatus({ force: true });
    yield* liveRead({ changes: [changes], read: claudePlanStatus });
  }),
};

/** Opens a terminal at the CLI's own sign-in. */
const signIn = base.handler(() => openClaudeSignIn());

/** Looks again, after the person says they have installed or signed in. */
const refresh = base.handler(() => refreshClaudePlanStatus({ force: true }));

/**
 * Uses the Claude account Claude Code is signed in to, when it is: setup is
 * done, and the model Claude Code recommends becomes the default. Answers the
 * status either way, and the model's name when one was chosen.
 */
const connect = base.handler(async ({ context }) => {
  const status = await refreshClaudePlanStatus({ force: true });
  if (status.kind !== "signed-in") {
    return { modelName: undefined, status };
  }
  getWorkspaceState().set("hasCompletedProviderSetup", true);
  context.workspaceConfig.captureEvent("provider.created", {
    provider_type: "claude-plan",
  });
  return { modelName: await setClaudePlanDefaultModel(), status };
});

/** The plan's usage by window, read fresh from the CLI each time. */
const usage = base.handler(() => claudePlanUsage());

/**
 * Installs our own copy of Claude Code, the release this build drives. The
 * status carries its progress; this answers once it is in or has failed.
 */
const install = base.handler(() => installClaudeCode());

/**
 * The system's own panel, for the Claude Code executable or the folder of a
 * second Claude sign-in. Both usually sit in hidden folders, so the panel
 * shows them. Answers the chosen path, or null when canceled.
 */
const pick = base
  .input(z.object({ kind: z.enum(["executable", "configDir"]) }))
  .output(z.object({ path: z.string() }).nullable())
  .handler(async ({ context, input }) => {
    const options: Electron.OpenDialogOptions = {
      buttonLabel: "Choose",
      defaultPath: homedir(),
      message:
        input.kind === "executable"
          ? "Choose the Claude Code executable"
          : "Choose the folder of the Claude sign-in to use",
      properties:
        input.kind === "executable"
          ? ["openFile", "showHiddenFiles"]
          : ["openDirectory", "showHiddenFiles", "createDirectory"],
    };
    const parentWindow = getCallingWindow(context.webContentsId);
    const result = await (parentWindow
      ? dialog.showOpenDialog(parentWindow, options)
      : dialog.showOpenDialog(options));
    const [chosen] = result.filePaths;
    return result.canceled || !chosen ? null : { path: chosen };
  });

/** Which CLI and config folder to use; empty means the default. */
const setSetup = base
  .input(
    z.object({
      configDir: z.string().optional(),
      executablePath: z.string().optional(),
    }),
  )
  .handler(({ input }) => setClaudeCodeSetup(input));

export const claudePlan = {
  connect,
  install,
  live,
  pick,
  refresh,
  setSetup,
  signIn,
  usage,
};

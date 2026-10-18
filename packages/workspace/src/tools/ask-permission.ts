import ms from "ms";
import { ok } from "neverthrow";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { z } from "zod";

import { recordAsk } from "../lib/chat/asks";
import { withoutDataVolume } from "../lib/host-path";
import {
  accountCanWrite,
  systemOwnedNote,
} from "../lib/permissions/account-can-write";
import { appBundleId, appLevel, appRefusal } from "../lib/permissions/apps";
import { chatRules } from "../lib/permissions/chat-rules";
import { reachOf } from "../lib/permissions/rules";
import { askableFolder, closedNote } from "../lib/permissions/rules-fs";
import { hostPathOf, shellPath } from "../lib/workspace-fs-layout";
import { WINDOW_ID } from "../schemas/window-id";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Ask the person to let this chat use a folder or a Mac app, the one way a
 * permission card goes up. The call records the ask and returns at once,
 * and the turn ends on it (`shouldContinueAfterHandingOff`): the card waits
 * on the person, and their answer wakes every session that asked.
 *
 * The folder asked for is the app's to decide, never the agent's: it is the
 * one a refusal would name (`askableFolder`), so no call opens the home
 * folder, a disk, or the app's own data whole.
 */
export const AskPermission = setupTool({
  inputSchema: BaseInputSchema.extend({
    kind: z.enum(["app", "folder"]).meta({
      description: "A folder, or a Mac app such as Messages or Shortcuts.",
    }),
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence to the user saying what you need it for: 'So I can put the copy on your Desktop.'",
    }),
    target: z.string().trim().min(1).meta({
      description:
        "For a folder, its full path, or the path of a file in it. For an app, its name as macOS shows it: 'Messages'.",
    }),
  }),
  name: "ask_permission",
  outputSchema: z.discriminatedUnion("state", [
    z.object({
      kind: z.enum(["app", "folder"]),
      state: z.literal("asked"),
      /** The folder's absolute path, or the app's name, as the card names it. */
      target: z.string(),
    }),
    z.object({ state: z.literal("allowed"), target: z.string() }),
    z.object({ message: z.string(), state: z.literal("refused") }),
  ]),
}).create({
  description:
    "Ask the user to let you use a folder or a Mac app that needs their yes: a card shows them what you asked for and your reason. Your turn ends with this call, and their answer wakes you. Ask for each thing the work needs in one step.",
  execute: async ({ chatId, input, partId, sessionId }) => {
    if (chatId === WINDOW_ID) {
      return ok({
        message: "Nobody can answer a card here.",
        state: "refused" as const,
      });
    }
    const decided =
      input.kind === "folder"
        ? await folderToAsk(chatId, input.target)
        : await appToAsk(chatId, input.target);
    if (decided.state !== "ask") {
      return ok(decided);
    }
    await recordAsk(
      { chatId, partId, reason: input.reason, sessionId },
      input.kind,
      decided.target,
    );
    return ok({
      kind: input.kind,
      state: "asked" as const,
      target: decided.target,
    });
  },
  readOnly: true,
  timeoutMs: ms("10 seconds"),
  toModelOutput: ({ output }) => {
    switch (output.state) {
      case "asked": {
        return {
          type: "text",
          value: `The user now sees a card asking for ${JSON.stringify(shellPath(output.target))}. Their answer reaches you as a message of its own.`,
        };
      }
      case "allowed": {
        return {
          type: "text",
          value: `${JSON.stringify(output.target)} is already allowed in this chat. Run again what needed it.`,
        };
      }
      case "refused": {
        return { type: "error-text", value: output.message };
      }
    }
  },
});

type Decided =
  | { message: string; state: "refused" }
  | { state: "allowed"; target: string }
  | { state: "ask"; target: string };

/** The folder a card asks for to open `given`, by the rules, or why none can. */
async function folderToAsk(
  chatId: Parameters<typeof chatRules>[0]["chatId"],
  given: string,
): Promise<Decided> {
  const home = os.homedir();
  const spelled =
    given === "~"
      ? home
      : given.startsWith("~/")
        ? nodePath.join(home, given.slice(2))
        : hostPathOf(given);
  if (!nodePath.isAbsolute(spelled)) {
    return {
      message: `${JSON.stringify(given)} is not a full path. Ask for the folder by its full path.`,
      state: "refused",
    };
  }
  const hostPath = withoutDataVolume(nodePath.resolve(spelled));
  const rules = await chatRules({ chatId });
  const shown = (path: string) => JSON.stringify(shellPath(path));
  const reach = reachOf(rules, hostPath, "write");
  if (reach.level === "allow") {
    return { state: "allowed", target: shellPath(hostPath) };
  }
  if (reach.level === "never") {
    return { message: closedNote(reach, shown(hostPath)), state: "refused" };
  }
  if (!accountCanWrite(hostPath)) {
    return { message: systemOwnedNote(shown(hostPath)), state: "refused" };
  }
  const asked = askableFolder({
    hostPath,
    // A path that is not there yet is a folder to be made.
    isDirectory: !existsSync(hostPath) || statSync(hostPath).isDirectory(),
    onDisk: true,
    rule: reach.rule,
    rules,
    shown,
  });
  if ("refusal" in asked) {
    return { message: asked.refusal, state: "refused" };
  }
  return { state: "ask", target: asked.folder };
}

/** The app a card asks for by `given`, or why none can. */
async function appToAsk(
  chatId: Parameters<typeof chatRules>[0]["chatId"],
  given: string,
): Promise<Decided> {
  const bundleId = await appBundleId(given);
  if (bundleId === undefined) {
    return {
      message: `No app called ${JSON.stringify(given)} is on this computer.`,
      state: "refused",
    };
  }
  const app = { bundleId, name: given };
  const level = await appLevel(chatId, app);
  if (level === "allow") {
    return { state: "allowed", target: given };
  }
  if (level === "never") {
    return {
      message: (await appRefusal(chatId, app, undefined)) ?? "",
      state: "refused",
    };
  }
  return { state: "ask", target: given };
}

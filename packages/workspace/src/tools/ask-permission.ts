import ms from "ms";
import { ok } from "neverthrow";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { z } from "zod";

import { setTimeout as sleep } from "node:timers/promises";

import { recordAsk } from "../lib/chat/asks";
import {
  lookAsTheApp,
  macosAppCard,
  macosRefusalStatus,
} from "../lib/permissions/macos";
import { withoutDataVolume } from "../lib/host-path";
import {
  accountCanWrite,
  systemOwnedNote,
} from "../lib/permissions/account-can-write";
import { MAC_APPS } from "../lib/mac-apps/apps";
import { appBundleId, appLevel, appRefusal } from "../lib/permissions/apps";
import { APP_COMMAND } from "../lib/shell-commands/app-command";
import { chatRules } from "../lib/permissions/chat-rules";
import { reachOf } from "../lib/permissions/rules";
import { askableFolder, closedNote } from "../lib/permissions/rules-fs";
import { hostPathOf, shellPath } from "../lib/workspace-fs-layout";
import { WINDOW_ID } from "../schemas/window-id";
import { defineCapability } from "../lib/capabilities/define";
import { modelTool } from "../lib/capabilities/tool";

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
const askPermissionCapability = defineCapability({
  input: z.object({
    kind: z.enum(["app", "folder"]).meta({
      description: "A folder, or a Mac app such as Shortcuts.",
    }),
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence to the user saying what you need it for: 'So I can put the copy on your Desktop.'",
    }),
    target: z.string().trim().min(1).meta({
      description:
        "For a folder, its full path, or the path of a file in it. For an app, its name as macOS shows it: 'Shortcuts'.",
    }),
  }),
  name: "asks.permission",
  summary:
    "Asks the person for a folder or a Mac app; the turn ends on the card.",
  surfaces: {
    tool: {
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
        if (decided.state === "allowed" && decided.macos !== undefined) {
          // The person's rules let it in, so whatever refused it was macOS,
          // which is asking the person, refusing, or keeping it to its own app:
          // the card for that goes up instead of an "allowed" the agent can only
          // run into again.
          const asker = { chatId, partId, reason: input.reason, sessionId };
          const macos = await decided.macos(asker);
          if (macos !== undefined) {
            return ok(askedFor(input.kind, macos));
          }
        }
        if (decided.state !== "ask") {
          return ok(
            decided.state === "allowed"
              ? { state: decided.state, target: decided.target }
              : decided,
          );
        }
        await recordAsk(
          { chatId, partId, reason: input.reason, sessionId },
          input.kind,
          decided.target,
        );
        return ok(askedFor(input.kind, decided.target));
      },
      readOnly: true,
      timeoutMs: () => ms("10 seconds"),
      toModelOutput: ({ output }) => {
        switch (output.state) {
          case "asked": {
            return {
              type: "text",
              value: `The user now sees a card asking for ${JSON.stringify(output.agentTarget ?? shellPath(output.target))}. Their answer reaches you as a message of its own.`,
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
      name: "ask_permission",
      output: z.discriminatedUnion("state", [
        z.object({
          /** The target as the agent's shell spelled it when asked, which the model is told. */
          agentTarget: z.string().optional(),
          kind: z.enum(["app", "folder"]),
          state: z.literal("asked"),
          /** The folder's absolute path, or the app's name, as the card names it. */
          target: z.string(),
        }),
        z.object({ state: z.literal("allowed"), target: z.string() }),
        z.object({ message: z.string(), state: z.literal("refused") }),
      ]),
    },
  },
});

export const AskPermission = modelTool(askPermissionCapability);

/**
 * The output for a card raised: a folder also as the shell spells it now,
 * which is what the model is told on every later request.
 */
function askedFor(kind: "app" | "folder", target: string) {
  return {
    ...(kind === "folder" && { agentTarget: shellPath(target) }),
    kind,
    state: "asked" as const,
    target,
  };
}

type Decided =
  | { message: string; state: "refused" }
  | {
      /**
       * Raises the card for macOS's own answer when macOS keeps the app
       * out, answering what the card asks for; nothing when it lets it in.
       */
      macos?: (
        asker: Parameters<typeof recordAsk>[0],
      ) => Promise<string | undefined>;
      state: "allowed";
      target: string;
    }
  | { state: "ask"; target: string };

/**
 * How long the look inside a folder is waited for with no macOS prompt on
 * screen, after which the folder counts as not kept out by macOS (a slow
 * disk), and the call returns while the look goes on.
 */
const LOOK_PATIENCE_MS = 5000;

/**
 * The card for a folder the rules allow that macOS keeps the app out of,
 * raised when the look inside is refused, or waits while macOS's prompt
 * about it is on screen; the card that is asking settles on their answer.
 * Its folder, or nothing when macOS lets the app in.
 */
async function macosFolderCard(
  asker: Parameters<typeof recordAsk>[0],
  hostPath: string,
): Promise<string | undefined> {
  const folder =
    existsSync(hostPath) && !statSync(hostPath).isDirectory()
      ? nodePath.dirname(hostPath)
      : hostPath;
  let prompted = () => {};
  const asking = new Promise<"asking">((resolve) => {
    prompted = () => {
      resolve("asking");
    };
  });
  const early = await Promise.race([
    lookAsTheApp(folder, async () => {
      prompted();
    }),
    asking,
    sleep(LOOK_PATIENCE_MS).then(() => "slow" as const),
  ]);
  const status =
    early === "system"
      ? macosRefusalStatus(folder)
      : early === "asking"
        ? "macos-asking"
        : undefined;
  if (status === undefined) {
    return undefined;
  }
  await recordAsk(asker, "folder", folder, { allowed: "allowed", status });
  return folder;
}

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
    return {
      ...(process.platform === "darwin" && {
        macos: (asker) => macosFolderCard(asker, hostPath),
      }),
      state: "allowed",
      target: shellPath(hostPath),
    };
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
  // One of the Mac's own apps is an app in Apps, which connecting covers
  // every chat for; its tools raise macOS's card themselves.
  const inApps = MAC_APPS.find((each) => each.bundleId === bundleId);
  if (inApps !== undefined) {
    return {
      message: `${inApps.name} is an app in Apps rather than something to ask for here. Use it with \`${APP_COMMAND.name} call ${inApps.server}\`; if it isn't connected, \`${APP_COMMAND.name} catalog ${inApps.server}\` has its set-up line, then connect_app.`,
      state: "refused",
    };
  }
  const app = { bundleId, name: given };
  const level = await appLevel(chatId, app);
  if (level === "allow") {
    return {
      macos: async (asker) =>
        (await macosAppCard(asker, app)) === undefined ? undefined : given,
      state: "allowed",
      target: given,
    };
  }
  if (level === "never") {
    return {
      message: (await appRefusal(chatId, app, undefined)) ?? "",
      state: "refused",
    };
  }
  return { state: "ask", target: given };
}

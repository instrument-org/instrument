import {
  clearDownloads,
  removeDownloadsAt,
} from "@/electron-main/browser-view/download-list";
import { getHistoryStore } from "@/electron-main/browser-view/history-store";
import { activityExportCsv } from "@/electron-main/lib/activity-csv";
import { base } from "@/electron-main/rpc/base";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { APP_NAME } from "@instrument-org/shared";
import {
  type Action,
  ActionSchema,
  actionLog,
  activityCsv,
  clearOwnActivity,
  countOwnActivity,
  LoggedActionSchema,
  readActions,
  removeOwnActivity,
  REPEAT_WINDOW_MS,
} from "@instrument-org/workspace/electron";
import { app, dialog } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Saves what the Activity screen shows, as its `view` picks it, to a CSV
 * file the person picks: the AI requests, what the person did, or both. A
 * copy of their own rather than the records themselves: a record is the
 * only copy of what it holds, so it is never shown in the Finder for someone
 * to move or delete by accident.
 */
const saveCsv = base
  .input(z.object({ view: z.enum(["all", "yours", "ai"]) }))
  .output(z.object({ status: z.enum(["canceled", "failed", "saved"]) }))
  .handler(async ({ context, input }) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const defaultPath = path.join(
      app.getPath("downloads"),
      `${APP_NAME.toLowerCase()}-activity-${stamp}.csv`,
    );
    const parent = getCallingWindow(context.webContentsId);
    // Parented so macOS presents a sheet on the window rather than blocking
    // the whole app.
    const result = await (parent
      ? dialog.showSaveDialog(parent, { defaultPath })
      : dialog.showSaveDialog({ defaultPath }));
    if (result.canceled || !result.filePath) {
      return { status: "canceled" as const };
    }
    try {
      const csv = activityExportCsv({
        actions:
          input.view === "ai"
            ? undefined
            : (await readActions({ since: 0 }))
                .filter((action) => action.kind !== "capped")
                .toReversed(),
        requests: input.view === "yours" ? undefined : await activityCsv({}),
      });
      await fs.writeFile(result.filePath, csv);
      return { status: "saved" as const };
    } catch {
      return { status: "failed" as const };
    }
  });

const SinceSchema = z.object({
  /** Epoch ms; absent means all time. */
  since: z.number().optional(),
});

/**
 * Which box of the Clear dialog takes an action: what the person opened, what
 * they changed, or neither. The pages they visited are the browser's history,
 * which Clear browsing data takes, and a permission answered is a rule of its
 * chat's, which stays. A line saying where the log stopped goes with the kind
 * it left out.
 */
function boxOf(action: Action): "changes" | "opened" | undefined {
  const kind: string = action.kind === "capped" ? action.of : action.kind;
  switch (kind) {
    case "page":
    case "permission": {
      return undefined;
    }
    case "chat":
    case "download":
    case "file":
    case "folder":
    case "open-with":
    case "screen": {
      return "opened";
    }
    default: {
      return "changes";
    }
  }
}

/** Whether an action is one History lists: not where the log stopped, nor a visit to one of the app's screens. */
function isListed(action: Action) {
  return action.kind !== "capped" && action.kind !== "screen";
}

/**
 * What clearing from `since` would take, for the Clear dialog: how many
 * things the person opened and how many they changed in that time, and how
 * many AI requests this computer made.
 */
const summary = base
  .input(SinceSchema)
  .output(
    z.object({
      changes: z.number(),
      opened: z.number(),
      requests: z.number(),
    }),
  )
  .handler(async ({ input }) => {
    const [actions, requests] = await Promise.all([
      readActions({ since: input.since ?? 0 }),
      countOwnActivity(input.since),
    ]);
    const listed = actions.filter(isListed).map(boxOf);
    return {
      changes: listed.filter((box) => box === "changes").length,
      opened: listed.filter((box) => box === "opened").length,
      requests,
    };
  });

/**
 * Clears from `since` (all time when absent) what the person picked. What
 * they opened is the action log's folders and chats, the history's file
 * opens, which takes the recent files, and the finished downloads on the
 * download list; what they changed is the rest of the action log. The AI
 * requests are this computer's alone, since another device's are its own to
 * write.
 */
const clear = base
  .input(
    SinceSchema.extend({
      changes: z.boolean(),
      opened: z.boolean(),
      requests: z.boolean(),
    }),
  )
  .handler(async ({ input }) => {
    const { changes, opened } = input;
    if (changes && opened) {
      actionLog().clear(input.since);
    } else if (changes || opened) {
      const box = changes ? "changes" : "opened";
      actionLog().clear(input.since, (action) => boxOf(action) === box);
    }
    if (opened) {
      getHistoryStore().clearFileOpens(input.since);
      clearDownloads(input.since);
    }
    if (input.requests) {
      await clearOwnActivity(input.since);
    }
  });

/**
 * Takes rows out of Activity: what the person did, each from where it is
 * kept (a page or a file opened from the history with the repeats the row
 * stood for, a download from the download list, the rest from the action
 * log), and the AI requests named, those this computer made, answering how
 * many of them were another computer's and stayed. A permission answered is
 * a rule of its chat's, which stays.
 */
const remove = base
  .input(
    z.object({
      actions: z.array(ActionSchema),
      requests: z.array(z.string()),
    }),
  )
  .handler(async ({ input }) => {
    const openings: Parameters<
      ReturnType<typeof getHistoryStore>["removeOpenings"]
    >[0][number][] = [];
    const downloads: { at: number; path: string; since: number }[] = [];
    const logged = [];
    for (const action of input.actions) {
      const at = Date.parse(action.at);
      const since = at - REPEAT_WINDOW_MS + 1;
      switch (action.kind) {
        case "page": {
          openings.push({ at, kind: "page", since, url: action.url });
          break;
        }
        case "file": {
          openings.push({ at, kind: "file", path: action.path, since });
          break;
        }
        case "open-with": {
          openings.push({
            ...(action.app === undefined ? {} : { app: action.app }),
            at,
            kind: "open-with",
            path: action.path,
            since,
          });
          break;
        }
        case "download": {
          downloads.push({ at, path: action.path, since: at });
          break;
        }
        case "permission": {
          break;
        }
        default: {
          const line = LoggedActionSchema.safeParse(action);
          if (line.success) {
            logged.push(line.data);
          }
        }
      }
    }
    actionLog().remove(logged);
    getHistoryStore().removeOpenings(openings);
    removeDownloadsAt(downloads);
    const { removed } = await removeOwnActivity(input.requests);
    // Another computer's requests are its own to write, so they stay.
    return { requestsKept: input.requests.length - removed };
  });

export const activity = { clear, remove, saveCsv, summary };

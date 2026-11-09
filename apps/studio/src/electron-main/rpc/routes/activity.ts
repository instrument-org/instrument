import {
  clearDownloads,
  downloadsBetween,
  removeDownloadsAt,
} from "@/electron-main/browser-view/download-list";
import { getHistoryStore } from "@/electron-main/browser-view/history-store";
import { activityExportCsv } from "@/electron-main/lib/activity-csv";
import { base } from "@/electron-main/rpc/base";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { APP_NAME } from "@instrument-org/shared";
import {
  ActionSchema,
  actionLog,
  activityCsv,
  clearOwnActivity,
  countOwnActivity,
  type HistoryAction,
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
 * What clearing from `since` would take, for the Clear activity dialog: how
 * many things the person did in that time, from the action log and the
 * app's history together, and how many AI requests this computer made.
 */
const summary = base
  .input(SinceSchema)
  .output(z.object({ actions: z.number(), requests: z.number() }))
  .handler(async ({ input }) => {
    const [actions, requests] = await Promise.all([
      readActions({ since: input.since ?? 0 }),
      countOwnActivity(input.since),
    ]);
    return {
      // A permission answered is a rule of the chat's, which clearing
      // leaves as it is.
      actions: actions.filter(
        (action) => action.kind !== "capped" && action.kind !== "permission",
      ).length,
      requests,
    };
  });

/**
 * Clears from `since` (all time when absent) what the person picked. Their
 * activity is the action log, the history's visits, which takes the
 * address field's suggestions with it, the history's file opens, which
 * takes the recent files, and the finished downloads on the download list. The AI requests are this computer's alone, since
 * another device's are its own to write.
 */
const clear = base
  .input(SinceSchema.extend({ actions: z.boolean(), requests: z.boolean() }))
  .handler(async ({ input }) => {
    if (input.actions) {
      actionLog().clear(input.since);
      const history = getHistoryStore();
      history.clear(input.since);
      history.clearFileOpens(input.since);
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
 * log), and the AI requests named, those this computer made. A permission
 * answered is a rule of its chat's, which stays.
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
        case "file":
        case "open-with": {
          openings.push({ at, kind: action.kind, path: action.path, since });
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
    await removeOwnActivity(input.requests);
  });

/**
 * The other times the person opened what one Activity row names, newest
 * first: the visits to a page, the openings of a file, or the downloads that
 * landed at a path.
 */
const openings = base
  .input(
    z.union([
      z.object({ url: z.string() }),
      z.object({ download: z.literal(true), path: z.string() }),
      z.object({ path: z.string() }),
    ]),
  )
  .handler(({ input }): HistoryAction[] => {
    const range = { limit: 20, since: 0, until: Date.now() };
    if ("url" in input) {
      return getHistoryStore().personHistory({ ...range, url: input.url });
    }
    if ("download" in input) {
      return downloadsBetween({ since: 0, until: range.until })
        .filter(
          (download) =>
            download.kind === "download" && download.path === input.path,
        )
        .slice(0, range.limit);
    }
    return getHistoryStore().personHistory({ ...range, path: input.path });
  });

export const activity = { clear, openings, remove, saveCsv, summary };

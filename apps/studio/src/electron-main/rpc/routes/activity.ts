import { getHistoryStore } from "@/electron-main/browser-view/history-store";
import { activityExportCsv } from "@/electron-main/lib/activity-csv";
import { base } from "@/electron-main/rpc/base";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { APP_NAME } from "@instrument-org/shared";
import {
  actionLog,
  activityCsv,
  clearOwnActivity,
  countOwnActivity,
  readActions,
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
 * address field's suggestions with it, and the history's file opens, which
 * takes the recent files. The AI requests are this computer's alone, since
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
    }
    if (input.requests) {
      await clearOwnActivity(input.since);
    }
  });

export const activity = { clear, saveCsv, summary };

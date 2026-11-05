import { activityExportCsv } from "@/electron-main/lib/activity-csv";
import { base } from "@/electron-main/rpc/base";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { APP_NAME } from "@instrument-org/shared";
import { activityCsv, readActions } from "@instrument-org/workspace/electron";
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

export const activity = { saveCsv };

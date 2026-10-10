import { base } from "@/electron-main/rpc/base";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import { APP_NAME } from "@instrument-org/shared";
import {
  aiUsageCsv,
  AIUsageFilterSchema,
} from "@instrument-org/workspace/electron";
import { app, dialog } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Saves the AI usage log, as the filters show it, to a CSV file the person
 * picks. A copy of their own rather than the record itself: the record is
 * the only copy of what it holds, so it is never shown in the Finder for
 * someone to move or delete by accident.
 */
const saveCsv = base
  .input(z.object({ filter: AIUsageFilterSchema }))
  .output(z.object({ status: z.enum(["canceled", "failed", "saved"]) }))
  .handler(async ({ context, input }) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const defaultPath = path.join(
      app.getPath("downloads"),
      `${APP_NAME.toLowerCase()}-ai-usage-${stamp}.csv`,
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
      await fs.writeFile(result.filePath, aiUsageCsv(input.filter));
      return { status: "saved" as const };
    } catch {
      return { status: "failed" as const };
    }
  });

export const aiUsage = { saveCsv };

import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
import Store from "electron-store";
import { z } from "zod";

/** A download a person started in the in-app browser, as its list keeps it. */
const BrowserDownloadSchema = z.object({
  filename: z.string(),
  id: z.string(),
  // Where the file is saved; null when no folder would take it.
  path: z.string().nullable(),
  receivedBytes: z.number(),
  startedAt: z.number(),
  // `interrupted` is still running: the network dropped it, and Chromium
  // resumes it when it can or a person stops it.
  state: z.enum([
    "canceled",
    "completed",
    "failed",
    "interrupted",
    "progressing",
  ]),
  // Zero when the server did not say how large the file is.
  totalBytes: z.number(),
  url: z.string(),
});

export type BrowserDownload = z.output<typeof BrowserDownloadSchema>;

const DownloadsSchema = z.object({
  downloads: z.array(BrowserDownloadSchema).catch([]),
});

type Downloads = z.output<typeof DownloadsSchema>;

let STORE: null | Store<Downloads> = null;

/** The in-app browser's download list, newest first. */
export const getDownloadsStore = (): Store<Downloads> => {
  if (STORE === null) {
    const defaults = DownloadsSchema.parse({});
    STORE = new Store<Downloads>({
      cwd: workspaceSettingsDir(),
      defaults,
      deserialize: (value) => {
        const parsed = DownloadsSchema.safeParse(JSON.parse(value));
        if (parsed.success) {
          return parsed.data;
        }
        logger.error("Failed to parse browser downloads", parsed.error);
        return defaults;
      },
      name: "downloads",
    });
  }
  return STORE;
};

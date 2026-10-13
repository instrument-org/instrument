import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { NoticeSchema } from "@/shared/notices";
import { app } from "electron";
import Store from "electron-store";
import { z } from "zod";

/** How often to ask when the service doesn't say. */
const DEFAULT_POLL_SECONDS = 6 * 60 * 60;

/** What the person has done with one notice, by its id. */
const NoticeMarksSchema = z.object({
  /** Gone for good; showing it again takes a new id. */
  dismissedAt: z.number().optional(),
  /** The bell was opened with it in, so its dot went. */
  seenAt: z.number().optional(),
  /** It toasted, which a notice does once, ever. */
  toastedAt: z.number().optional(),
});

/**
 * The notices from us on this computer, whichever workspace is open: the
 * reports service's last answer, kept so a failed ask never empties the
 * bell, the ETag and wait it came with, the last update this computer installed,
 * and what was done with each notice.
 */
const NoticesStoreSchema = z.object({
  etag: z.string().optional(),
  fetchedAt: z.number().default(0),
  marks: z.record(z.string(), NoticeMarksSchema).default({}),
  notices: z.array(NoticeSchema).default([]),
  pollAfter: z.number().default(DEFAULT_POLL_SECONDS),
  /**
   * The last update this computer launched into. One slot, so a newer update
   * takes the place of one whose notice was never read.
   */
  updated: z
    .object({ at: z.number(), from: z.string(), to: z.string() })
    .optional(),
});

export type NoticesStore = z.output<typeof NoticesStoreSchema>;

let STORE: null | Store<NoticesStore> = null;

export const getNoticesStore = (): Store<NoticesStore> => {
  if (STORE === null) {
    const defaults = NoticesStoreSchema.parse({});
    STORE = new Store<NoticesStore>({
      defaults,
      deserialize: (value) => {
        const parsed = NoticesStoreSchema.safeParse(JSON.parse(value));
        if (parsed.success) {
          return parsed.data;
        }
        logger.error("Failed to parse the notices", parsed.error);
        return defaults;
      },
      // The userData root, which electron-store picks itself inside
      // Electron; named so the store also opens where Electron isn't running.
      cwd: app.getPath("userData"),
      name: "notices",
    });

    STORE.onDidAnyChange(() => {
      publisher.publish("notices.updated", null);
    });
  }

  return STORE;
};

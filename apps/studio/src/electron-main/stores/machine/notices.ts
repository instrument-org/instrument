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
  /**
   * How many chats of the workspace open now are still on a database the
   * conversion would not replace, so they read as empty. One slot: a
   * different count is a different notice.
   */
  chatsLeftBehind: z
    .object({ at: z.number(), count: z.number().min(1) })
    .optional()
    .catch(undefined),
  etag: z.string().optional(),
  /**
   * The last workspace folder a launch opened with no `.instrument/` in it,
   * so it started as a new workspace there. One slot: a later one replaces it.
   */
  startedOver: z
    .object({ at: z.number(), path: z.string() })
    .optional()
    .catch(undefined),
  fetchedAt: z.number().default(0),
  marks: z.record(z.string(), NoticeMarksSchema).default({}),
  notices: z.array(NoticeSchema).default([]),
  pollAfter: z.number().default(DEFAULT_POLL_SECONDS),
  /**
   * The Claude and ChatGPT accounts of the workspace open now that were
   * signed out without the person asking, by connection id. Each keeps when
   * it was first seen, so a launch that finds it still signed out does not
   * remake a notice the person dismissed.
   */
  signedOut: z
    .record(
      z.string(),
      z.object({
        at: z.number(),
        label: z.string().optional(),
        type: z.enum(["chatgpt-account", "claude-account", "grok-account"]),
      }),
    )
    .default({})
    .catch({}),
  /**
   * An install the person asked for that relaunched on the version it was
   * meant to replace. One slot, cleared by the next update that lands.
   */
  installFailed: z
    .object({ at: z.number(), from: z.string(), to: z.string() })
    .optional()
    .catch(undefined),
  /**
   * The last update this computer launched into, and whether the person asked
   * for it or the app restarted for it in view of them, which is when it
   * toasts. One slot, so a newer update takes the place of one whose notice
   * was never read, keeping where that one counted from.
   */
  updated: z
    .object({
      asked: z.boolean().optional(),
      at: z.number(),
      from: z.string(),
      restarted: z.boolean().optional(),
      to: z.string(),
    })
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

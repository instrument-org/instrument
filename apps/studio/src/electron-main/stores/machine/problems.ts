import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { PendingProblemSchema } from "@/shared/problem-reports";
import { app } from "electron";
import Store from "electron-store";
import { z } from "zod";

/**
 * The crashes and hangs from earlier sessions waiting in the bell until
 * they're sent or dismissed, on this computer whichever workspace is open.
 * They outlive a quit before anyone looked.
 */
const ProblemsStoreSchema = z.object({
  pending: z.array(PendingProblemSchema).default([]),
});

type ProblemsStore = z.output<typeof ProblemsStoreSchema>;

let STORE: null | Store<ProblemsStore> = null;

export const getProblemsStore = (): Store<ProblemsStore> => {
  if (STORE === null) {
    const defaults = ProblemsStoreSchema.parse({});
    STORE = new Store<ProblemsStore>({
      defaults,
      deserialize: (value) => {
        const parsed = ProblemsStoreSchema.safeParse(JSON.parse(value));
        if (parsed.success) {
          return parsed.data;
        }
        logger.error("Failed to parse the pending problems", parsed.error);
        return defaults;
      },
      // The userData root, which electron-store picks itself inside
      // Electron; named so the store also opens where Electron isn't running.
      cwd: app.getPath("userData"),
      name: "pending-problems",
    });

    STORE.onDidAnyChange(() => {
      publisher.publish("problems.updated", null);
    });
  }

  return STORE;
};

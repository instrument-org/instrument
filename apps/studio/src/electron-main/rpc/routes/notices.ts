import { liveRead } from "@instrument-org/workspace/electron";
import {
  claimNoticeToast,
  dismissNotice,
  listNotices,
  markNoticesSeen,
} from "@/electron-main/lib/notices";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { z } from "zod";

const live = {
  // The notices from us the bell shows.
  list: base.handler(async function* ({ signal }) {
    const changes = publisher.subscribe("notices.updated", { signal });
    yield* liveRead({ changes: [changes], read: () => listNotices() });
  }),
};

const dismiss = base
  .input(z.object({ id: z.string() }))
  .handler(({ input }) => {
    dismissNotice(input.id);
  });

const markSeen = base
  .input(z.object({ ids: z.array(z.string()) }))
  .handler(({ input }) => {
    markNoticesSeen(input.ids);
  });

/** Whether the window may toast this notice; yes records it. */
const claimToast = base
  .input(z.object({ id: z.string() }))
  .handler(({ input }) => claimNoticeToast(input.id));

export const notices = {
  claimToast,
  dismiss,
  live,
  markSeen,
};

import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";

const live = {
  status: base.handler(async function* ({ context, signal }) {
    // Subscribed before the first answer, so a status that lands while it is
    // on its way is not lost.
    const statuses = publisher.subscribe("updates.status", { signal });
    yield context.appUpdater.getStatus();

    for await (const payload of statuses) {
      yield payload.status;
    }
  }),
};

export const updates = {
  live,
};

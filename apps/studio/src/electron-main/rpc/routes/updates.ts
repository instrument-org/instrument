import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";

const live = {
  // For reminder and requirement, subscribe before yielding the snapshot: the
  // service only publishes on change, so a transition landing between the two
  // would otherwise never be re-sent and the renderer would keep a stale
  // snapshot for the whole session.
  reminder: base.handler(async function* ({ context, signal }) {
    const subscription = publisher.subscribe("updates.reminder", { signal });

    yield context.appUpdates.reminder;

    for await (const payload of subscription) {
      yield payload.reminder;
    }
  }),
  requirement: base.handler(async function* ({ context, signal }) {
    const subscription = publisher.subscribe("updates.requirement", { signal });

    yield context.appUpdates.requirement;

    for await (const payload of subscription) {
      yield payload.requirement;
    }
  }),
  status: base.handler(async function* ({ context, signal }) {
    yield context.appUpdater.status;

    for await (const payload of publisher.subscribe("updates.status", {
      signal,
    })) {
      yield payload.status;
    }
  }),
};

export const updates = {
  live,
};

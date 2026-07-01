import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";

const live = {
  reminder: base.handler(async function* ({ context, signal }) {
    yield context.appUpdates.reminder;

    for await (const payload of publisher.subscribe("updates.reminder", {
      signal,
    })) {
      yield payload.reminder;
    }
  }),
  requirement: base.handler(async function* ({ context, signal }) {
    yield context.appUpdates.requirement;

    for await (const payload of publisher.subscribe("updates.requirement", {
      signal,
    })) {
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

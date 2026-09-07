import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";

const events = {
  /** What a swipe, a thumb button, or a menu chord asked of the window. */
  command: base.handler(async function* ({ signal }) {
    for await (const command of publisher.subscribe("orchestrator.command", {
      signal,
    })) {
      yield command;
    }
  }),
};

export const orchestrator = {
  events,
};

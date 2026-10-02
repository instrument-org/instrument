import { base } from "@/electron-main/rpc/base";
import { commandPublisher } from "@/electron-main/rpc/publisher";

// The app zoom is owned by the renderer, so it has no request/response RPC
// surface here. The native menus publish commands via `sendAppCommand`,
// streamed over `events`.

const events = {
  // Imperative app commands the renderer applies to its own view state,
  // streamed from the main process. The publisher buffers a small
  // burst per subscription (see commandPublisher) so a command isn't dropped when
  // it lands while the previous one is still being sent.
  command: base.handler(async function* ({ signal }) {
    for await (const command of commandPublisher.subscribe("app.command", {
      signal,
    })) {
      yield command;
    }
  }),
};

export const appCommands = {
  events,
};

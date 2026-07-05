import { base } from "@/electron-main/rpc/base";
import { commandPublisher } from "@/electron-main/rpc/publisher";

// Tabs and app-wide view state are owned by the renderer (MainWindow). Selection,
// ordering, back/forward, close, sidebar, settings, zoom, etc. are all driven in
// the renderer, so they have no request/response RPC surface here. Main-process
// sources (native menus, onboarding) publish commands via `sendAppCommand`,
// streamed over `live`.

const live = {
  // Imperative app commands the renderer (MainWindow) applies to its own tab and
  // view state, streamed from the main process. The publisher buffers a small
  // burst per subscription (see commandPublisher) so a command isn't dropped when
  // it lands while the previous one is still being sent.
  commands: base.handler(async function* ({ signal }) {
    for await (const command of commandPublisher.subscribe("app.command", {
      signal,
    })) {
      yield command;
    }
  }),
};

export const appCommands = {
  live,
};

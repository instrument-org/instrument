import { base } from "@/electron-main/rpc/base";
import { commandPublisher } from "@/electron-main/rpc/publisher";

// Tabs are owned by the renderer (MainWindow). Selection, ordering, back/forward,
// close, and modal-initiated opens are all driven entirely in the renderer, so
// they have no RPC surface here. Main-process sources (native menus, onboarding)
// publish tab commands directly via `sendAppCommand`, streamed over `live`.

const live = {
  // Imperative tab operations the renderer (MainWindow) applies to its own tab
  // state, streamed from the main process. The publisher buffers a small burst
  // per subscription (see commandPublisher) so a command isn't dropped when it
  // lands while the previous one is still being sent.
  commands: base.handler(async function* ({ signal }) {
    for await (const command of commandPublisher.subscribe("tab.command", {
      signal,
    })) {
      yield command;
    }
  }),
};

export const tabs = {
  live,
};

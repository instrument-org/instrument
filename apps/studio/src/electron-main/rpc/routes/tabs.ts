import { base } from "@/electron-main/rpc/base";
import { commandPublisher } from "@/electron-main/rpc/publisher";
import { sendTabCommand } from "@/electron-main/tabs/tab-command";
import { setTrafficLightForZoom } from "@/electron-main/windows/main/controls";
import { type StudioPath } from "@/shared/studio-path";
import { z } from "zod";

const StudioPathSchema = z.custom<StudioPath>(
  (value) => typeof value === "string" && value.startsWith("/"),
);

// Tabs are owned by the renderer (AppShell). These handlers publish tab commands
// for modal-initiated opens (e.g. create-project, welcome -> tutorial); the
// renderer applies them. Selection, ordering, back/forward, and close are driven
// entirely in the renderer, so they have no RPC surface here.
const add = base
  .input(
    z.object({ appPath: StudioPathSchema, select: z.boolean().optional() }),
  )
  .handler(({ input }) => {
    sendTabCommand({ appPath: input.appPath, newTab: true, type: "navigate" });
  });

const navigate = base
  .input(z.object({ appPath: StudioPathSchema }))
  .handler(({ input }) => {
    sendTabCommand({ appPath: input.appPath, type: "navigate" });
  });

// The renderer owns the shell zoom (CSS `zoom`); it reports the current level so
// the main process can keep the macOS traffic lights centered in the toolbar,
// whose visual height scales with that zoom.
const syncZoom = base
  .input(z.object({ zoom: z.number() }))
  .handler(({ input }) => {
    setTrafficLightForZoom(input.zoom);
  });

const live = {
  // Imperative tab operations the renderer (AppShell) applies to its own tab
  // state. Streamed, not buffered: a fresh subscriber should not replay a stale
  // command.
  commands: base.handler(async function* ({ signal }) {
    for await (const command of commandPublisher.subscribe("tab.command", {
      signal,
    })) {
      yield command;
    }
  }),
};

export const tabs = {
  add,
  live,
  navigate,
  syncZoom,
};

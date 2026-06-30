import { base } from "@/electron-main/rpc/base";
import { commandPublisher } from "@/electron-main/rpc/publisher";
import { sendTabCommand } from "@/electron-main/tabs/tab-command";
import { goBack, goForward } from "@/electron-main/windows/main/controls";
import { type StudioPath } from "@/shared/studio-path";
import { noop } from "radashi";
import { z } from "zod";

const StudioPathSchema = z.custom<StudioPath>(
  (value) => typeof value === "string" && value.startsWith("/"),
);

// Tabs are owned by the renderer (AppShell). These handlers publish tab commands
// for overlay-initiated opens (e.g. create-project, welcome -> tutorial); the
// renderer applies them. reorder/select are driven by the in-app tab bar, so
// they stay no-ops here.
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

const navigateBack = base.handler(() => {
  goBack();
});

const navigateForward = base.handler(() => {
  goForward();
});

const close = base.input(z.object({ id: z.string() })).handler(({ input }) => {
  sendTabCommand({ id: input.id, type: "close" });
});

const reorder = base
  .input(z.object({ tabIds: z.array(z.string()) }))
  .handler(noop);

const select = base.input(z.object({ id: z.string() })).handler(noop);

const live = {
  // Imperative tab operations the renderer (AppShell) applies to its own tab
  // state. Streamed, not buffered: a fresh subscriber should not replay a stale
  // command. Replaces the old `tab-command` IPC channel.
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
  close,
  live,
  navigate,
  navigateBack,
  navigateForward,
  reorder,
  select,
};

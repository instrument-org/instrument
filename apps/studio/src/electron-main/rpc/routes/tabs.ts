import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { type StudioPath } from "@/shared/studio-path";
import { noop } from "radashi";
import { z } from "zod";

const StudioPathSchema = z.custom<StudioPath>(
  (value) => typeof value === "string" && value.startsWith("/"),
);

// Tabs are owned by the renderer (AppShell) in the unified app, so app-tab
// mutations no longer have a main-process WebContentsView to act on. These
// handlers remain for overlay/menu callers and will be re-pointed at the
// renderer over IPC; for now the app-tab mutations are no-ops.
const add = base
  .input(
    z.object({ appPath: StudioPathSchema, select: z.boolean().optional() }),
  )
  .handler(noop);

const navigate = base
  .input(z.object({ appPath: StudioPathSchema }))
  .handler(noop);

const navigateBack = base.handler(({ context }) => {
  context.tabsManager?.goBack();
});

const navigateForward = base.handler(({ context }) => {
  context.tabsManager?.goForward();
});

const close = base.input(z.object({ id: z.string() })).handler(noop);

const reorder = base
  .input(z.object({ tabIds: z.array(z.string()) }))
  .handler(noop);

const select = base.input(z.object({ id: z.string() })).handler(noop);

const live = {
  state: base.handler(async function* ({ context, signal }) {
    yield context.tabsManager?.getState();

    for await (const payload of publisher.subscribe("tabs.updated", {
      signal,
    })) {
      yield payload ?? undefined;
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

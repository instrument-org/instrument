import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { type StudioPath } from "@/shared/studio-path";
import { noop } from "radashi";
import { z } from "zod";

const StudioPathSchema = z.custom<StudioPath>(
  (value) => typeof value === "string" && value.startsWith("/"),
);

// Tabs are owned by the renderer (AppShell) in the unified app. These handlers
// forward to the renderer over IPC (via TabsManager) for overlay-initiated opens
// (e.g. create-project, welcome -> tutorial). reorder/select are driven directly
// by the in-app tab bar, so they stay no-ops here.
const add = base
  .input(
    z.object({ appPath: StudioPathSchema, select: z.boolean().optional() }),
  )
  .handler(({ context, input }) => {
    context.tabsManager?.addTab({ urlPath: input.appPath });
  });

const navigate = base
  .input(z.object({ appPath: StudioPathSchema }))
  .handler(({ context, input }) => {
    context.tabsManager?.navigateActiveTab({ appPath: input.appPath });
  });

const navigateBack = base.handler(({ context }) => {
  context.tabsManager?.goBack();
});

const navigateForward = base.handler(({ context }) => {
  context.tabsManager?.goForward();
});

const close = base.input(z.object({ id: z.string() })).handler(({ context, input }) => {
  context.tabsManager?.closeTab({ id: input.id });
});

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

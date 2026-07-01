import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";

/** Desired target ids = every recorded entry, including ones whose guest has not
 * attached yet (the renderer must mount a `<webview>` for an entry before it can
 * attach). Distinct from `workspace.browser.listTargetIds`, which only reports
 * already-attached targets. */
function currentTargetIds(): string[] {
  return getBrowserViewManager()?.getTargetIds() ?? [];
}

const live = {
  // Stream the desired agent-browser target ids. The renderer pool reconciles
  // its guests to this set (mount on add, dispose on remove). Re-subscribing
  // always yields the current set, so a guest can't be stranded by a command
  // sent before the listener existed.
  targets: base.handler(async function* ({ signal }) {
    yield currentTargetIds();

    for await (const _ of publisher.subscribe("agent-browser.targets-changed", {
      signal,
    })) {
      yield currentTargetIds();
    }
  }),
};

export const agentBrowser = {
  live,
};

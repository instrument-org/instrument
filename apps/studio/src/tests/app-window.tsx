// First: React reads the counter's hook as it loads.
import { isCounting, settled } from "./render-count";
import { stage } from "@/client/components/transcript/stage/stage";
import { AppWindow } from "@/client/components/window/app-window";
import { initStudioDrive } from "@/client/lib/studio-drive";
import { sharedQueryClient } from "@/client/lib/tab-router";
import { rpcClient } from "@/client/rpc/client";
import { MotionGlobalConfig } from "motion/react";
import { render } from "vitest-browser-react";

/**
 * The app window as the app draws it, with no main process behind it: every
 * request stays unanswered but the ones the test puts in the query cache
 * (`sharedQueryClient`), which is all the window needs to open is the folders
 * it reaches. Drive it with `runWindowCommand` (what a chord sends) and
 * `window.__studioDrive`, as the studio-drive scripts drive the app.
 *
 * Motion and the transcript's reveals stand still, so what renders is what an
 * action set off and never how many frames an animation got: the counts come
 * out the same on every run, on any machine.
 */
export async function renderAppWindow() {
  if (!isCounting()) {
    throw new Error(
      "React loaded before the render counter: import @/tests/render-count first in the test file, ahead of anything that loads react-dom.",
    );
  }
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { getFilePath: () => "", homeDir: "/Users/sam", windowType: "app" },
  });
  MotionGlobalConfig.skipAnimations = true;
  stage.setRate(0);
  // The cache outlives a test: start from only what this one puts there.
  sharedQueryClient.clear();
  sharedQueryClient.setQueryData(rpcClient.workspace.window.ensure.queryKey(), {
    folders: {},
  });
  initStudioDrive();
  const screen = await render(<AppWindow />);
  await settled();
  return screen;
}

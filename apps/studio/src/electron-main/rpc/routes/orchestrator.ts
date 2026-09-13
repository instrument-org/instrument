import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { takePendingOrchestratorScreen } from "@/electron-main/windows/orchestrator";
import { z } from "zod";

const events = {
  /** What a swipe, a thumb button, a menu chord, or a link from outside asked of the window. */
  command: base.handler(async function* ({ signal }) {
    for await (const command of publisher.subscribe("orchestrator.command", {
      signal,
    })) {
      yield command;
    }
  }),
};

/**
 * The screen a link from outside the app asked for while this window was
 * still opening, which the command stream could not carry to it. Asked once,
 * as the window comes up.
 */
const takePendingScreen = base
  .output(z.string().nullable())
  .handler(() => takePendingOrchestratorScreen());

export const orchestrator = {
  events,
  takePendingScreen,
};

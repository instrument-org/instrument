import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  takePendingAppWindowAsks,
  waitingAppWindowAsks,
} from "@/electron-main/windows/app-window";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

const AskSchema = z.discriminatedUnion("type", [
  z.object({ hostPath: z.string(), type: z.literal("openFile") }),
  z.object({ href: z.string(), type: z.literal("openScreen") }),
  z.object({ tab: z.literal("Computer Use"), type: z.literal("openSettings") }),
]);

const events = {
  /** What a swipe, a thumb button, a menu chord, or a link from outside asked of the window. */
  command: base.handler(async function* ({ signal }) {
    for await (const command of publisher.subscribe("window.command", {
      signal,
    })) {
      yield command;
    }
  }),
  /** Open Link or Open Link in New Tab, picked from the window's native menu over a link in text being edited. */
  openMenuLink: base.handler(async function* ({ signal }) {
    for await (const ask of publisher.subscribe("window.open-menu-link", {
      signal,
    })) {
      yield ask;
    }
  }),
};

/**
 * What links and files from outside the app asked for while this window was
 * still opening, which the command stream could not carry to it. Asked once,
 * as the window comes up.
 */
const takePending = base
  .output(z.array(AskSchema))
  .handler(() => takePendingAppWindowAsks());

const live = {
  /**
   * What from outside waits for the window, as of now and each time more
   * arrives: what onboarding tells the person opens once they are through.
   */
  waiting: base
    .output(eventIterator(z.array(AskSchema)))
    .handler(async function* ({ signal }) {
      yield [...waitingAppWindowAsks()];
      for await (const _ of publisher.subscribe("window.asks-waiting", {
        signal,
      })) {
        yield [...waitingAppWindowAsks()];
      }
    }),
};

export const window = {
  events,
  live,
  takePending,
};

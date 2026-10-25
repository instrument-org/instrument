import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { takePendingAppWindowAsks } from "@/electron-main/windows/app-window";
import { z } from "zod";

const AskSchema = z.discriminatedUnion("type", [
  z.object({ hostPath: z.string(), type: z.literal("openFile") }),
  z.object({ href: z.string(), type: z.literal("openScreen") }),
  z.object({
    topic: z.string().optional(),
    type: z.literal("newChat"),
    words: z.string(),
  }),
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
 * as the window comes up. Nothing while setup is up: what waits for it goes
 * out over the command stream once it is done.
 */
const takePending = base
  .output(z.array(AskSchema))
  .handler(() => takePendingAppWindowAsks());

export const window = {
  events,
  takePending,
};

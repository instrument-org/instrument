import { eventIterator } from "@orpc/server";
import invariant from "tiny-invariant";
import { z } from "zod";

import { TaskIdSchema } from "../../schemas/task-id";
import { base } from "../base";

const PresenceSchema = z.object({ active: z.literal(true) });

// Live target ids (`id/sessionId`) for a task, so the UI can tell when a
// browser is active for a session and offer to open its live view.
const listTargetIds = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.array(z.string()))
  .handler(async ({ context, input }) => {
    const targets = await context.workspaceConfig.browser.listTargets(input.id);
    return targets.map((target) => String(target.id));
  });

const presence = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(PresenceSchema))
  .handler(async function* ({ context, input, signal }) {
    invariant(signal, "presence subscription requires an AbortSignal");
    context.workspaceRef.send({
      type: "acquireBrowserPresence",
      value: { id: input.id },
    });

    try {
      yield { active: true as const };
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
    } finally {
      context.workspaceRef.send({
        type: "releaseBrowserPresence",
        value: { id: input.id },
      });
    }
  });

export const browser = {
  listTargetIds,
  live: {
    presence,
  },
};

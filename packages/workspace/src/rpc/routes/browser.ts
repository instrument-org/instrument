import {
  eventIterator,
} from "@orpc/server";
import invariant from "tiny-invariant";
import {
  z,
} from "zod";

import {
  TaskIdSchema,
} from "../../schemas/task-id";
import {
  base,
} from "../base";

const PresenceSchema = z.object({ active: z.literal(true) });

const presence = base
  .input(z.object({ subdomain: TaskIdSchema }))
  .output(eventIterator(PresenceSchema))
  .handler(async function* ({ context, input, signal }) {
    invariant(signal, "presence subscription requires an AbortSignal");
    context.workspaceRef.send({
      type: "acquireBrowserPresence",
      value: { subdomain: input.subdomain },
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
        value: { subdomain: input.subdomain },
      });
    }
  });

export const browser = {
  live: {
    presence,
  },
};

import { eventIterator } from "@orpc/server";
import invariant from "tiny-invariant";
import { z } from "zod";

import { USER_HEARTBEAT_INTERVAL_MS } from "../../machines/project-browser";
import { ProjectSubdomainSchema } from "../../schemas/subdomains";
import { base } from "../base";

const HeartbeatTickSchema = z.object({ ok: z.literal(true) });

const heartbeatLive = base
  .input(z.object({ subdomain: ProjectSubdomainSchema }))
  .output(eventIterator(HeartbeatTickSchema))
  .handler(async function* ({ context, input, signal }) {
    // oRPC types `signal` as optional but always provides one for streaming
    // handlers. Without it we'd loop forever on disconnect; fail loudly if
    // that contract ever changes instead of papering over with a no-op signal.
    invariant(signal, "heartbeat handler requires an AbortSignal from oRPC");
    while (!signal.aborted) {
      context.workspaceRef.send({
        type: "updateUserHeartbeat",
        value: { subdomain: input.subdomain },
      });
      yield { ok: true as const };
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, USER_HEARTBEAT_INTERVAL_MS);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  });

export const browser = {
  live: {
    heartbeat: heartbeatLive,
  },
};

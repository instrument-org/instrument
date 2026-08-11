import { eventIterator } from "@orpc/server";
import invariant from "tiny-invariant";
import { z } from "zod";

import { getBrowserSessionDir } from "../../lib/task-dir-utils";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { BrowserTargetIdSchema } from "../../types";
import { base } from "../base";

const PresenceSchema = z.object({ active: z.literal(true) });

// Create (or reuse) the browser guest for this task/session so the user can open
// it from the UI without waiting for the agent to run `agent-browser` first.
// createTarget is idempotent per (taskId, sessionId): the agent's later commands
// reuse the same guest (page, cookies, debugger). We register the target with the
// taskBrowser lifecycle machine so a user-only browser (no agent CDP traffic) is
// still tracked and reaped rather than leaking until app quit.
const open = base
  .errors({
    BROWSER_OPEN_FAILED: {
      message: "Failed to open the browser",
    },
  })
  .input(z.object({ id: TaskIdSchema, sessionId: StoreId.SessionSchema }))
  .output(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(async ({ context, errors, input }) => {
    const { id, sessionId } = input;
    const partitionDir = getBrowserSessionDir();

    const target = await context.workspaceConfig.browser
      .createTarget(id, sessionId, partitionDir)
      .catch((error: unknown) => {
        throw errors.BROWSER_OPEN_FAILED({
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    // Register only after the guest attaches, so a timed-out attach never
    // records a phantom target the reaper would try to close.
    context.workspaceRef.send({
      type: "registerBrowserTarget",
      value: { id, partitionDir, sessionId, targetId: target.targetId },
    });

    return { targetId: target.targetId };
  });

/**
 * A hold, not a query: subscribing acquires presence and aborting releases it,
 * so the subscription's lifetime is the whole payload. A viewer keeps the task's
 * browser alive; drop the subscription and the taskBrowser machine starts its
 * grace period.
 *
 * The yielded value carries nothing, so the caller subscribes and ignores the
 * result. That is correct here and would be a bug on anything else under `live`.
 */
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
  live: {
    presence,
  },
  open,
};

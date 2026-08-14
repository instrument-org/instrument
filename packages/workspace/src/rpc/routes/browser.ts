import { eventIterator } from "@orpc/server";
import invariant from "tiny-invariant";
import { z } from "zod";

import { restoreLastPage } from "../../lib/browser-state";
import { getBrowserSessionDir } from "../../lib/task-dir-utils";
import { BrowserPresenceLevelSchema } from "../../machines/task-browser";
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

    const restored = await restoreLastPage({
      sessionId,
      targetId: target.targetId,
      taskId: id,
    });
    if (restored.isErr()) {
      // The tab is open, which is what was asked for; it just came up blank.
      context.workspaceConfig.captureException(restored.error);
    }

    return { targetId: target.targetId };
  });

/**
 * A hold, not a query: subscribing acquires presence and aborting releases it,
 * so the subscription's lifetime is the whole payload. A viewer keeps the task's
 * browser alive; drop the subscription and the taskBrowser machine starts the
 * clock that matches the lease that was dropped.
 *
 * `retained` is held for as long as the client keeps the task page alive and
 * `visible` only while it is on screen, so a client that shows one page at a
 * time holds both for that page and `retained` alone for the rest. What decides
 * either is entirely the client's business.
 *
 * The yielded value carries nothing, so the caller subscribes and ignores the
 * result. That is correct here and would be a bug on anything else under `live`.
 */
const presence = base
  .input(z.object({ id: TaskIdSchema, level: BrowserPresenceLevelSchema }))
  .output(eventIterator(PresenceSchema))
  .handler(async function* ({ context, input, signal }) {
    invariant(signal, "presence subscription requires an AbortSignal");
    context.workspaceRef.send({
      type: "acquireBrowserPresence",
      value: { id: input.id, level: input.level },
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
        value: { id: input.id, level: input.level },
      });
    }
  });

export const browser = {
  live: {
    presence,
  },
  open,
};

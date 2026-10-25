import { eventIterator } from "@orpc/server";
import invariant from "tiny-invariant";
import { z } from "zod";

import { lastBrowserAgentActivity } from "../../lib/browser-agent-activity";
import { navigateTarget, restoreLastPage } from "../../lib/browser-state";
import { CdpCommandTimeoutError } from "../../lib/cdp-command-timeout-error";
import { getBrowserSessionDir } from "../../lib/chat-dir-utils";
import { BrowserTargetIdSchema } from "../../types";
import { base } from "../base";
import { publisher } from "../publisher";

const PresenceSchema = z.object({ active: z.literal(true) });

// Create (or reuse) the browser guest for a window tab so the user can open it
// from the UI without waiting for an agent to run `agent-browser` first.
// createTarget is idempotent per tab: an agent's later commands reuse the same
// guest (page, cookies, debugger). We register the target with the browser
// lifecycle machine so a user-only page (no agent CDP traffic) is still
// tracked and reaped rather than leaking until app quit.
//
// `url` is what a caller opening the browser *at* something passes, and it is
// navigated here rather than by the caller because the guest does not exist yet
// when the click happens. Handing it over means the one place that already
// waits for the attach is the one place that navigates, so a caller never has
// to poll the renderer's pool for a `<webview>` that is still being built.
const open = base
  .errors({
    BROWSER_OPEN_FAILED: {
      message: "Failed to open the browser",
    },
  })
  .input(
    z.object({
      /** Where a tab that comes up blank goes: the address the window remembers it at. */
      restoreUrl: z.string().min(1).optional(),
      targetId: BrowserTargetIdSchema,
      url: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ context, errors, input }) => {
    const { restoreUrl, targetId, url } = input;
    const partitionDir = getBrowserSessionDir();
    await context.workspaceConfig.browser
      .createTarget(targetId, partitionDir)
      .catch((error: unknown) => {
        throw errors.BROWSER_OPEN_FAILED({
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    // Register only after the guest attaches, so a timed-out attach never
    // records a phantom target the reaper would try to close.
    context.workspaceRef.send({
      type: "registerBrowserTarget",
      value: { targetId },
    });

    // An explicit page replaces the restore rather than racing it: both would
    // navigate the same guest, and the one the user just clicked is the one
    // they meant.
    const navigated = url
      ? await navigateTarget({ targetId, url })
      : await restoreLastPage({
          ...(restoreUrl === undefined ? {} : { fallbackUrl: restoreUrl }),
          targetId,
        });
    // The tab is open, which is what was asked for; it just came up blank. A
    // navigate that timed out is a slow server rather than a bug, and the load
    // carries on in the guest, so only other failures are reported. A tab
    // closed while its navigate was in flight fails it too, and is gone as
    // asked.
    if (
      navigated.isErr() &&
      !(navigated.error instanceof CdpCommandTimeoutError) &&
      context.workspaceConfig.browser.getTargetMeta(targetId) !== null
    ) {
      context.workspaceConfig.captureException(navigated.error);
    }
  });

/**
 * A hold, not a query: subscribing says the tab's page is drawn and aborting
 * says it left the screen, so the subscription's lifetime is the whole
 * payload. A tab with no hold starts its clock, and its guest is discarded
 * when the clock runs out (see `windowBrowserLogic`). The client holds one
 * for each page it draws and only while it draws it.
 *
 * The yielded value carries nothing, so the caller subscribes and ignores the
 * result. That is correct here and would be a bug on anything else under `live`.
 */
const presence = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .output(eventIterator(PresenceSchema))
  .handler(async function* ({ context, input, signal }) {
    invariant(signal, "presence subscription requires an AbortSignal");
    context.workspaceRef.send({
      type: "acquireBrowserPresence",
      value: { targetId: input.targetId },
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
        value: { targetId: input.targetId },
      });
    }
  });

/**
 * Ticks while the agent is driving this chat's browser.
 *
 * A counter rather than a flag, because where a stretch of agent browser work
 * ends is not a question this side can answer: the commands arrive as separate
 * tool calls seconds apart, and only whoever is drawing the result knows how
 * long a gap should still read as one piece of work. So this reports arrivals
 * and the client decides how long each one lasts.
 *
 * Revision 0 is emitted as soon as the subscription is live, before any
 * command, so a stream that has yet to see one still yields. It also means a
 * client can tell "nothing has happened here" from its first real tick.
 */
const agentActivity = base
  .input(
    z.object({
      /** The guest asked about: a window tab, driven by the chat or whichever task was handed it. */
      targetId: BrowserTargetIdSchema,
    }),
  )
  .output(
    eventIterator(
      z.object({
        /** When an agent last worked in the guest, in ms; absent when none has. */
        lastAt: z.number().optional(),
        revision: z.number(),
      }),
    ),
  )
  .handler(async function* ({ input, signal }) {
    let revision = 0;
    const lastAt = lastBrowserAgentActivity(input.targetId);
    yield { revision, ...(lastAt === undefined ? {} : { lastAt }) };
    for await (const event of publisher.subscribe("browser.agentActivity", {
      signal,
    })) {
      if (event.targetId === input.targetId) {
        revision += 1;
        yield { lastAt: Date.now(), revision };
      }
    }
  });

/**
 * Closes a window tab's guest for good: the guest goes, and a chat holding
 * the tab is told on its next turn that its page is gone. What closing one of
 * the window's tabs means, as against hiding the panel it is drawn in.
 */
const close = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(async ({ context, input }) => {
    await context.workspaceConfig.browser.closeTarget(input.targetId);
  });

export const browser = {
  close,
  events: {
    agentActivity,
  },
  live: {
    presence,
  },
  open,
};

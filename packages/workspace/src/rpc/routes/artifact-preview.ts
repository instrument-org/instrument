import { eventIterator } from "@orpc/server";
import invariant from "tiny-invariant";
import { z } from "zod";

import { getArtifactPreviewSessionDir } from "../../lib/task-dir-utils";
import { TaskIdSchema } from "../../schemas/task-id";
import { BrowserTargetIdSchema } from "../../types";
import { base } from "../base";

const PresenceSchema = z.object({ active: z.literal(true) });

// Create (or reuse) the task's HTML artifact-preview guest. Deliberately not
// `browser.open`: that one takes a session id because it registers with the
// session-keyed taskBrowser machine, whose teardown fans out `agent-browser
// close --session`. A preview has no session, so it gets its own door, its own
// storage profile, and its own (much shorter) lifetime machine.
//
// Idempotent per task: one guest that navigates between files, the way a
// browser tab does, rather than one webContents per HTML file.
const open = base
  .errors({
    ARTIFACT_PREVIEW_OPEN_FAILED: {
      message: "Failed to open the artifact preview",
    },
  })
  .input(z.object({ id: TaskIdSchema }))
  .output(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(async ({ context, errors, input }) => {
    const { id } = input;

    const target = await context.workspaceConfig.browser
      .createArtifactTarget(id, getArtifactPreviewSessionDir())
      .catch((error: unknown) => {
        throw errors.ARTIFACT_PREVIEW_OPEN_FAILED({
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    // Register only after the guest attaches, so a timed-out attach never
    // records a phantom target the reaper would try to close.
    context.workspaceRef.send({
      type: "registerArtifactPreviewTarget",
      value: { id, targetId: target.targetId },
    });

    return { targetId: target.targetId };
  });

// Held for as long as a preview is mounted. A subscription rather than an
// open/close pair so an aborted stream (tab closed, renderer gone, route
// change) releases the lease on its own -- the same guarantee
// `browser.live.presence` relies on.
const presence = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(PresenceSchema))
  .handler(async function* ({ context, input, signal }) {
    invariant(signal, "presence subscription requires an AbortSignal");
    context.workspaceRef.send({
      type: "acquireArtifactPreviewPresence",
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
        type: "releaseArtifactPreviewPresence",
        value: { id: input.id },
      });
    }
  });

export const artifactPreview = {
  live: {
    presence,
  },
  open,
};

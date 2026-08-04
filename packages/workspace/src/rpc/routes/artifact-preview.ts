import { z } from "zod";

import { getArtifactPreviewSessionDir } from "../../lib/task-dir-utils";
import { TaskIdSchema } from "../../schemas/task-id";
import { BrowserTargetIdSchema } from "../../types";
import { base } from "../base";

// Create (or reuse) the task's HTML artifact-preview guest.
//
// Deliberately not `browser.open`: that one takes a session id because it
// registers with the session-keyed taskBrowser machine, whose teardown fans out
// `agent-browser close --session`. A preview has no session, so it gets its own
// door and its own storage profile.
//
// Idempotent per task: one guest that navigates between files, the way a browser
// tab does, rather than one webContents per HTML file. Its id is derivable from
// the task id, which is what lets trash-task close it without any bookkeeping
// here -- there is no lifetime machine and nothing to register.
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
      .createArtifactTarget(id, getArtifactPreviewSessionDir(id))
      .catch((error: unknown) => {
        throw errors.ARTIFACT_PREVIEW_OPEN_FAILED({
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    return { targetId: target.targetId };
  });

export const artifactPreview = { open };

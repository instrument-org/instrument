import { ok, safeTry } from "neverthrow";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type AppConfigProject } from "./app-config/types";
import {
  getFileIndexBaseline,
  setFileIndexBaseline,
} from "./file-index-baseline";
import {
  diffProjectFileIndexes,
  getProjectFileIndex,
} from "./get-project-files";
import { getCurrentProjectFileIndex } from "./project-file-watcher";

/**
 * Diffs the current on-disk file index against the persisted baseline to find
 * files created, modified, or deleted between turns, then advances the baseline
 * to the current tree. Returns a `data-externalFileChanges` part to attach to
 * the user message, or undefined when there is no baseline yet or nothing
 * changed. Uses the live watcher index when one is active, otherwise walks disk.
 */
export function detectExternalFileChanges({
  appConfig,
  messageId,
  sessionId,
  signal,
}: {
  appConfig: AppConfigProject;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const current =
        getCurrentProjectFileIndex(appConfig.subdomain) ??
        (yield* await getProjectFileIndex(appConfig.appDir, { signal }));

      const baseline = yield* getFileIndexBaseline(appConfig, sessionId, {
        signal,
      });

      // Re-baseline regardless of the outcome so the next message diffs against
      // the tree as it stands now.
      yield* setFileIndexBaseline(appConfig, sessionId, current, { signal });

      if (!baseline) {
        return ok(undefined);
      }

      const changes = diffProjectFileIndexes({
        after: current,
        before: baseline,
      });
      if (changes.length === 0) {
        return ok(undefined);
      }

      return ok({
        data: { files: changes },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-externalFileChanges",
      } satisfies SessionMessagePart.Type);
    },
  );
}

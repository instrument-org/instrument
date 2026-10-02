import { ok, safeTry } from "neverthrow";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { listApps } from "./apps/store";
import { getTaskAppsBaseline, setTaskAppsBaseline } from "./task-apps-baseline";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Diffs the apps this task may reach against the session's persisted baseline,
 * then advances the baseline. Returns a `data-taskAppChanges` part to attach to
 * the user message, or undefined where there is no baseline yet or nothing
 * changed.
 *
 * A task reaches the apps it was handed and no others, and that list is written
 * into the session context, which is composed once and reused. This is the only
 * thing that can tell a running task the set has moved -- which it does most
 * often when the task asked for a service, the conversation got the user to
 * sign in, and the app arrived after the task was already waiting on it.
 *
 * A task a person created reaches every app and is handed no list, so it has
 * nothing to diff and is left alone.
 */
export function detectTaskAppChanges({
  messageId,
  sessionId,
  signal,
  taskId,
}: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const settings = await getTaskSettings(taskDir(taskId));
      const current = settings?.apps;
      if (current === undefined) {
        return ok(undefined);
      }

      const baseline = yield* getTaskAppsBaseline(taskId, sessionId, {
        signal,
      });
      // Re-baselined whatever the outcome, so the next message diffs against
      // the set as it stands now.
      yield* setTaskAppsBaseline(taskId, sessionId, current, { signal });

      if (!baseline) {
        return ok(undefined);
      }

      const held = new Set(current);
      const seen = new Set(baseline);
      const addedSlugs = current.filter((slug) => !seen.has(slug));
      const removedSlugs = baseline.filter((slug) => !held.has(slug));
      if (addedSlugs.length === 0 && removedSlugs.length === 0) {
        return ok(undefined);
      }

      // The app's own name where the workspace still has it, since that is what
      // the user calls it; an app removed from disk is named by its slug, which
      // is all that is left of it.
      const { apps } = await listApps(getWorkspaceConfig().appsDir);
      // Keyed as a plain string: the slugs on record are what the task settings
      // hold, which is not the branded slug a loaded app carries.
      const nameOf = new Map<string, string>(
        apps.map((app) => [app.slug, app.manifest.name]),
      );
      const describe = (slug: string) => ({
        name: nameOf.get(slug) ?? slug,
        slug,
      });

      return ok({
        data: {
          added: addedSlugs.map((slug) => describe(slug)),
          removed: removedSlugs.map((slug) => describe(slug)),
        },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-taskAppChanges",
      } satisfies SessionMessagePart.Type);
    },
  );
}

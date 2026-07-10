import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { getParsedStorageItem } from "../get-parsed-storage-item";
import { getSessionsStoreStorage } from "../session-store-storage";
import { setParsedStorageItem } from "../set-parsed-storage-item";
import { StorageKey } from "../storage-key";
import { getWorkspaceConfig } from "../workspace-config";
import { listConnectors } from "./store";

const ConnectorBaselineSchema = z.array(
  z.object({
    displayName: z.string(),
    enabled: z.boolean(),
    slug: z.string(),
  }),
);

type ConnectorBaseline = z.output<typeof ConnectorBaselineSchema>;

/**
 * Diffs the workspace's current connectors against the session's persisted
 * baseline to surface connectors added, removed, enabled, or disabled between
 * turns -- whether the user changed them in Settings or the agent set one up
 * itself -- then advances the baseline. Returns a `data-connectorChanges` part
 * to attach to the user message, or undefined when there's no baseline yet or
 * nothing changed. Keyed by session, mirroring detectAttachedFolderChanges.
 */
export function detectConnectorChanges({
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
      const config = getWorkspaceConfig();
      const { connectors } = await listConnectors(config.connectorsDir);
      const current: ConnectorBaseline = connectors.map((connector) => ({
        displayName: connector.manifest.displayName,
        enabled: connector.manifest.enabled,
        slug: connector.slug,
      }));

      const storage = yield* getSessionsStoreStorage(taskId);
      const baselineResult = await getParsedStorageItem(
        StorageKey.connectorsBaseline(sessionId),
        ConnectorBaselineSchema,
        storage,
        { signal },
      );
      const baseline = baselineResult.isOk() ? baselineResult.value : undefined;

      // Re-baseline regardless so the next message diffs against the current set.
      yield* setParsedStorageItem(
        StorageKey.connectorsBaseline(sessionId),
        current,
        ConnectorBaselineSchema,
        storage,
        { signal },
      );

      if (!baseline) {
        return ok(undefined);
      }

      const changes = diffConnectors(baseline, current);
      if (changes.length === 0) {
        return ok(undefined);
      }

      return ok({
        data: { connectors: changes },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-connectorChanges",
      } satisfies SessionMessagePart.Type);
    },
  );
}

function diffConnectors(
  baseline: ConnectorBaseline,
  current: ConnectorBaseline,
): SessionMessageDataPart.ConnectorChange[] {
  const bySlug = new Map(baseline.map((c) => [c.slug, c]));
  const currentSlugs = new Set(current.map((c) => c.slug));
  const changes: SessionMessageDataPart.ConnectorChange[] = [];

  for (const connector of current) {
    const prior = bySlug.get(connector.slug);
    if (!prior) {
      changes.push({
        change: "added",
        displayName: connector.displayName,
        slug: connector.slug,
      });
    } else if (prior.enabled !== connector.enabled) {
      changes.push({
        change: connector.enabled ? "enabled" : "disabled",
        displayName: connector.displayName,
        slug: connector.slug,
      });
    }
  }

  for (const prior of baseline) {
    if (!currentSlugs.has(prior.slug)) {
      changes.push({
        change: "removed",
        displayName: prior.displayName,
        slug: prior.slug,
      });
    }
  }

  return changes;
}

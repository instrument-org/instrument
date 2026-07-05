// Contract shared by the main process (browser-view manager) and the renderer
// (agent-browser webview pool). The agent's browser guest is a renderer
// `<webview>`; the main process drives it over CDP after grabbing the guest
// WebContents in `did-attach-webview`, and keeps per-task isolation by
// overriding the guest session in `will-attach-webview`.

import {
  type BrowserTargetId,
  BrowserTargetIdSchema,
} from "@instrument-org/workspace/client";

/**
 * The renderer sets the guest's `partition` to this prefix + the encoded target
 * id. `will-attach-webview` only surfaces recognized webview attributes (not
 * arbitrary `data-*`), so the partition string is how the renderer tells the
 * main process which target a guest belongs to. Main then overrides the guest
 * session with `session.fromPath(partitionDir)` (which takes precedence over a
 * partition string), so the guest keeps the same on-disk, per-task profile the
 * WebContentsView path used; this partition value is just a carrier.
 */
const AGENT_BROWSER_PARTITION_PREFIX = "persist:agent-browser-route:";

/**
 * Logical guest viewport. Kept fixed across visibility modes so the agent's
 * capture/screencast surface is stable; the visible tab scales it to fit.
 */
export const AGENT_BROWSER_VIEWPORT = { height: 800, width: 1280 };

/**
 * A recorded agent-browser target and whether its guest has attached yet.
 * Streamed over `agentBrowser.live.targets`: the pool mounts a `<webview>` for
 * every id (attached or not -- mounting is what triggers the attach), while the
 * UI treats only attached targets as "live" (guest present, not a placeholder).
 */
export interface AgentBrowserTarget {
  attached: boolean;
  // Per-entry generation (see BrowserEntry.generation). The id is stable across
  // a destroy+recreate of the same (task, session), so the pool diffs the
  // generation to know it must dispose the old guest and mount a fresh one.
  generation: number;
  id: BrowserTargetId;
}

export function agentBrowserPartition(targetId: BrowserTargetId): string {
  // Encode so the target id's `/` doesn't complicate the partition string.
  return `${AGENT_BROWSER_PARTITION_PREFIX}${encodeURIComponent(targetId)}`;
}

export function targetIdFromPartition(
  partition: string | undefined,
): BrowserTargetId | null {
  if (!partition?.startsWith(AGENT_BROWSER_PARTITION_PREFIX)) {
    return null;
  }
  const raw = decodeURIComponent(
    partition.slice(AGENT_BROWSER_PARTITION_PREFIX.length),
  );
  const result = BrowserTargetIdSchema.safeParse(raw);
  return result.success ? result.data : null;
}

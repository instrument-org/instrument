// Contract shared by the main process (browser-view manager) and the renderer
// (agent-browser webview pool). The agent's browser guest is a renderer
// `<webview>`; the main process drives it over CDP after grabbing the guest
// WebContents in `did-attach-webview`, and keeps per-task isolation by
// overriding the guest session in `will-attach-webview`.

/**
 * The renderer sets the guest's `partition` to this prefix + the encoded target
 * id. `will-attach-webview` only surfaces recognized webview attributes (not
 * arbitrary `data-*`), so the partition string is how the renderer tells the
 * main process which target a guest belongs to. Main then overrides the guest
 * session with `session.fromPath(partitionDir)` (which takes precedence over a
 * partition string), so the guest keeps the same on-disk, per-task profile the
 * WebContentsView path used; this partition value is just a carrier.
 */
export const AGENT_BROWSER_PARTITION_PREFIX = "persist:agent-browser-route:";

/**
 * Logical guest viewport. Kept fixed across visibility modes so the agent's
 * capture/screencast surface is stable; the visible tab scales it to fit.
 */
export const AGENT_BROWSER_VIEWPORT = { height: 800, width: 1280 };

export function agentBrowserPartition(targetId: string): string {
  // Encode so the target id's `/` doesn't complicate the partition string.
  return `${AGENT_BROWSER_PARTITION_PREFIX}${encodeURIComponent(targetId)}`;
}

export function targetIdFromPartition(
  partition: string | undefined,
): null | string {
  if (!partition?.startsWith(AGENT_BROWSER_PARTITION_PREFIX)) {
    return null;
  }
  return decodeURIComponent(
    partition.slice(AGENT_BROWSER_PARTITION_PREFIX.length),
  );
}

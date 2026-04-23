// Debug-only snapshot of the browser view manager and the projectBrowser
// XState machines that reap it. Surfaced through `rpcClient.debug.*` and
// rendered by `/debug/browser-view-manager`. None of this is on a hot path,
// keep it isolated from the manager's runtime code.

import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { isDeveloperMode } from "@/electron-main/stores/preferences";
import { type StudioPath } from "@/shared/studio-path";
import {
  BrowserTargetIdSchema,
  type WorkspaceActorRef,
} from "@instrument-org/workspace/electron";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { type BrowserViewManager } from "./manager";

const ProjectBrowserDebugEntrySchema = z.object({
  destroyedExternallyTargetIds: z.array(z.string()),
  knownTargets: z.array(
    z.object({ sessionId: z.string(), targetId: z.string().nullable() }),
  ),
  partitionDir: z.string().nullable(),
  pendingReapResolverCount: z.number(),
  state: z.string(),
  subdomain: z.string(),
  watchedTargetIds: z.array(z.string()),
});

const BrowserViewDebugEntrySchema = z.object({
  audioMuted: z.boolean(),
  authorizedDownloadPath: z.string().nullable(),
  debuggerAttached: z.boolean(),
  destructionListenerCount: z.number(),
  detachListenerCount: z.number(),
  disposerCount: z.number(),
  eventListenerCount: z.number(),
  isCrashed: z.boolean(),
  isLoading: z.boolean(),
  partitionDir: z.string(),
  pendingDownloadCount: z.number(),
  screencastActive: z.boolean(),
  screencastSessionId: z.number(),
  sessionId: z.string(),
  subdomain: z.string(),
  targetId: BrowserTargetIdSchema,
  title: z.string(),
  url: z.string(),
  webContentsDestroyed: z.boolean(),
  webContentsId: z.number().nullable(),
});

const BrowserViewManagerDebugSnapshotSchema = z.object({
  capturedAt: z.string(),
  developerMode: z.boolean(),
  entries: z.array(BrowserViewDebugEntrySchema),
  projectBrowsers: z.array(ProjectBrowserDebugEntrySchema),
  totalEntries: z.number(),
});

type BrowserViewDebugEntry = z.output<typeof BrowserViewDebugEntrySchema>;
type BrowserViewManagerDebugSnapshot = z.output<
  typeof BrowserViewManagerDebugSnapshotSchema
>;
type ProjectBrowserDebugEntry = z.output<typeof ProjectBrowserDebugEntrySchema>;

function buildBrowserViewEntries(
  manager: BrowserViewManager,
): BrowserViewDebugEntry[] {
  const out: BrowserViewDebugEntry[] = [];

  for (const [targetId, entry] of manager.getDebugEntries()) {
    const wc = entry.view.webContents;
    const wcDestroyed = !wc || wc.isDestroyed();

    out.push({
      audioMuted: wcDestroyed ? false : wc.isAudioMuted(),
      authorizedDownloadPath: entry.authorizedDownloadPath,
      debuggerAttached: wcDestroyed ? false : wc.debugger.isAttached(),
      destructionListenerCount: entry.destructionListeners.size,
      detachListenerCount: entry.detachListeners.size,
      disposerCount: entry.disposers.size,
      eventListenerCount: entry.eventListeners.size,
      isCrashed: wcDestroyed ? false : wc.isCrashed(),
      isLoading: wcDestroyed ? false : wc.isLoading(),
      partitionDir: entry.partitionDir,
      pendingDownloadCount: entry.pendingDownloadGuids.size,
      screencastActive: entry.screencastInterval !== null,
      screencastSessionId: entry.screencastSessionId,
      sessionId: entry.sessionId,
      subdomain: entry.subdomain,
      targetId,
      title: wcDestroyed ? "" : wc.getTitle(),
      url: wcDestroyed ? "" : wc.getURL(),
      webContentsDestroyed: wcDestroyed,
      webContentsId: wcDestroyed ? null : wc.id,
    });
  }

  return out;
}

function buildProjectBrowserEntries(
  workspaceRef: WorkspaceActorRef,
): ProjectBrowserDebugEntry[] {
  const snapshot = workspaceRef.getSnapshot();
  const out: ProjectBrowserDebugEntry[] = [];

  for (const [subdomain, ref] of snapshot.context.projectBrowserRefs) {
    const childSnapshot = ref.getSnapshot();
    const ctx = childSnapshot.context;
    const knownTargets = [...ctx.knownTargets.entries()].map(
      ([sessionId, targetId]) => ({
        sessionId: String(sessionId),
        targetId: targetId ? String(targetId) : null,
      }),
    );

    out.push({
      destroyedExternallyTargetIds: [...ctx.destroyedExternallyTargets].map(
        String,
      ),
      knownTargets,
      partitionDir: ctx.partitionDir,
      pendingReapResolverCount:
        snapshot.context.pendingBrowserReapResolvers.get(subdomain)?.length ??
        0,
      state: JSON.stringify(childSnapshot.value),
      subdomain: String(subdomain),
      watchedTargetIds: [...ctx.watchedTargets].map(String),
    });
  }

  return out;
}

function buildSnapshot({
  manager,
  workspaceRef,
}: {
  manager: BrowserViewManager;
  workspaceRef: WorkspaceActorRef;
}): BrowserViewManagerDebugSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    developerMode: isDeveloperMode(),
    entries: buildBrowserViewEntries(manager),
    projectBrowsers: buildProjectBrowserEntries(workspaceRef),
    totalEntries: manager.getDebugEntries().size,
  };
}

// Heartbeat keeps reaping countdowns visually fresh between explicit publish
// events (which only fire on entry add/remove/title changes, not on the
// projectBrowser machine's `after` timers ticking down). Re-publishing on a
// timer wakes up every active subscriber.
const BROWSER_VIEW_HEARTBEAT_MS = 1000;

const snapshot = base
  .output(BrowserViewManagerDebugSnapshotSchema)
  .handler(({ context }) => {
    return buildSnapshot({
      manager: context.browserViewManager,
      workspaceRef: context.workspaceRef,
    });
  });

const snapshotLive = base
  .output(eventIterator(BrowserViewManagerDebugSnapshotSchema))
  .handler(async function* ({ context, signal }) {
    const build = () =>
      buildSnapshot({
        manager: context.browserViewManager,
        workspaceRef: context.workspaceRef,
      });

    yield build();

    const wakeUp = () => {
      publisher.publish("debug.browser-view-manager.updated", null);
    };

    // Subscribe to every projectBrowser child actor so state-machine value
    // transitions (Active -> Stopping -> Stopped, parallel sub-states, etc.)
    // push updates instead of waiting on the heartbeat. Resubscribes whenever
    // the workspace machine spawns a new projectBrowser.
    const childSubs = new Map<string, () => void>();
    const refreshChildSubs = () => {
      const refs =
        context.workspaceRef.getSnapshot().context.projectBrowserRefs;
      const seen = new Set<string>();
      for (const [subdomain, ref] of refs) {
        const key = String(subdomain);
        seen.add(key);
        if (childSubs.has(key)) {
          continue;
        }
        const sub = ref.subscribe(wakeUp);
        childSubs.set(key, () => {
          sub.unsubscribe();
        });
      }
      for (const [key, dispose] of childSubs) {
        if (!seen.has(key)) {
          dispose();
          childSubs.delete(key);
        }
      }
    };
    refreshChildSubs();

    const workspaceSub = context.workspaceRef.subscribe(() => {
      refreshChildSubs();
    });

    // Heartbeat keeps reaping countdowns visually fresh between explicit
    // events (XState `after` timers tick down silently between transitions).
    const heartbeat = setInterval(wakeUp, BROWSER_VIEW_HEARTBEAT_MS);

    signal?.addEventListener(
      "abort",
      () => {
        clearInterval(heartbeat);
        workspaceSub.unsubscribe();
        for (const dispose of childSubs.values()) {
          dispose();
        }
        childSubs.clear();
      },
      { once: true },
    );

    const updates: AsyncIterable<null> = publisher.subscribe(
      "debug.browser-view-manager.updated",
      { signal },
    );

    for await (const _payload of updates) {
      yield build();
    }
  });

const openAsTab = base
  .input(z.object({ targetId: BrowserTargetIdSchema }))
  .handler(({ context, input }) => {
    const entry = context.browserViewManager
      .getDebugEntries()
      .get(input.targetId);
    if (!entry || !context.tabsManager) {
      return;
    }
    const targetId = String(input.targetId);
    const wc = entry.view.webContents;
    const title = (wc && !wc.isDestroyed() ? wc.getTitle() : null) || targetId;
    const browserViewPath =
      "/debug/browser-view/$targetId" satisfies StudioPath;
    context.tabsManager.addTab({
      closeDetachesOnly: true,
      iconName: "globe",
      title,
      // Cast: TanStack Router can't verify a template-literal fullPath, but
      // browserViewPath satisfies StudioPath so staleness is caught at compile time.
      urlPath: browserViewPath.replace("$targetId", targetId) as StudioPath,
      webView: entry.view,
    });
  });

export const browserViewManagerDebugRoutes = {
  live: {
    snapshot: snapshotLive,
  },
  openAsTab,
  snapshot,
};

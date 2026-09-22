import {
  type OrchestratorRecent,
  orchestratorRecentsAtom,
  RECENTS_MAX,
} from "@/client/atoms/orchestrator";
import { useRouterState } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import ms from "ms";
import { useEffect } from "react";

/** How long a screen has to stay up before Recent counts it. */
const RECENT_DWELL_MS = ms("2 seconds");

/**
 * Keeps the Recent list: every file and folder the window lands on goes to
 * the top, one entry per address. Pages keep their own list, by the browser.
 */
export function useRecordRecents() {
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });
  const setRecents = useSetAtom(orchestratorRecentsAtom);
  const { href, pathname } = location;
  const search = location.search as Record<string, unknown>;

  useEffect(() => {
    const entry = recentFor({ href, pathname, search });
    if (!entry) {
      return;
    }
    // A screen counts once the user has stayed on it a moment: clicking down
    // through folders passes through many that were never the destination.
    const timer = setTimeout(() => {
      setRecents((current) =>
        [
          { ...entry, at: Date.now() },
          ...current.filter((recent) => recent.href !== entry.href),
        ].slice(0, RECENTS_MAX),
      );
    }, RECENT_DWELL_MS);
    return () => {
      clearTimeout(timer);
    };
    // The search object is a new one each render; its address is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, pathname, setRecents]);
}

function recentFor({
  href,
  pathname,
  search,
}: {
  href: string;
  pathname: string;
  search: Record<string, unknown>;
}): Omit<OrchestratorRecent, "at"> | undefined {
  if (pathname !== "/orchestrator/computer") {
    return undefined;
  }
  const file = typeof search.file === "string" ? search.file : "";
  if (file) {
    return { href, kind: "file", title: file.split("/").at(-1) || "File" };
  }
  const path = typeof search.path === "string" ? search.path : "";
  const folder = path.replace(/\/$/, "").split("/").at(-1);
  // The roots are doors on the new tab page already.
  if (!folder) {
    return undefined;
  }
  return { href, kind: "folder", title: folder };
}

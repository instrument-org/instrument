import { captureComponentError } from "@/client/lib/telemetry";
import { cn } from "@/client/lib/utils";
import { CatchBoundary } from "@tanstack/react-router";
import { createContext, type ReactNode, Suspense, useContext } from "react";

import { Skeleton } from "../ui/skeleton";

// `CatchBoundary` instantiates `errorComponent` as a component type, so it has
// to be stable; passing the fallback through context keeps it from remounting
// on every render of the surface.
const ViewerFallbackContext = createContext<ReactNode>(null);

/**
 * The body of a document viewer: an optional thumbnail rail beside the page
 * area. The rail collapses by translating out rather than unmounting, so its
 * scroll position and any rendered thumbnails survive a toggle.
 */
export function ViewerBody({
  children,
  rail,
  railOpen,
}: {
  children: ReactNode;
  rail?: ReactNode;
  railOpen?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      {rail && (
        <div
          className={cn(
            "shrink-0 overflow-hidden border-r border-border/60 transition-[width] duration-200",
            railOpen ? "w-40" : "w-0 border-r-0",
          )}
          // Collapsed by clipping rather than unmounting, so the thumbnails stay
          // rendered and keep their scroll position. `inert` is what keeps them
          // out of the tab order while they are invisible.
          inert={!railOpen}
        >
          <div className="h-full w-40 overflow-y-auto overscroll-contain">
            {rail}
          </div>
        </div>
      )}
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Stands in for the document while it parses.
 *
 * A skeleton filling the content area rather than a spinner in the middle of
 * it: these waits end with something appearing in exactly this space, so a
 * placeholder that already occupies it makes the swap a fill instead of a jump.
 * It stays a plain block rather than a page or grid mock-up, because the
 * viewers that use it land on all three and a wrong guess is worse than none.
 */
export function ViewerLoading() {
  return (
    <div className="size-full p-4">
      <Skeleton className="size-full" />
    </div>
  );
}

/**
 * Wraps a lazily loaded document viewer.
 *
 * These parse untrusted, frequently malformed files, so a viewer that throws
 * (or whose chunk fails to load) must not reach the top-level shell boundary
 * and take the window down with it. It degrades to the same fallback card an
 * unsupported file gets, and `resetKey` lets it recover when the user picks a
 * different file rather than staying broken for the session.
 */
export function ViewerSurface({
  children,
  fallback,
  resetKey,
}: {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
}) {
  return (
    <ViewerFallbackContext value={fallback}>
      <CatchBoundary
        errorComponent={ViewerFallback}
        getResetKey={() => resetKey}
        onCatch={captureComponentError}
      >
        <Suspense fallback={<ViewerLoading />}>{children}</Suspense>
      </CatchBoundary>
    </ViewerFallbackContext>
  );
}

// Matches the centering the registry's own fallback branches apply, so a
// viewer that throws lands the card in the same place an unsupported file does.
function ViewerFallback() {
  return (
    <div className="flex size-full items-center justify-center">
      {useContext(ViewerFallbackContext)}
    </div>
  );
}

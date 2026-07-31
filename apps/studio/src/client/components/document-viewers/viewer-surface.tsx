import { captureComponentError } from "@/client/lib/telemetry";
import { cn } from "@/client/lib/utils";
import { CatchBoundary } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  Suspense,
  useContext,
  useState,
} from "react";

import { FileLoading } from "../file-loading";

// `CatchBoundary` instantiates `errorComponent` as a component type, so it has
// to be stable; passing the fallback through context keeps it from remounting
// on every render of the surface.
const ViewerFallbackContext = createContext<ReactNode>(null);

/**
 * The body of a document viewer: an optional thumbnail rail beside the page
 * area.
 *
 * The rail is not built until it is first opened, and stays mounted afterwards.
 * Both halves of that matter. Mounting it with the document pays for every page
 * up front: the DOCX and PPTX rails attach a canvas per page and paint each
 * one, so a long document renders a thumbnail of every page before anyone has
 * asked to see one. Unmounting it on close throws those renders and the rail's
 * scroll position away on every toggle.
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
  const [railWasOpened, setRailWasOpened] = useState(false);
  if (railOpen && !railWasOpened) {
    setRailWasOpened(true);
  }

  return (
    <div className="flex min-h-0 flex-1">
      {rail && railWasOpened && (
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
 * Wraps a lazily loaded document viewer.
 *
 * These parse untrusted, frequently malformed files, so a viewer that throws
 * (or whose chunk fails to load) must not reach the top-level shell boundary
 * and take the window down with it. It degrades to the same fallback card an
 * unsupported file gets, and `resetKey` lets it recover when the user picks a
 * different file rather than staying broken for the session.
 *
 * Nothing stands in while a document parses. Most of these waits are shorter
 * than the eye settles on, so anything drawn there is a flash of furniture
 * between two files rather than a sign of progress; the panel simply stays
 * empty until the document is ready to fill it.
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
        <Suspense fallback={<FileLoading />}>{children}</Suspense>
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

import "@excalidraw/excalidraw/index.css";

import { FileLoading } from "@/client/components/file-loading";
import { SaveFailedPill } from "@/client/components/save-failed-pill";
import { useTheme } from "@/client/components/theme-provider";
import { useMarkUpdated } from "@/client/components/updated-note";
import { registerFileFlush } from "@/client/lib/file-flush";
import { type SaveStatus, usePullOnDiskChange } from "@/client/lib/live-file";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  type ExcalidrawImperativeAPI,
  type ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  createExcalidrawSession,
  type ExcalidrawSession,
  readDiskScene,
} from "./excalidraw-session";

declare global {
  interface Window {
    /** Where Excalidraw loads its fonts from, set before it loads (`file-viewer.tsx`). */
    EXCALIDRAW_ASSET_PATH?: string | string[];
    /** Each open drawing's session by path, for checks to drive in development. */
    __excalidrawEditors?: Map<
      string,
      { api: ExcalidrawImperativeAPI; session: ExcalidrawSession }
    >;
  }
}

/**
 * An `.excalidraw` file open as a live canvas: drawn on in place, saved as it
 * is drawn, and following the file as the agent writes it. Opening a file
 * never rewrites it; a save writes only the elements that changed.
 */
export function ExcalidrawFileEditor({ hostPath }: { hostPath: string }) {
  const initial = useQuery({
    ...rpcClient.files.read.queryOptions({ input: { path: hostPath } }),
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  if (initial.isLoading || !initial.isFetchedAfterMount) {
    return <FileLoading />;
  }
  if (initial.error || !initial.data) {
    throw initial.error ?? new Error("Could not read the file");
  }
  return <LiveCanvas hostPath={hostPath} initial={initial.data} />;
}

function LiveCanvas({
  hostPath,
  initial,
}: {
  hostPath: string;
  initial: { content: string; version: string };
}) {
  const { resolvedTheme } = useTheme();
  const [scene] = useState(() => readDiskScene(initial.content));
  // Read once: the canvas takes its initial data on mount only.
  const [initialData] = useState(() =>
    scene ? initialDataOf(initial.content, scene) : null,
  );
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [session, setSession] = useState<ExcalidrawSession | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const sessionRef = useRef<ExcalidrawSession | null>(null);

  const modifiedAt = usePullOnDiskChange(hostPath, session, {
    enabled: session !== null,
  });
  const markUpdated = useMarkUpdated();
  const onUpdated = useEffectEvent(() => {
    markUpdated(modifiedAt);
  });

  useEffect(() => {
    if (!api || !scene) {
      return;
    }
    const created = createExcalidrawSession({
      api,
      hostPath,
      initial: { scene, version: initial.version },
      onExternalChange: ({ conflicts }) => {
        onUpdated();
        if (conflicts > 0) {
          toast.message("Merged the agent's edit with yours", {
            description:
              "You and the agent changed the same shapes, and your changes were kept.",
          });
        }
      },
      onStatus: (next, detail) => {
        setStatus(next);
        if (next === "error") {
          toast.error("Couldn't save your changes", { cause: detail });
        }
      },
    });
    sessionRef.current = created;
    setSession(created);
    const unregister = registerFileFlush(hostPath, created.flush);
    if (import.meta.env.DEV) {
      window.__excalidrawEditors ??= new Map();
      window.__excalidrawEditors.set(hostPath, { api, session: created });
    }
    return () => {
      unregister();
      sessionRef.current = null;
      if (import.meta.env.DEV) {
        window.__excalidrawEditors?.delete(hostPath);
      }
      void created.destroy();
    };
    // The session is the file's for the component's life; the caller keys the
    // component on the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (!scene) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        This file isn’t a drawing Excalidraw can read, so it can’t open here.
      </div>
    );
  }

  return (
    <div className="relative size-full min-h-0" data-status={status}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={(elements) => {
          sessionRef.current?.onCanvasChange(elements);
        }}
        theme={resolvedTheme}
        UIOptions={{
          canvasActions: {
            export: false,
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
      />
      {status === "error" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center">
          <SaveFailedPill
            onRetry={() => {
              session?.retrySave();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** What the canvas opens on: the file's elements and images, and its background and grid. */
function initialDataOf(
  text: string,
  scene: NonNullable<ReturnType<typeof readDiskScene>>,
): ExcalidrawInitialDataState {
  let appState: unknown;
  try {
    appState =
      text.trim() === ""
        ? undefined
        : (JSON.parse(text) as { appState?: unknown }).appState;
  } catch {
    appState = undefined;
  }
  // The scene's elements and files come from the merge layer's reading of the
  // file, which is open records; Excalidraw restores them again on load.
  return {
    appState: appState as ExcalidrawInitialDataState["appState"],
    elements:
      scene.elements as unknown as ExcalidrawInitialDataState["elements"],
    files: scene.files as unknown as ExcalidrawInitialDataState["files"],
    scrollToContent: true,
  };
}

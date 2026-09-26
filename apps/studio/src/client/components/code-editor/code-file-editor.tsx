import "./code-editor.css";

import { FileLoading } from "@/client/components/file-loading";
import { useAskAboutSelection } from "@/client/components/orchestrator/ask-about-selection";
import { UpdatedPill } from "@/client/components/updated-pill";
import { rpcClient } from "@/client/rpc/client";
import { EditorView } from "@codemirror/view";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type CodeExternalChange,
  type CodeSession,
  createCodeSession,
  type SaveStatus,
} from "./code-session";
import { readOnlyReason } from "./text-sync";

/** How often an open editor looks for the agent's writes. */
const WATCH_INTERVAL_MS = 250;

type Offscreen = "above" | "below" | null;

/**
 * A code or plain text file open as a live document: edited in place, saved
 * as it is typed, and following the file as the agent writes it.
 *
 * Opening a file never rewrites it: nothing is saved until something is
 * typed, and what is saved keeps the file's line breaks, byte order mark and
 * final newline, or its lack of one. An agent's write merges in around the
 * caret without entering undo and lights up the lines it changed; off screen,
 * a pill says which way. A file too large or too long in the line to edit
 * well, or one that is not text, is shown read only with a note saying why.
 */
export function CodeFileEditor({
  filename,
  hostPath,
  variant,
  wrapLines,
}: {
  filename: string;
  hostPath: string;
  variant: "code" | "text";
  wrapLines: boolean;
}) {
  const initial = useQuery({
    ...rpcClient.files.read.queryOptions({ input: { path: hostPath } }),
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  if (initial.isLoading) {
    return <FileLoading />;
  }
  if (initial.error || !initial.data) {
    return (
      <div className="p-8 text-sm text-destructive">
        {initial.error?.message ?? "Could not read the file"}
      </div>
    );
  }
  return (
    <LiveCodeDocument
      filename={filename}
      hostPath={hostPath}
      initial={initial.data}
      variant={variant}
      wrapLines={wrapLines}
    />
  );
}

/** A handle on each open editor for checks to drive, in development. */
function exposeForTests(hostPath: string, session: CodeSession | null) {
  const holder = window as unknown as {
    __codeEditors?: Map<string, CodeSession>;
  };
  holder.__codeEditors ??= new Map();
  if (session) {
    holder.__codeEditors.set(hostPath, session);
  } else {
    holder.__codeEditors.delete(hostPath);
  }
}

function LiveCodeDocument({
  filename,
  hostPath,
  initial,
  variant,
  wrapLines,
}: {
  filename: string;
  hostPath: string;
  initial: { content: string; version: string };
  variant: "code" | "text";
  wrapLines: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<CodeSession | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [offscreen, setOffscreen] = useState<Offscreen>(null);
  const [readOnly] = useState(() => readOnlyReason(initial.content));
  const changedAt = useRef(0);
  const askAbout = useAskAboutSelection();
  const askRef = useRef(askAbout);
  askRef.current = askAbout;
  const wrapRef = useRef(wrapLines);
  wrapRef.current = wrapLines;

  // The file on disk, looked at four times a second while it is open.
  const watched = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({
      input: { intervalMs: WATCH_INTERVAL_MS, path: hostPath },
    }),
  );
  const modifiedAt = watched.data?.modifiedAt;
  useEffect(() => {
    if (modifiedAt !== undefined) {
      session?.pull();
    }
  }, [modifiedAt, session]);

  useEffect(() => {
    session?.setWrapLines(wrapLines);
  }, [session, wrapLines]);

  useEffect(() => {
    const parent = rootRef.current;
    if (!parent) {
      return;
    }
    const created = createCodeSession({
      filename,
      hostPath,
      initial,
      onAsk: ({ lines, quote }) => {
        askRef.current({ lines, path: hostPath, quote });
      },
      onExternalChange: (change: CodeExternalChange) => {
        changedAt.current = change.at;
        if (change.overlapped) {
          toast.message("Merged the agent's edit with yours", {
            description:
              "You and the agent changed the same lines, and both edits were kept.",
          });
        }
        // Measured once the editor has laid the change out.
        requestAnimationFrame(() => {
          setOffscreen(offscreenOf(created.view, change.at));
        });
      },
      onStatus: (next, detail) => {
        setStatus(next);
        if (next === "error") {
          toast.error("Could not save", { description: detail });
        }
      },
      parent,
      readOnly: readOnly !== null,
      variant,
      wrapLines: wrapRef.current,
    });
    setSession(created);
    if (import.meta.env.DEV) {
      exposeForTests(hostPath, created);
    }
    return () => {
      if (import.meta.env.DEV) {
        exposeForTests(hostPath, null);
      }
      void created.destroy();
    };
    // The session is the file's for the component's life; the caller keys the
    // component on the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pill goes once the change is in view, however it got there.
  useEffect(() => {
    if (!offscreen || !session) {
      return;
    }
    const scroller = session.view.scrollDOM;
    const onScroll = () => {
      if (offscreenOf(session.view, changedAt.current) === null) {
        setOffscreen(null);
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [offscreen, session]);

  return (
    <div className="flex size-full min-h-0 flex-col">
      {readOnly && (
        <div className="shrink-0 px-4 py-2 text-xs text-muted-foreground viewer-chrome-stroke">
          {readOnly}
        </div>
      )}
      <div
        className="code-editor min-h-0 flex-1"
        data-status={status}
        data-variant={variant}
      >
        <div className="h-full" ref={rootRef} />
        {offscreen && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
            <UpdatedPill
              direction={offscreen}
              onClick={() => {
                session?.view.dispatch({
                  effects: EditorView.scrollIntoView(changedAt.current, {
                    y: "center",
                  }),
                });
                setOffscreen(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Which way a position lies from what the editor shows, or null when it is in view. */
function offscreenOf(view: EditorView, at: number): Offscreen {
  const block = view.lineBlockAt(Math.min(at, view.state.doc.length));
  const top = view.documentTop + block.top * view.scaleY;
  const bottom = view.documentTop + block.bottom * view.scaleY;
  const box = view.scrollDOM.getBoundingClientRect();
  if (top > box.bottom - 12) {
    return "below";
  }
  if (bottom < box.top + 12) {
    return "above";
  }
  return null;
}

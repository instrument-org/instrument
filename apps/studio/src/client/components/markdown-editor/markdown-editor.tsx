import "@milkdown/crepe/theme/common/style.css";

import "./markdown-editor.css";

import { AgentFilesBlock } from "@/client/components/agent-files-block";
import { FileLoading } from "@/client/components/file-loading";
import { MarkdownDocument } from "@/client/components/markdown-outline";
import { MarkdownTaskContext } from "@/client/components/markdown-task-context";
import { MermaidDiagram } from "@/client/components/mermaid-diagram";
import {
  MessageActions,
  MessageCard,
  messageKindOf,
} from "@/client/components/message-card";
import { useAskAboutSelection } from "@/client/components/orchestrator/ask-about-selection";
import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { isMermaidLanguage } from "@/client/lib/mermaid";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  AGENT_FILES_LANGUAGE,
  AGENT_MESSAGE_LANGUAGE,
  isMessageDocument,
  parseMessage,
} from "@instrument-org/workspace/client";
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  createEditorSession,
  type EditorSession,
  type ExternalChange,
  type SaveStatus,
} from "./editor-session";
import { FrontMatterCard, setFrontMatterField } from "./front-matter-card";
import { openSourcePopover } from "./html-render";

/** How often an open editor looks for the agent's writes. */
const WATCH_INTERVAL_MS = 250;

/** The headings that are the document's, not the editor's own menus. */
const HEADING_SELECTOR = ".ProseMirror > :is(h1, h2, h3, h4, h5, h6)";

interface Fence {
  content: string;
  createdAt: number;
  id: number;
  language: string;
}

type Offscreen = "above" | "below" | null;

/**
 * A Markdown file open as a live document: edited in place, saved as it is
 * typed, and following the file as the agent writes it.
 *
 * What the file says on disk stays the person's and the agent's: blocks nobody
 * touched are written back byte for byte (see doc-sync.ts), so opening a file
 * here never rewrites it. An agent's write merges in around the caret and
 * lights up the blocks it changed; off screen, a pill says which way.
 *
 * A message document (front matter with `message:`) wears the message card's
 * chrome around the editor: its kind, who it is to and its subject, editable
 * and written back into the front matter, and the card's Copy and Send.
 */
export function MarkdownEditor({ hostPath }: { hostPath: string }) {
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
  return <LiveDocument hostPath={hostPath} initial={initial.data} />;
}

/** Opens a fence's source in a popover and writes the edit back into its code block. */
function editFenceSource(
  session: EditorSession | null,
  fence: Fence,
  element: HTMLElement,
  anchor: HTMLElement,
) {
  if (!session) {
    return;
  }
  const view = session.view();
  const findBlock = () => {
    let pos: number;
    try {
      pos = view.posAtDOM(element, 0);
    } catch {
      return null;
    }
    const $pos = view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth >= 0; depth--) {
      if ($pos.node(depth).type.name === "code_block") {
        return depth === 0 ? null : $pos.before(depth);
      }
    }
    for (const at of [pos - 1, pos]) {
      if (at >= 0 && view.state.doc.nodeAt(at)?.type.name === "code_block") {
        return at;
      }
    }
    return null;
  };
  const at = findBlock();
  const node = at === null ? null : view.state.doc.nodeAt(at);
  if (at === null || !node) {
    return;
  }
  openSourcePopover(
    anchor,
    node.textContent,
    (next) => {
      const where = findBlock() ?? at;
      const current = view.state.doc.nodeAt(where);
      if (current?.type.name !== "code_block") {
        return;
      }
      view.dispatch(
        view.state.tr.replaceWith(
          where + 1,
          where + current.nodeSize - 1,
          next ? view.state.schema.text(next) : [],
        ),
      );
    },
    {
      title:
        fence.language === AGENT_FILES_LANGUAGE
          ? "Files"
          : fence.language === AGENT_MESSAGE_LANGUAGE
            ? "Message"
            : "Diagram",
    },
  );
}

/** A handle on each open editor for the invariant check to drive, in development. */
function exposeForTests(hostPath: string, session: EditorSession) {
  const holder = window as unknown as {
    __markdownEditors?: Record<string, EditorSession>;
  };
  holder.__markdownEditors ??= {};
  holder.__markdownEditors[hostPath] = session;
}

/**
 * A fence Studio draws as something else, drawn the same way in the editor:
 * a message as its card, files as their grid, a diagram as the diagram.
 * The block's own "Edit" shows the fence's source; the pencil here edits it
 * in a popover without leaving the drawing.
 */
function FenceView({
  content,
  language,
  onEditSource,
}: {
  content: string;
  language: string;
  onEditSource: (anchor: HTMLElement) => void;
}) {
  // A files fence names paths as the conversation's task sees them; the
  // window's own task is the one that can place them on this computer.
  const orchestrator = useContext(OrchestratorContext);
  return (
    <MarkdownTaskContext value={{ taskId: orchestrator?.taskId }}>
      <div className="group/fence relative">
        {language === AGENT_MESSAGE_LANGUAGE ? (
          <MessageCard message={parseMessage(content)} />
        ) : language === AGENT_FILES_LANGUAGE ? (
          <AgentFilesBlock content={content} />
        ) : (
          <MermaidDiagram code={content} language={language} />
        )}
        <button
          className="absolute top-2 right-2 rounded-md border border-border bg-popover px-2 py-0.5 text-xs text-muted-foreground opacity-0 shadow-xs group-hover/fence:opacity-100 hover:text-foreground"
          onClick={(event) => {
            onEditSource(event.currentTarget);
          }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          type="button"
        >
          Edit source
        </button>
      </div>
    </MarkdownTaskContext>
  );
}

function frontMatterOf(text: string) {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(
    text,
  );
  return m?.[0] ?? "";
}

function LiveDocument({
  hostPath,
  initial,
}: {
  hostPath: string;
  initial: { content: string; version: string };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [fm, setFm] = useState(() => frontMatterOf(initial.content));
  // Bumped when the front matter changes on disk rather than in the card, so
  // the card redraws from it.
  const [fmRevision, setFmRevision] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [fences, setFences] = useState<Fence[]>([]);
  // Where each fence is drawn, by its id, once the code block has put the
  // element in the document.
  const [targets, setTargets] = useState<Map<number, HTMLElement>>(new Map());
  const [offscreen, setOffscreen] = useState<Offscreen>(null);
  const changedRef = useRef<HTMLElement | null>(null);
  const askAbout = useAskAboutSelection();
  const askRef = useRef(askAbout);
  askRef.current = askAbout;

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

  /** Which way a change the agent made lies, when it is out of view. */
  const noteChange = (change: ExternalChange) => {
    changedRef.current = change.element;
    if (change.keptYours) {
      toast.message("Kept your version", { description: change.result });
    }
    const element = change.element;
    const scroller = rootRef.current ? scrollParentOf(rootRef.current) : null;
    if (!element || !scroller) {
      return;
    }
    const box = element.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    setOffscreen(
      box.top > view.bottom - 24
        ? "below"
        : box.bottom < view.top + 24
          ? "above"
          : null,
    );
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    let live = true;
    let fenceId = 0;
    const folder = hostPath.replace(/[^/\\]*$/, "");
    const created = createEditorSession({
      hostPath,
      initial,
      onAsk: ({ lines, quote }) => {
        askRef.current({ path: hostPath, quote, ...(lines ? { lines } : {}) });
      },
      onExternalChange: (change) => {
        noteChange(change);
      },
      onFrontMatter: (next) => {
        setFm(next);
        setFmRevision((n) => n + 1);
      },
      onStatus: (next, detail) => {
        setStatus(next);
        if (next === "error") {
          toast.error("Could not save", { description: detail });
        }
      },
      renderFence: (language, content) => {
        if (
          language !== AGENT_MESSAGE_LANGUAGE &&
          language !== AGENT_FILES_LANGUAGE &&
          !isMermaidLanguage(language)
        ) {
          return null;
        }
        // The code block copies a preview in as markup, so what it gets is
        // an empty element to find again; React draws into it once it is up.
        const id = ++fenceId;
        setFences((current) => [
          ...current,
          { content, createdAt: Date.now(), id, language },
        ]);
        return `<div class="md-fence" data-fence-id="${id}"></div>`;
      },
      resolveSrc: (src) => resolveImageSrc(src, folder),
      root,
    });
    void created.then(
      (next) => {
        if (live) {
          setSession(next);
          if (import.meta.env.DEV) {
            exposeForTests(hostPath, next);
          }
        } else {
          void next.destroy();
        }
      },
      (error: unknown) => {
        toast.error("Could not open the editor", {
          description: error instanceof Error ? error.message : undefined,
        });
      },
    );
    return () => {
      live = false;
      void created.then((next) => next.destroy());
    };
    // The session is the file's for the component's life; the caller keys the
    // component on the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finds the elements the code blocks made for their fences. A block's
  // preview is drawn afresh on every edit; the fences it replaced have left
  // the document and are dropped.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    let frame = 0;
    const scan = () => {
      frame = 0;
      const next = new Map<number, HTMLElement>();
      for (const element of root.querySelectorAll<HTMLElement>(
        ".md-fence[data-fence-id]",
      )) {
        next.set(Number(element.dataset.fenceId), element);
      }
      setTargets((current) =>
        current.size === next.size &&
        [...next].every(([id, element]) => current.get(id) === element)
          ? current
          : next,
      );
      const now = Date.now();
      setFences((current) => {
        const kept = current.filter(
          (fence) => next.has(fence.id) || now - fence.createdAt < 2000,
        );
        return kept.length === current.length ? current : kept;
      });
    };
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(scan);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // The pill goes once the change is in view, however it got there.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root ? scrollParentOf(root) : null;
    if (!offscreen || !scroller) {
      return;
    }
    const onScroll = () => {
      const element = changedRef.current;
      if (!element?.isConnected) {
        setOffscreen(null);
        return;
      }
      const box = element.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      if (box.bottom > view.top && box.top < view.bottom) {
        setOffscreen(null);
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [offscreen]);

  const isMessage = isMessageDocument(fm + "\n");
  const message = isMessage ? parseMessage(fm) : null;
  const editFrontMatter = (next: string) => {
    setFm(next);
    session?.setFrontMatter(next);
  };

  return (
    <MarkdownDocument headingSelector={HEADING_SELECTOR}>
      <div
        className={cn(
          "px-8 pt-8 pb-24",
          isMessage && "mx-auto w-full max-w-2xl",
        )}
      >
        <div
          className={cn(
            isMessage &&
              "rounded-xl border border-border bg-card text-card-foreground shadow-xs",
          )}
        >
          {message ? (
            <MessageHead
              fm={fm}
              key={fmRevision}
              kind={message.kind}
              onChange={editFrontMatter}
              subject={message.subject ?? ""}
              to={message.to ?? ""}
              via={message.via}
            />
          ) : (
            fm && (
              <FrontMatterCard
                fm={fm}
                key={fmRevision}
                onChange={editFrontMatter}
              />
            )
          )}
          <div
            className={cn(
              "md-editor",
              isMessage && "md-message-body px-4 pt-3",
            )}
            data-status={status}
            ref={rootRef}
          />
          {message && session && (
            <div className="sticky bottom-0 flex items-center justify-end gap-1.5 rounded-b-xl bg-card px-3.5 py-3">
              <MessageActions
                getMessage={() => {
                  const text = session.currentText();
                  return parseMessage(text);
                }}
                kind={message.kind}
              />
            </div>
          )}
        </div>
      </div>
      {offscreen && (
        <div className="pointer-events-none sticky bottom-4 flex justify-center">
          <button
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 text-xs font-medium text-foreground shadow-md hover:bg-muted"
            onClick={() => {
              changedRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
              setOffscreen(null);
            }}
            type="button"
          >
            {offscreen === "below" ? (
              <ArrowDownIcon className="size-3.5" />
            ) : (
              <ArrowUpIcon className="size-3.5" />
            )}
            {offscreen === "below" ? "Updated below" : "Updated above"}
          </button>
        </div>
      )}
      {fences.map((fence) => {
        const element = targets.get(fence.id);
        return element
          ? createPortal(
              <FenceView
                content={fence.content}
                language={fence.language}
                onEditSource={(anchor) => {
                  editFenceSource(session, fence, element, anchor);
                }}
              />,
              element,
              String(fence.id),
            )
          : null;
      })}
    </MarkdownDocument>
  );
}

/**
 * A message document's head: what it is and who it is for, and its subject,
 * each editable in place and written back into the front matter.
 */
function MessageHead({
  fm,
  kind,
  onChange,
  subject,
  to,
  via,
}: {
  fm: string;
  kind: ReturnType<typeof parseMessage>["kind"];
  onChange: (next: string) => void;
  subject: string;
  to: string;
  via: string | undefined;
}) {
  const [toValue, setTo] = useState(to);
  const [subjectValue, setSubject] = useState(subject);
  const fmRef = useRef(fm);
  fmRef.current = fm;
  const described = messageKindOf(kind);
  const field =
    "min-w-0 flex-1 rounded-sm bg-transparent px-1 py-0.5 text-foreground outline-none placeholder:text-muted-foreground/60 hover:bg-muted focus:bg-muted";
  return (
    <div className="not-prose">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
        {described.icon}
        <span className="shrink-0">
          {via ? `${via} ${described.label.toLowerCase()}` : described.label} to
        </span>
        <input
          aria-label="To"
          className={field}
          onChange={(event) => {
            setTo(event.target.value);
            onChange(
              setFrontMatterField(fmRef.current, "to", event.target.value),
            );
          }}
          placeholder="Who it is for"
          value={toValue}
        />
      </div>
      {(kind === "email" || subjectValue) && (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Subject</span>
          <input
            aria-label="Subject"
            className={cn(field, "font-semibold")}
            onChange={(event) => {
              setSubject(event.target.value);
              onChange(
                setFrontMatterField(
                  fmRef.current,
                  "subject",
                  event.target.value,
                ),
              );
            }}
            placeholder="Subject"
            value={subjectValue}
          />
        </div>
      )}
    </div>
  );
}

/**
 * An image's address as the editor loads it: a path in the file is relative
 * to the file's folder and read from this computer; a `data:` image is its
 * own bytes. A remote address is not fetched, as in the static preview of a
 * file someone else may have written: the image shows its alt text.
 */
function resolveImageSrc(src: string, folder: string): string {
  if (!src) {
    return "";
  }
  if (/^data:image\//i.test(src)) {
    return src;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) {
    return "";
  }
  const path = src.startsWith("/")
    ? src
    : decodeURI(new URL(src, `file://${encodeURI(folder)}`).pathname);
  return getComputerFileUrl({ hostPath: path });
}

function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") {
      return at;
    }
  }
  return null;
}

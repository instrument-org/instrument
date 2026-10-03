import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import {
  getGuestGeneration,
  getWebviewElement,
} from "@/client/lib/browser-pool";
import { registerFileFlush } from "@/client/lib/file-flush";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { rpcClient } from "@/client/rpc/client";
import { PAGE_EDITOR_CHANNEL } from "@/shared/page-editor-channels";
import {
  PageEditorGuestMessageSchema,
  type PageEditorHostMessage,
} from "@/shared/page-editor-messages";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { isPageEditAddress } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createActor, fromCallback } from "xstate";

import {
  pageEditSessionMachine,
  type PageEditServeEvent,
} from "./page-edit-session";
import { usePageEdit } from "./page-edit-state";
import {
  linesLabel,
  numbered,
  useAskRevealer,
  useFileAsks,
  useMoveAsks,
  useStageAsk,
  useStagedAskActions,
} from "./staged-asks";

/**
 * Editing a page's file in place, from the window's side.
 *
 * The page tab's guest runs the editor itself (see `page-editor-guest/`); the
 * window turns Edit on and off, writes what the editor saves, tells it when
 * the file changed under it, and stages what the person asks about the page
 * beside the file's other asks, keeping the page's pins and the dock's list
 * of them to what is staged. The dock is the page's tray: its button moves
 * what waits into a chat, as the tray under any other file does. A page is only ever edited from its tab, and the file
 * a tab edits is the one it shows.
 */

/** How long a flush waits for the guest to answer, for a guest that is gone or stuck. */
const FLUSH_TIMEOUT_MS = 3000;

/**
 * Each tab's loads, writes and stops, in order across Edit sessions, so a
 * stop left behind a slow write never lands after the next Edit's load.
 */
const tabChains = new Map<string, Promise<unknown>>();

/**
 * One page tab in Edit: shows the stamped page in its guest, and serves the
 * editor running there. Mounted for every tab in Edit, not only the one on
 * screen, so moving between tabs keeps each where it was.
 */
export function PageEditSession({
  isShown,
  path,
  tabId,
  target,
}: {
  /** Whether this tab's page is the one on screen, for the picture held over it while it reloads. */
  isShown: boolean;
  path: string;
  tabId: string;
  target: BrowserTargetId;
}) {
  // The page as it looked just before a reload, held over it until the
  // reloaded page is ready, so an edit or the agent's change never flashes
  // the page blank.
  const [cover, setCover] = useState<null | string>(null);
  const { setEditing } = usePageEdit(tabId);
  // The Edit control lives in the address row; the guest draws its toolbar to
  // match rather than floating it over the page.
  const placement = "row" as const;
  const stageAsk = useStageAsk();
  const { remove: removeAsks } = useStagedAskActions();
  const { label: moveLabelFor, move } = useMoveAsks();
  const asks = useFileAsks(path);
  const moveLabel = moveLabelFor(
    asks.filter((ask) => ask.destination === undefined).length,
  );
  // The page's pins, numbered as the pills are, and which of them wait in
  // the page's dock rather than in a chat's composer.
  const staged = {
    asks: numbered(asks).map(({ ask, n }) => ({
      id: ask.id,
      instruction: ask.instruction,
      moved: ask.destination !== undefined,
      n,
      target: ask.target,
    })),
    moveLabel,
    type: "staged",
  } satisfies PageEditorHostMessage;
  const moveWaiting = () => {
    move(asks.flatMap((ask) => (ask.destination ? [] : [ask.id])));
  };
  const latest = useRef({
    moveWaiting,
    placement,
    removeAsks,
    setEditing,
    stageAsk,
    staged,
  });
  useEffect(() => {
    latest.current = {
      moveWaiting,
      placement,
      removeAsks,
      setEditing,
      stageAsk,
      staged,
    };
  });
  // Serves the editor for as long as the tab is in Edit. `check` is how the
  // file watch below reaches the session.
  const session = useRef<null | { check: () => void }>(null);
  // The guest to serve: a tab switched to Edit before its guest attached is
  // served once it does, and a guest recreated under the tab is served anew.
  const attached = useBrowserTargets().has(target);
  const guestGeneration = attached ? getGuestGeneration(target) : undefined;

  useEffect(() => {
    const actor = createActor(
      pageEditSessionMachine.provide({
        actors: {
          serve: fromCallback<{ type: "none" }, void, PageEditServeEvent>(
            ({ sendBack }) => {
              // Looked up again: the guard that entered serving only answers
              // whether there is one.
              const guest = attachedGuest(target);
              return guest
                ? serveGuest({ guest, latest, path, sendBack, session, tabId })
                : undefined;
            },
          ),
        },
        guards: { hasGuest: () => attachedGuest(target) !== undefined },
      }),
    );
    const subscription = actor.subscribe((snapshot) => {
      setCover(snapshot.context.cover);
    });
    actor.start();
    return () => {
      subscription.unsubscribe();
      actor.stop();
      setCover(null);
    };
  }, [guestGeneration, path, tabId, target]);

  useEffect(() => {
    try {
      getWebviewElement(target)?.send(PAGE_EDITOR_CHANNEL, {
        placement,
        type: "placement",
      } satisfies PageEditorHostMessage);
    } catch {
      // Not attached; the next load carries it.
    }
  }, [placement, target]);

  // The page's pins follow the file's staged asks: numbered as the pills
  // are, and gone once sent or removed.
  const stagedKey = JSON.stringify(staged);
  useEffect(() => {
    try {
      getWebviewElement(target)?.send(
        PAGE_EDITOR_CHANNEL,
        latest.current.staged,
      );
    } catch {
      // Not attached; the next hello carries them.
    }
  }, [stagedKey, target]);
  useAskRevealer(path, (id) => {
    try {
      getWebviewElement(target)?.send(PAGE_EDITOR_CHANNEL, {
        id,
        type: "reveal",
      } satisfies PageEditorHostMessage);
    } catch {
      // Not attached: nothing to scroll.
    }
  });

  const watched = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({ input: { path } }),
  );
  const modifiedAt = watched.data?.modifiedAt;
  useEffect(() => {
    if (modifiedAt !== undefined) {
      session.current?.check();
    }
  }, [modifiedAt]);
  return cover && isShown ? (
    <img
      alt=""
      className="pointer-events-none absolute inset-0 z-20 size-full object-cover object-top-left"
      src={cover}
    />
  ) : null;
}

/** The two ways a page's tab shows it, as its mode menu names them. */
const PAGE_MODES = [
  {
    description: "See the page as it is",
    icon: EyeIcon,
    isEditing: false,
    label: "Viewing",
  },
  {
    description: "Change the page in place",
    icon: PencilSimpleIcon,
    isEditing: true,
    label: "Editing",
  },
] as const;

/**
 * The page's mode, for the row above it: a quiet button naming the mode the
 * page is in, which opens a menu of the two with the current one checked.
 * ⌘E switches between them without it, and the menu says so on the mode it
 * would switch to. Its mark and caret alone in a narrow row.
 */
export function PageEditToggle({ tabId }: { tabId: string }) {
  const { isEditing, setEditing } = usePageEdit(tabId);
  const current = PAGE_MODES[isEditing ? 1 : 0];
  const chord = formatAccelerator(WINDOW_SHORTCUTS.editPage.accelerator).join(
    "",
  );
  return (
    // Non-modal, so a press on the page's guest (its own web contents) is not
    // swallowed by a modal menu's overlay and closes it instead.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${current.label}. Change how the page is shown`}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground/70 outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-[3px] focus-visible:outline-ring/50 focus-visible:[outline-style:solid] data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground @max-xl/tabrow:gap-1 @max-xl/tabrow:px-1.5"
          type="button"
        >
          <current.icon className="size-3.5" />
          <span className="@max-xl/tabrow:sr-only">{current.label}</span>
          <CaretDownIcon className="size-2.5 opacity-60" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        // The page, not the trigger, is where attention goes after a pick.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        {PAGE_MODES.map((mode) => (
          <DropdownMenuItem
            className="items-start gap-2.5 py-2"
            key={mode.label}
            onSelect={() => {
              setEditing(mode.isEditing);
            }}
          >
            <mode.icon className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{mode.label}</span>
              <span className="text-xs text-muted-foreground">
                {mode.description}
              </span>
            </span>
            {mode.isEditing === isEditing ? (
              <CheckIcon className="mt-0.5 text-foreground" />
            ) : (
              <DropdownMenuShortcut className="mt-0.5">
                {chord}
              </DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The tab's guest, once it is attached and has web contents to serve. */
function attachedGuest(target: BrowserTargetId) {
  const webview = getWebviewElement(target);
  let webContentsId = -1;
  try {
    webContentsId = webview?.getWebContentsId() ?? -1;
  } catch {
    // Not attached yet.
  }
  return webview && webContentsId !== -1
    ? { webContentsId, webview }
    : undefined;
}

/**
 * Serves the editor in an attached guest: loads the stamped page, answers what
 * the editor asks, and stops it again once every write in flight has landed.
 * Returns the stop.
 */
function serveGuest({
  guest: { webContentsId, webview },
  latest,
  path,
  sendBack,
  session,
  tabId,
}: {
  guest: NonNullable<ReturnType<typeof attachedGuest>>;
  /** The component's latest callbacks, read when a message arrives. */
  latest: {
    current: {
      moveWaiting: () => void;
      placement: "row";
      removeAsks: (ids: string[]) => void;
      setEditing: (editing: boolean) => void;
      stageAsk: ReturnType<typeof useStageAsk>;
      staged: PageEditorHostMessage;
    };
  };
  path: string;
  sendBack: (event: PageEditServeEvent) => void;
  session: { current: null | { check: () => void } };
  tabId: string;
}) {
  // The file version the editor holds, as it last said or as a write
  // returned; a change on disk at any other version is someone else's.
  let known: string | undefined;
  // The load this session last made, which its stop names.
  let generation: number | undefined;
  const serial = (work: () => Promise<unknown>) => {
    serialFor(tabId, work);
  };
  // Back to the page as it is, saying why.
  const giveUp = (message: string, description?: string) => {
    toast.error(message, description ? { description } : {});
    latest.current.setEditing(false);
  };
  const load = async (input: { state: unknown; text?: string }) => {
    let result;
    try {
      result = await rpcClient.pageEditor.load.call({
        path,
        webContentsId,
        ...input,
      });
    } catch (error) {
      giveUp(
        "Could not open this page to edit",
        error instanceof Error ? error.message : undefined,
      );
      return;
    }
    generation = result.generation;
  };
  const send = (message: PageEditorHostMessage) => {
    try {
      webview.send(PAGE_EDITOR_CHANNEL, message);
    } catch {
      // The guest is gone; the tab closing ends this session too.
    }
  };
  const check = () => {
    serial(async () => {
      if (known === undefined) {
        return;
      }
      const disk = await rpcClient.files.read.call({ path });
      if (disk.version !== known) {
        known = disk.version;
        send({
          content: disk.content,
          type: "external",
          version: disk.version,
        });
      }
    });
  };
  session.current = { check };
  // Asked of the file by another view of it (its source) before that view
  // reads it: the editor commits what is being typed, and the flush settles
  // once every write it queued is on disk.
  const flushes = new Map<number, () => void>();
  let nextFlush = 0;
  const unregisterFlush = registerFileFlush(path, async () => {
    const id = ++nextFlush;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
      flushes.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      send({ id, type: "flush" });
    });
    flushes.delete(id);
    await tabChains.get(tabId);
  });
  const onMessage = (event: Event) => {
    const { args, channel } = event as Event & {
      args?: unknown[];
      channel?: string;
    };
    if (channel !== PAGE_EDITOR_CHANNEL) {
      return;
    }
    const parsed = PageEditorGuestMessageSchema.safeParse(args?.[0]);
    if (!parsed.success) {
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "ask": {
        const where = message.lines ? linesLabel(message.lines) : "on the page";
        latest.current.stageAsk({
          ...(message.context ? { context: message.context } : {}),
          excerpt: message.quote,
          id: message.id,
          instruction: message.instruction,
          path,
          target: `${message.label} · ${where}`,
        });
        break;
      }
      case "flushed": {
        flushes.get(message.id)?.();
        break;
      }
      case "hello": {
        known = message.version;
        send(latest.current.staged);
        check();
        sendBack({ type: "guestReady" });
        break;
      }
      case "leave": {
        latest.current.setEditing(false);
        break;
      }
      case "move": {
        latest.current.moveWaiting();
        break;
      }
      case "reload": {
        serial(async () => {
          try {
            const picture = await webview.capturePage();
            sendBack({ cover: picture.toDataURL(), type: "coverCaptured" });
          } catch {
            // Nothing to hold over it; the reload shows as it is.
          }
          await load({ state: message.state, text: message.text });
        });
        break;
      }
      case "save": {
        serial(async () => {
          try {
            const result = await rpcClient.files.write.call({
              baseVersion: message.baseVersion,
              content: message.content,
              path,
            });
            known = result.version;
            send({ id: message.id, result, type: "reply" });
          } catch (error) {
            // Answered either way: the editor's saves wait on this one.
            send({
              error: error instanceof Error ? error.message : "Could not save",
              id: message.id,
              type: "replyFailed",
            });
            throw error;
          }
        });
        break;
      }
      case "status": {
        // An editor that could not start says so, and the page goes back
        // to View; any other status line is the editor's own, and nothing
        // here shows one.
        if (message.kind === "error") {
          sendBack({ type: "editorFailed" });
          giveUp("The editor could not start", message.message);
        }
        break;
      }
      case "unstage": {
        latest.current.removeAsks([message.id]);
        break;
      }
    }
  };
  // The guest leaving the stamped copy (Back, a link, the page's own
  // script) leaves Edit: what it shows then is not what is being edited.
  const onNavigate = (event: Event) => {
    const { url } = event as Event & { url?: string };
    if (generation !== undefined && url && !isPageEditAddress(url)) {
      latest.current.setEditing(false);
    }
  };
  webview.addEventListener("ipc-message", onMessage);
  webview.addEventListener("did-navigate", onNavigate);
  serial(() => load({ state: { placement: latest.current.placement } }));
  return () => {
    webview.removeEventListener("ipc-message", onMessage);
    webview.removeEventListener("did-navigate", onNavigate);
    session.current = null;
    unregisterFlush();
    for (const done of flushes.values()) {
      done();
    }
    // After every write in flight, so leaving never drops an edit.
    serial(async () => {
      if (generation !== undefined) {
        await rpcClient.pageEditor.stop.call({
          generation,
          path,
          webContentsId,
        });
      }
    });
  };
}

function serialFor(tabId: string, work: () => Promise<unknown>) {
  const next = (tabChains.get(tabId) ?? Promise.resolve())
    .then(work, work)
    .catch(() => {
      // A write or a load that failed leaves the editor holding its text;
      // its next save retries against whatever is on disk.
    });
  tabChains.set(tabId, next);
  void next.finally(() => {
    if (tabChains.get(tabId) === next) {
      tabChains.delete(tabId);
    }
  });
}

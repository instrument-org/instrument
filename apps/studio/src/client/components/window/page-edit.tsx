import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import {
  getGuest,
  getGuestGeneration,
  type GuestHandle,
} from "@/client/lib/browser-pool";
import { registerFileFlush } from "@/client/lib/file-flush";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { createDiskQueue, usePullOnDiskChange } from "@/client/lib/live-file";
import { rpcClient } from "@/client/rpc/client";
import { PAGE_EDITOR_CHANNEL } from "@/shared/page-editor-channels";
import {
  type PageEditorFlushRequest,
  PageEditorGuestMessageSchema,
  type PageEditorHostMessage,
} from "@/shared/page-editor-messages";
import { answerRequest, createRequests } from "@/shared/page-editor-requests";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { isPageEditAddress } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { noop } from "radashi";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/client/lib/toast";
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
 * Each tab's loads, writes, reads and stops on one disk queue, in order
 * across Edit sessions, so a stop left behind a slow write never lands after
 * the next Edit's load. Held while any session of the tab uses it.
 */
const tabQueues = new Map<
  string,
  { queue: ReturnType<typeof createDiskQueue>; users: number }
>();

function acquireTabQueue(tabId: string) {
  const held = tabQueues.get(tabId) ?? {
    queue: createDiskQueue({ label: "page editor" }),
    users: 0,
  };
  held.users += 1;
  tabQueues.set(tabId, held);
  return {
    queue: held.queue,
    release: () => {
      held.users -= 1;
      if (held.users === 0 && tabQueues.get(tabId) === held) {
        tabQueues.delete(tabId);
      }
    },
  };
}

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
  // Serves the editor for as long as the tab is in Edit; the file watch below
  // pulls the disk into it.
  const [session, setSession] = useState<null | { pull: () => void }>(null);
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
              const guest = getGuest(target);
              return guest
                ? serveGuest({
                    guest,
                    latest,
                    path,
                    sendBack,
                    setSession,
                    tabId,
                  })
                : undefined;
            },
          ),
        },
        guards: { hasGuest: () => getGuest(target) !== null },
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

  // A guest not ready yet gets these with its next load.
  useEffect(() => {
    getGuest(target)?.send(PAGE_EDITOR_CHANNEL, {
      placement,
      type: "placement",
    } satisfies PageEditorHostMessage);
  }, [placement, target]);

  // The page's pins follow the file's staged asks: numbered as the pills
  // are, and gone once sent or removed.
  const stagedKey = JSON.stringify(staged);
  useEffect(() => {
    getGuest(target)?.send(PAGE_EDITOR_CHANNEL, latest.current.staged);
  }, [stagedKey, target]);
  useAskRevealer(path, (id) => {
    getGuest(target)?.send(PAGE_EDITOR_CHANNEL, {
      id,
      type: "reveal",
    } satisfies PageEditorHostMessage);
  });

  usePullOnDiskChange(path, session);
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

/**
 * Serves the editor in an attached guest: loads the stamped page, answers what
 * the editor asks, and stops it again once every write in flight has landed.
 * Returns the stop.
 */
function serveGuest({
  guest,
  latest,
  path,
  sendBack,
  setSession,
  tabId,
}: {
  guest: GuestHandle;
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
  setSession: (session: null | { pull: () => void }) => void;
  tabId: string;
}) {
  // The file version the editor holds, as it last said or as a write
  // returned; a change on disk at any other version is someone else's.
  let known: string | undefined;
  // The load this session last made, which its stop names.
  let generation: number | undefined;
  const { queue, release } = acquireTabQueue(tabId);
  const serial = (work: () => Promise<void>) => {
    void queue.run(work);
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
        webContentsId: guest.webContentsId,
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
  // A guest gone meanwhile takes nothing; the tab closing ends this session too.
  const send = (message: PageEditorHostMessage) => {
    guest.send(PAGE_EDITOR_CHANNEL, message);
  };
  // The editor told what changed on disk that it did not write.
  const check = async () => {
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
  };
  const pull = () => {
    queue.pull(check);
  };
  setSession({ pull });
  // Asked of the file by another view of it (its source) before that view
  // reads it: the editor commits what is being typed, and the flush settles
  // once every write it queued is on disk. A guest that is gone or stuck
  // fails the question at its deadline, and the flush settles all the same.
  const flushes = createRequests<PageEditorFlushRequest, null>({
    send,
    timeoutMs: FLUSH_TIMEOUT_MS,
  });
  const unregisterFlush = registerFileFlush(path, async () => {
    await flushes.request({ kind: "flush" }).catch(noop);
    await queue.settled();
  });
  const onMessage = ({
    args,
    channel,
  }: {
    args: unknown[];
    channel: string;
  }) => {
    if (channel !== PAGE_EDITOR_CHANNEL) {
      return;
    }
    const parsed = PageEditorGuestMessageSchema.safeParse(args[0]);
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
      case "hello": {
        known = message.version;
        send(latest.current.staged);
        pull();
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
          // With no picture, the reload shows as it is.
          const cover = await guest.capture();
          if (cover) {
            sendBack({ cover, type: "coverCaptured" });
          }
          await load({ state: message.state, text: message.text });
        });
        break;
      }
      case "request": {
        // A save, answered whatever the write does: the editor's later saves
        // wait on this one.
        serial(() =>
          answerRequest(
            message,
            async ({ baseVersion, content }) => {
              const result = await rpcClient.files.write.call({
                baseVersion,
                content,
                path,
              });
              known = result.version;
              return result;
            },
            send,
          ),
        );
        break;
      }
      case "response": {
        flushes.settle(
          message.error === undefined
            ? { id: message.id, result: null, type: "response" }
            : { error: message.error, id: message.id, type: "response" },
        );
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
  const onNavigate = ({ url }: { url: string }) => {
    if (generation !== undefined && url && !isPageEditAddress(url)) {
      latest.current.setEditing(false);
    }
  };
  const stopMessages = guest.on("ipc-message", onMessage);
  const stopNavigate = guest.on("did-navigate", onNavigate);
  serial(() => load({ state: { placement: latest.current.placement } }));
  return () => {
    stopMessages();
    stopNavigate();
    setSession(null);
    unregisterFlush();
    flushes.abandon("The page left Edit");
    // After every write in flight, so leaving never drops an edit.
    serial(async () => {
      if (generation !== undefined) {
        await rpcClient.pageEditor.stop.call({
          generation,
          path,
          webContentsId: guest.webContentsId,
        });
      }
    });
    void queue.settled().then(release);
  };
}

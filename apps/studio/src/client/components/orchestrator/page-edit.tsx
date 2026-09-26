import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import {
  getGuestGeneration,
  getWebviewElement,
} from "@/client/lib/browser-pool";
import { registerFileFlush } from "@/client/lib/file-flush";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { pageEditPlacementAtom, usePageEdit } from "./page-edit-state";
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

const CHANNEL = "page-editor";

const TOO_LARGE = "This page is too large to edit here";

/** How long a flush waits for the guest to answer, for a guest that is gone or stuck. */
const FLUSH_TIMEOUT_MS = 3000;

/** How long to wait for a guest to attach before looking again, and how many looks. */
const ATTACH_RETRY_MS = 250;
const ATTACH_RETRIES = 40;

/**
 * Each tab's loads, writes and stops, in order across Edit sessions, so a
 * stop left behind a slow write never lands after the next Edit's load.
 */
const tabChains = new Map<string, Promise<unknown>>();

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

const GuestMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), version: z.string() }),
  z.object({
    baseVersion: z.string(),
    content: z.string(),
    id: z.number(),
    type: z.literal("save"),
  }),
  z.object({ state: z.unknown(), text: z.string(), type: z.literal("reload") }),
  z.object({
    /** What the element's text alone does not say: a script makes or feeds it, and where. */
    context: z.string(),
    id: z.string(),
    instruction: z.string(),
    /** What the element is, as the editor names it: "Heading", "Button". */
    label: z.string(),
    lines: z.tuple([z.number(), z.number()]).nullable(),
    quote: z.string(),
    type: z.literal("ask"),
  }),
  z.object({ type: z.literal("move") }),
  z.object({ id: z.string(), type: z.literal("unstage") }),
  z.object({ type: z.literal("leave") }),
  z.object({ id: z.number(), type: z.literal("flushed") }),
  z.object({
    kind: z.string().nullable(),
    message: z.string(),
    type: z.literal("status"),
  }),
]);

/** The page menu's switch between the two placements of the Edit control, while both are tried. */
export function PageEditMenuItems() {
  const [placement, setPlacement] = useAtom(pageEditPlacementAtom);
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <PencilSimpleIcon className="size-4" />
          Edit control
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            onValueChange={(value) => {
              setPlacement(value === "pill" ? "pill" : "row");
            }}
            value={placement}
          >
            <DropdownMenuRadioItem value="row">
              In the address row
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="pill">
              Floating on the page
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
    </>
  );
}

/** The floating way in: a pill at the page's foot, which the edit toolbar takes the place of. */
export function PageEditPill({ tabId }: { tabId: string }) {
  const { isEditing, setEditing } = usePageEdit(tabId);
  const placement = useAtomValue(pageEditPlacementAtom);
  if (placement !== "pill" || isEditing) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3.5 z-30 flex justify-center">
      <button
        className="pointer-events-auto flex h-9 items-center gap-2 rounded-xl border border-border bg-popover px-3.5 text-sm font-medium text-popover-foreground shadow-lg hover:bg-accent"
        onClick={() => {
          setEditing(true);
        }}
        type="button"
      >
        <PencilSimpleIcon className="size-4" />
        Edit page
        <span className="text-xs text-muted-foreground">⌘E</span>
      </button>
    </div>
  );
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
  const placement = useAtomValue(pageEditPlacementAtom);
  const stageAsk = useStageAsk();
  const { remove: removeAsks } = useStagedAskActions();
  const { label: moveLabel, move } = useMoveAsks();
  const asks = useFileAsks(path);
  // The page's pins, numbered as the pills are, and which of them wait in
  // the page's dock rather than in a chat's composer.
  const staged = {
    asks: numbered(asks).map(({ ask, n }) => ({
      id: ask.id,
      moved: ask.destination !== undefined,
      n,
    })),
    moveLabel,
    type: "staged",
  };
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const webview = getWebviewElement(target);
    let webContentsId = -1;
    try {
      webContentsId = webview?.getWebContentsId() ?? -1;
    } catch {
      // Not attached yet; looked for again below.
    }
    if (!webview || webContentsId === -1) {
      if (attempt >= ATTACH_RETRIES) {
        return;
      }
      const timer = setTimeout(() => {
        setAttempt((current) => current + 1);
      }, ATTACH_RETRY_MS);
      return () => {
        clearTimeout(timer);
      };
    }
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
      if (result.tooLarge) {
        setCover(null);
        giveUp(TOO_LARGE);
        return;
      }
      generation = result.generation;
    };
    const send = (message: unknown) => {
      try {
        webview.send(CHANNEL, message);
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
        flushes.set(id, resolve);
        send({ id, type: "flush" });
        setTimeout(resolve, FLUSH_TIMEOUT_MS);
      });
      flushes.delete(id);
      await tabChains.get(tabId);
    });
    const onMessage = (event: Event) => {
      const { args, channel } = event as Event & {
        args?: unknown[];
        channel?: string;
      };
      if (channel !== CHANNEL) {
        return;
      }
      const parsed = GuestMessageSchema.safeParse(args?.[0]);
      if (!parsed.success) {
        return;
      }
      const message = parsed.data;
      switch (message.type) {
        case "ask": {
          const where = message.lines
            ? linesLabel(message.lines)
            : "on the page";
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
          setTimeout(() => {
            setCover(null);
          }, 80);
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
              setCover(picture.toDataURL());
            } catch {
              // Nothing to hold over it; the reload shows as it is.
            }
            await load({ state: message.state, text: message.text });
          });
          break;
        }
        case "save": {
          serial(async () => {
            const result = await rpcClient.files.write.call({
              baseVersion: message.baseVersion,
              content: message.content,
              path,
            });
            known = result.version;
            send({ id: message.id, result, type: "reply" });
          });
          break;
        }
        case "status": {
          // An editor that could not start says so, and the page goes back
          // to View; any other status line is the editor's own, and nothing
          // here shows one.
          if (message.kind === "error") {
            setCover(null);
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
      if (generation !== undefined && url && !url.startsWith("data:")) {
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
  }, [attempt, guestGeneration, path, tabId, target]);

  useEffect(() => {
    try {
      getWebviewElement(target)?.send(CHANNEL, {
        placement,
        type: "placement",
      });
    } catch {
      // Not attached; the next load carries it.
    }
  }, [placement, target]);

  // The page's pins follow the file's staged asks: numbered as the pills
  // are, and gone once sent or removed.
  const stagedKey = JSON.stringify(staged);
  useEffect(() => {
    try {
      getWebviewElement(target)?.send(CHANNEL, latest.current.staged);
    } catch {
      // Not attached; the next hello carries them.
    }
  }, [stagedKey, target]);
  useAskRevealer(path, (id) => {
    try {
      getWebviewElement(target)?.send(CHANNEL, { id, type: "reveal" });
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
  // A reload that never reports back must not leave a picture standing.
  useEffect(() => {
    if (cover === null) {
      return;
    }
    const timer = setTimeout(() => {
      setCover(null);
    }, 6000);
    return () => {
      clearTimeout(timer);
    };
  }, [cover]);
  return cover && isShown ? (
    <img
      alt=""
      className="pointer-events-none absolute inset-0 z-20 size-full object-cover object-top-left"
      src={cover}
    />
  ) : null;
}

/** View and Edit, side by side, for the row above the page. */
export function PageEditToggle({ tabId }: { tabId: string }) {
  const { isEditing, setEditing } = usePageEdit(tabId);
  const option = (label: string, value: boolean, icon: ReactNode) => (
    <button
      aria-label={label}
      aria-pressed={isEditing === value}
      className={cn(
        "h-5.5 rounded-md border border-transparent px-2.5 text-xs font-medium outline-none focus-visible:outline-[3px] focus-visible:outline-ring/50 focus-visible:[outline-style:solid] @max-xl/tabrow:px-1.5",
        isEditing === value
          ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => {
        setEditing(value);
      }}
      type="button"
    >
      {/* Its mark alone in a narrow row. */}
      <span className="@max-xl/tabrow:hidden">{label}</span>
      <span className="hidden @max-xl/tabrow:inline [&_svg]:size-3.5">
        {icon}
      </span>
    </button>
  );
  return (
    <ToolbarTooltip
      chord="editPage"
      label={isEditing ? "Back to the page" : "Edit this page"}
    >
      <div className="mr-1 flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
        {option("View", false, <EyeIcon />)}
        {option("Edit", true, <PencilSimpleIcon />)}
      </div>
    </ToolbarTooltip>
  );
}

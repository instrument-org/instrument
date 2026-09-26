import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { useAskAboutSelection } from "./ask-about-selection";
import { pageEditPlacementAtom, usePageEdit } from "./page-edit-state";

/**
 * Editing a page's file in place, from the window's side.
 *
 * The page tab's guest runs the editor itself (see `page-editor-guest/`); the
 * window turns Edit on and off, writes what the editor saves, tells it when
 * the file changed under it, and passes what the person asks about the page
 * to the conversation. A page is only ever edited from its tab, and the file
 * a tab edits is the one it shows.
 */

const CHANNEL = "page-editor";

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
    lines: z.tuple([z.number(), z.number()]).nullable(),
    note: z.string(),
    quote: z.string(),
    type: z.literal("ask"),
  }),
  z.object({ type: z.literal("leave") }),
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
  const askAboutSelection = useAskAboutSelection();
  const latest = useRef({ askAboutSelection, placement, setEditing });
  useEffect(() => {
    latest.current = { askAboutSelection, placement, setEditing };
  });
  // Serves the editor for as long as the tab is in Edit. `check` is how the
  // file watch below reaches the session.
  const session = useRef<null | { check: () => void }>(null);

  useEffect(() => {
    const webview = getWebviewElement(target);
    let webContentsId: number;
    try {
      webContentsId = webview?.getWebContentsId() ?? -1;
    } catch {
      // Not attached: there is no page to edit yet.
      return;
    }
    if (!webview || webContentsId === -1) {
      return;
    }
    // The file version the editor holds, as it last said or as a write
    // returned; a change on disk at any other version is someone else's.
    let known: string | undefined;
    let chain: Promise<unknown> = Promise.resolve();
    const serial = (work: () => Promise<unknown>) => {
      chain = chain.then(work, work).catch(() => {
        // A write or a load that failed leaves the editor holding its text;
        // its next save retries against whatever is on disk.
      });
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
          latest.current.askAboutSelection({
            note: message.note,
            path,
            quote: message.quote,
            ...(message.lines ? { lines: message.lines } : {}),
          });
          break;
        }
        case "hello": {
          known = message.version;
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
        case "reload": {
          serial(async () => {
            try {
              const picture = await webview.capturePage();
              setCover(picture.toDataURL());
            } catch {
              // Nothing to hold over it; the reload shows as it is.
            }
            await rpcClient.pageEditor.load.call({
              path,
              state: message.state,
              text: message.text,
              webContentsId,
            });
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
          // What the editor would put in a status line; nothing here shows one.
          break;
        }
      }
    };
    webview.addEventListener("ipc-message", onMessage);
    serial(() =>
      rpcClient.pageEditor.load.call({
        path,
        state: { placement: latest.current.placement },
        webContentsId,
      }),
    );
    return () => {
      webview.removeEventListener("ipc-message", onMessage);
      session.current = null;
      // After every write in flight, so leaving never drops an edit.
      serial(async () => {
        await rpcClient.pageEditor.stop.call({ path, webContentsId });
      });
    };
  }, [path, target]);

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
  const option = (label: string, value: boolean) => (
    <button
      aria-pressed={isEditing === value}
      className={cn(
        "h-5.5 rounded-md border border-transparent px-2.5 text-xs font-medium outline-none focus-visible:outline-[3px] focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
        isEditing === value
          ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => {
        setEditing(value);
      }}
      type="button"
    >
      {label}
    </button>
  );
  return (
    <ToolbarTooltip
      chord="editPage"
      label={isEditing ? "Back to the page" : "Edit this page"}
    >
      <div className="mr-1 flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
        {option("View", false)}
        {option("Edit", true)}
      </div>
    </ToolbarTooltip>
  );
}

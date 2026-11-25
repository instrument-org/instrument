import { MiddleTruncate } from "@/client/components/middle-truncate";
import { type ChosenItem } from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { FileOpenContext } from "@/client/components/file-open-context";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import { addressOfTab, fileAddressOf } from "@/client/bookmarks/address";
import { wantsNewTab, wantsNewWindow } from "@/client/hooks/use-open-target";
import { displayPath } from "@/client/lib/path-utils";
import {
  COMPOSER_CHIP_CLASSNAME,
  COMPOSER_CHIP_SELECTED_CLASSNAME,
} from "@/client/components/attached-item-preview";
import { cn } from "@/client/lib/utils";
import {
  type ChatId,
  ChatIdSchema,
  isFolderPath,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { chatAddressOf, expandHomePath } from "@instrument-org/shared";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { VersionTag } from "@/client/components/version-tag";
import { type ReactNode, useContext } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import { type OpenOptions, WindowContext } from "./context";
import { contentOfAddress, useContentDrag } from "./drag/content-drag";
import { pageTabTitle } from "./file-tabs";
import { useVersionNamed } from "./file-versions";
import { segmentsOf } from "./host-path";
import { screenPresentation, type ScreenNames } from "./screen-presentation";
import { chatHref } from "./window-href";

type SentChip = SessionMessageDataPart.SentChip;

/** What a chip over a sent message is, as its tooltip says it. */
const SENT_WITH_THIS_MESSAGE = "Sent with this message";

/**
 * A tab a chip names as it goes with a message: what it points at on this
 * computer when that is something (one file or folder by its name, more by
 * their count), and otherwise the page or screen itself. The transcript draws
 * the chip again from this, so it names the thing the way the composer did.
 */
export function heldChipOf(
  { items, tab }: { items: ChosenItem[] | undefined; tab: WindowTab },
  names: Pick<ScreenNames, "appsBySlug" | "taskTitles" | "volumes">,
): SentChip {
  if (items !== undefined && items.length > 0) {
    return {
      items: items.map(({ kind, path }) => ({ kind, path })),
      kind: "paths",
    };
  }
  if (tab.kind === "page") {
    return {
      kind: "page",
      title: pageTabTitle(tab) || "Page",
      url: tab.url ?? "about:blank",
    };
  }
  return {
    kind: "screen",
    title: screenPresentation(tab.href, names).title,
    url: tab.href,
  };
}

/**
 * The chips a message went with, over it in the transcript the way they
 * stood over the words as it was written, without the x: what went cannot
 * be left out after it has gone. Each opens what it names the way the
 * surface around the transcript opens things, so in a chat it comes up in
 * the chat's own tabs.
 */
export function SentChips({
  chatId,
  chips: sent,
  isSeen = false,
}: {
  /** The chat the message is in, whose versions of a file a chip may name. */
  chatId?: ChatId;
  chips: SentChip[];
  /** What was beside the chat rather than put on the message, whose tooltip says only what and where it is. */
  isSeen?: boolean;
}) {
  const chips = sent.map(atHostPaths);
  const appsBySlug = useAppsBySlug();
  const appWindow = useContext(WindowContext);
  const openFile = useContext(FileOpenContext);
  const openerOf = (chip: SentChip) => {
    if (chip.kind === "paths") {
      return openFile
        ? (options: OpenOptions) => {
            for (const item of chip.items) {
              openFile(
                item.kind === "folder" && !isFolderPath(item.path)
                  ? `${item.path}/`
                  : item.path,
                options,
              );
            }
          }
        : undefined;
    }
    if (!appWindow) {
      return undefined;
    }
    if (chip.kind === "chat") {
      return (options: OpenOptions) => {
        appWindow.openScreen(chatHref(ChatIdSchema.parse(chip.id)), options);
      };
    }
    return chip.kind === "page"
      ? (options: OpenOptions) => {
          appWindow.openPage(chip.url, options);
        }
      : (options: OpenOptions) => {
          appWindow.openScreen(chip.url, options);
        };
  };
  return (
    // No box of its own: the chips stand in the row of what went with the
    // message, beside its folders and files.
    <div className="contents" data-slot="sent-chips">
      {chips.map((chip) => (
        <ContextChip
          key={keyOfChip(chip)}
          label={
            <ChipLabel
              paths={
                chip.kind === "paths"
                  ? chip.items.map((item) => item.path)
                  : chip.kind === "page"
                    ? [chip.url]
                    : []
              }
              said={isSeen ? nameOfChip(chip) : SENT_WITH_THIS_MESSAGE}
            />
          }
          mark={
            chip.kind === "chat" ? (
              <ChatCircleIcon />
            ) : chip.kind === "page" ? (
              <TabIcon favicon={undefined} url={chip.url} />
            ) : chip.kind === "screen" ? (
              screenPresentation(chip.url, { appsBySlug }).icon
            ) : chip.items.length === 1 && chip.items[0] ? (
              <ItemMark item={chip.items[0]} />
            ) : (
              <FileSystemFolderGlyph className="h-3 w-auto" />
            )
          }
          drags={
            chip.kind === "paths" && chip.items[0]
              ? {
                  hostPath: chip.items[0].path,
                  others: chip.items.slice(1).map((item) => item.path),
                }
              : undefined
          }
          holds={{ title: nameOfChip(chip), url: addressOfSent(chip) }}
          cutsMiddle={isOnePath(chip)}
          name={nameOfChip(chip)}
          onOpen={openerOf(chip)}
          {...(chip.kind === "paths" && chip.items.length === 1 && chip.items[0]
            ? { onePath: { chatId, path: chip.items[0].path } }
            : {})}
          slot="sent-chip"
        />
      ))}
    </div>
  );
}

/** A chip with a path the person would write from `~` as this computer's own. */
function atHostPaths(chip: SentChip): SentChip {
  return chip.kind === "paths"
    ? {
        ...chip,
        items: chip.items.map((item) => ({
          ...item,
          path: expandHomePath(item.path, window.api.homeDir),
        })),
      }
    : chip;
}

/** The address a file or folder chosen for a draft is kept and opened under. */
function addressOfItem(item: Pick<ChosenItem, "kind" | "path">) {
  return fileAddressOf(item.path, { isFolder: item.kind === "folder" });
}

/** The address a chip over a sent message names: a chat's, a page's, a screen's, or its one file or folder's. */
function addressOfSent(chip: SentChip): string | undefined {
  switch (chip.kind) {
    case "chat": {
      return chatAddressOf(ChatIdSchema.parse(chip.id));
    }
    case "page": {
      return chip.url;
    }
    case "screen": {
      return addressOfTab({ href: chip.url, kind: "screen" });
    }
    case "paths": {
      const [one] = chip.items;
      return chip.items.length === 1 && one ? addressOfItem(one) : undefined;
    }
  }
}

/** A chip's tooltip: what the chip means, then where the things it names are. */
function ChipLabel({ paths, said }: { paths: string[]; said: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span>{said}</span>
      {paths.map((path) => (
        <span className="break-all opacity-70" key={path}>
          {displayPath(path)}
        </span>
      ))}
    </span>
  );
}

/**
 * One quiet line at the head of the words: a mark and a name in grey, with
 * an x that leaves the thing out while there is still a message to leave it
 * out of, so it takes no room from the words and does not ask to be read;
 * what it is is in its tooltip. A chip with somewhere to open its thing is a
 * button that opens it, a modified or middle click in a tab of its own. A
 * chip that is one of a band's tabs puts its tab up when its name is pressed,
 * and the one up stands raised on the card's color.
 */
function ContextChip({
  cutsMiddle = false,
  drags,
  holds,
  isSelected = false,
  label,
  mark,
  name,
  onLeaveOut,
  onOpen,
  onePath,
  onSelect,
  slot,
}: {
  /** Whether the name is a file or folder's, cut in its middle when the chip is short of room. */
  cutsMiddle?: boolean;
  /** What dragging the chip out of the window carries: a sent chip's files and folders, never a draft's. */
  drags?: { hostPath: string; others: string[] };
  /** The address the chip names, held as a link when it is dragged and it carries no files. */
  holds?: { title: string; url: string | undefined };
  /** Whether the chip's tab is the one its band has up. */
  isSelected?: boolean;
  label: ReactNode;
  mark: ReactNode;
  name: string;
  onLeaveOut?: () => void;
  /** Opens the thing the chip names; a chip that can be left out has none, since the x sits inside it. */
  onOpen?: (options: OpenOptions) => void;
  /**
   * The one file or folder the chip names, with the chat it goes to: a
   * version the chat kept of a file is named as the file, with its number.
   */
  onePath?: { chatId: ChatId | undefined; path: string };
  /** Puts the chip's tab up in its band. */
  onSelect?: () => void;
  slot: string;
}) {
  const className = cn(
    COMPOSER_CHIP_CLASSNAME,
    "self-center",
    onLeaveOut ? "pr-1" : "pr-2",
    isSelected && COMPOSER_CHIP_SELECTED_CLASSNAME,
  );
  const fileDragProps = useFileDrag(drags);
  const held = holds?.url;
  const linkDragProps = useContentDrag(
    held === undefined ? undefined : contentOfAddress(held, holds?.title ?? ""),
    { isOff: drags !== undefined },
  );
  const dragProps = drags ? fileDragProps : linkDragProps;
  const version = useVersionNamed(onePath?.chatId, onePath?.path);
  const shownName = version?.name ?? name;
  const markAndName = (
    <>
      <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
        {mark}
      </span>
      {cutsMiddle ? (
        <MiddleTruncate extension text={shownName} />
      ) : (
        <span className="truncate">{shownName}</span>
      )}
      {version && (
        <VersionTag className="h-4 text-[11px]" number={version.number} />
      )}
    </>
  );
  const content = (
    <>
      {onSelect ? (
        <button
          aria-pressed={isSelected}
          className="-ml-1.5 flex h-full min-w-0 cursor-default items-center gap-1.5 rounded-l-[9px] pl-1.5"
          onClick={onSelect}
          type="button"
        >
          {markAndName}
        </button>
      ) : (
        markAndName
      )}
      {onLeaveOut && (
        <button
          aria-label={`Leave out ${name}`}
          className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          onClick={onLeaveOut}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onOpen && !onLeaveOut ? (
          <button
            {...dragProps}
            className={cn(
              className,
              "cursor-pointer hover:bg-foreground/[0.07]",
            )}
            data-slot={slot}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onOpen({ behind: true, newTab: true });
              }
            }}
            onClick={(event) => {
              onOpen(
                wantsNewWindow(event)
                  ? { newWindow: true }
                  : wantsNewTab(event)
                    ? { behind: true, newTab: true }
                    : {},
              );
            }}
            type="button"
          >
            {content}
          </button>
        ) : (
          <span {...dragProps} className={className} data-slot={slot}>
            {content}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent collisionPadding={10} maxWidth="20rem">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** A file's type icon, or the folder glyph for a folder. */
function ItemMark({ item }: { item: Pick<ChosenItem, "kind" | "path"> }) {
  return item.kind === "folder" ? (
    <FileSystemFolderGlyph className="h-3 w-auto" />
  ) : (
    <FileTypeIcon fileName={nameOfPath(item.path)} />
  );
}

/** Whether a chip names one file or folder, by its name. */
function isOnePath(chip: SentChip) {
  return chip.kind === "paths" && chip.items.length === 1;
}

/** What a chip calls the thing it names. */
function nameOfChip(chip: SentChip) {
  if (chip.kind !== "paths") {
    return chip.title;
  }
  const [one, ...rest] = chip.items;
  return one !== undefined && rest.length === 0
    ? nameOfPath(one.path)
    : `${chip.items.length} items`;
}

/** What tells a sent chip from the others over its message. */
function keyOfChip(chip: SentChip) {
  switch (chip.kind) {
    case "chat": {
      return `chat:${chip.id}`;
    }
    case "paths": {
      return chip.items.map((item) => item.path).join("\n");
    }
    default: {
      return `${chip.kind}:${chip.url}`;
    }
  }
}

/** The last name in a path, which is what a chip calls the thing. */
function nameOfPath(path: string) {
  return segmentsOf(path).at(-1) ?? path;
}

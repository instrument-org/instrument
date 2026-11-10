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
import { wantsNewTab, wantsNewWindow } from "@/client/hooks/use-open-target";
import { displayPath } from "@/client/lib/path-utils";
import {
  ChipPresence,
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
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { type ReactNode, useContext, useState } from "react";

import { type AppsBySlug, useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import { chatListOptions } from "./chat-list-query";
import { useComputerVolumes } from "./computer-volumes";
import { type OpenOptions, WindowContext } from "./context";
import {
  type ContextItem,
  type DrawnChip,
  drawnChipsOf,
} from "./context-items";
import { pageTabTitle } from "./file-tabs";
import { segmentsOf } from "./host-path";
import { screenPresentation, type ScreenNames } from "./screen-presentation";
import { chatHref } from "./window-href";

type SentChip = SessionMessageDataPart.SentChip;

/** What a chip of the composer's is, as its tooltip says it. */
const SENT_WITH_MESSAGE = "Goes with your message";

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
  names: Pick<ScreenNames, "appsBySlug" | "volumes">,
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
 * What the window has in view behind a draft, offered to it beside the plus:
 * dashed and quiet, the way the head offers a project, with a plus where a
 * chip has its x. A press takes it into the draft's band, where it is a chip
 * like any other from then on. Nothing offered goes with the message, so it
 * may follow the screen as the person moves about without changing what is
 * sent.
 */
export function ContextSuggestion({
  item,
  onTake,
}: {
  item: ContextItem;
  onTake: () => void;
}) {
  const appsBySlug = useAppsBySlug();
  const volumes = useComputerVolumes();
  if (item.kind !== "tab") {
    return null;
  }
  const chip = heldChipOf(
    { items: item.items, tab: item.tab },
    { appsBySlug, ...(volumes ? { volumes } : {}) },
  );
  const [one] = item.items ?? [];
  const name = nameOfChip(chip);
  return (
    <ToolbarTooltip label="Add to your message">
      <button
        aria-label={`Add ${name}`}
        className="inline-flex h-7 max-w-56 min-w-0 shrink items-center gap-1.5 rounded-[9px] border border-dashed border-border pr-1.5 pl-1.5 text-[12.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
        data-slot="context-suggestion"
        onClick={onTake}
        type="button"
      >
        <span className="grid size-4 shrink-0 place-items-center opacity-70 [&_img]:size-4 [&_svg]:size-4">
          {item.items?.length === 1 && one !== undefined ? (
            <ItemMark item={one} />
          ) : (
            <HeldMark appsBySlug={appsBySlug} tab={item.tab} />
          )}
        </span>
        <span className="min-w-0 truncate">{name}</span>
        <PlusIcon className="size-3 shrink-0" />
      </button>
    </ToolbarTooltip>
  );
}

/**
 * The chip at the head of the words naming one of the draft's own tabs, or
 * what a chat's view has up, in the row an attached file lands in, since it
 * goes with the words as a file does. One quiet line, its mark and name with
 * an x that leaves it out; what it is for is in its tooltip.
 */
function IncludedChip({
  appsBySlug,
  isSelected = false,
  items,
  onLeaveOut,
  onSelect,
  tab,
}: {
  appsBySlug: AppsBySlug;
  /** Whether the chip's tab is the one its band has up. */
  isSelected?: boolean;
  /** What the thing points at on this computer, which the chip names in place of the tab. */
  items: ChosenItem[] | undefined;
  onLeaveOut: () => void;
  /** Puts the chip's tab up in its band, for a chip that is one of a band's tabs. */
  onSelect?: () => void;
  tab: WindowTab;
}) {
  const volumes = useComputerVolumes();
  const chip = heldChipOf(
    { items, tab },
    { appsBySlug, ...(volumes ? { volumes } : {}) },
  );
  const [one] = items ?? [];
  return (
    <ContextChip
      label={
        <ChipLabel
          paths={(items ?? []).map((item) => item.path)}
          said={SENT_WITH_MESSAGE}
        />
      }
      mark={
        items?.length === 1 && one !== undefined ? (
          <ItemMark item={one} />
        ) : (
          <HeldMark appsBySlug={appsBySlug} tab={tab} />
        )
      }
      isSelected={isSelected}
      name={nameOfChip(chip)}
      onLeaveOut={onLeaveOut}
      {...(onSelect ? { onSelect } : {})}
      slot="included-chip"
    />
  );
}

/**
 * A composer's chips, one per item it carries (see `ContextItem`), in their
 * order, each with an x that leaves its item out. The one way a composer
 * shows what goes with its words, so a chip is never missing for something
 * that goes.
 *
 * Given a `band`, the chips of that band's tabs are its tabs too: a press on
 * one puts its tab up in the band, and the one up is drawn raised.
 */
export function ContextChips({
  band,
  items,
  onLeaveOut,
  onShow,
}: {
  band?: {
    group: string;
    onSelect: (tabId: string) => void;
    selectedId: string | undefined;
  };
  items: ContextItem[];
  onLeaveOut: (item: ContextItem) => void;
  /** Shows what a chip that is no band's tab names, where the host shows such things: behind a popped-out chat, the screen. */
  onShow?: (item: ContextItem) => void;
}) {
  const appsBySlug = useAppsBySlug();
  const chipOf = (item: ContextItem) => {
    const leaveOut = () => {
      onLeaveOut(item);
    };
    switch (item.kind) {
      case "chat": {
        return <ChatChip chatId={item.chat} onLeaveOut={leaveOut} />;
      }
      case "chosen": {
        return <ChosenChip item={item.item} onLeaveOut={leaveOut} />;
      }
      case "tab": {
        const { tab } = item;
        const inBand = band !== undefined && tab.group === band.group;
        return (
          <IncludedChip
            appsBySlug={appsBySlug}
            isSelected={inBand && tab.id === band.selectedId}
            items={item.items}
            onLeaveOut={leaveOut}
            onSelect={
              inBand
                ? () => {
                    band.onSelect(tab.id);
                  }
                : onShow
                  ? () => {
                      onShow(item);
                    }
                  : undefined
            }
            tab={tab}
          />
        );
      }
    }
  };
  // Keyed by the tab where a chip is one, so a folder's chip that comes to
  // name what is selected in it changes in place rather than going and
  // coming back; and a line's chip whose tab has just opened keeps the
  // line's key, so it is never drawn twice for a moment (`drawnChipsOf`).
  const [drawn, setDrawn] = useState<readonly DrawnChip[]>([]);
  const chips = drawnChipsOf(items, drawn);
  if (signatureOf(chips) !== signatureOf(drawn)) {
    setDrawn(chips);
  }
  return (
    <AnimatePresence initial={false}>
      {items.map((item, index) => (
        <ChipPresence key={chips[index]?.key ?? item.key}>
          {chipOf(item)}
        </ChipPresence>
      ))}
    </AnimatePresence>
  );
}

/**
 * Another chat the person had open, named and nothing more: what is in it
 * is that chat's, so the conversation is told which chat and not what it
 * shows.
 */
function ChatChip({
  chatId,
  onLeaveOut,
}: {
  chatId: ChatId;
  onLeaveOut: () => void;
}) {
  // The chat's title as the list has it: undefined while the list loads,
  // null once the list has no such chat.
  const title = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((chat) => chat.id === chatId)?.title ?? null,
  }).data;
  // A chat trashed since is not there to name, and goes with nothing.
  if (title === null) {
    return null;
  }
  return (
    <ContextChip
      label={<ChipLabel paths={[]} said={SENT_WITH_MESSAGE} />}
      mark={<ChatCircleIcon />}
      name={title ?? "Chat"}
      onLeaveOut={onLeaveOut}
      slot="chat-chip"
    />
  );
}

/** A file or folder the draft was opened on by name, held for the chat until it is left out. */
function ChosenChip({
  item,
  onLeaveOut,
}: {
  item: ChosenItem;
  onLeaveOut: () => void;
}) {
  return (
    <ContextChip
      label={<ChipLabel paths={[item.path]} said={SENT_WITH_MESSAGE} />}
      mark={<ItemMark item={item} />}
      name={nameOfPath(item.path)}
      onLeaveOut={onLeaveOut}
      slot="chosen-chip"
    />
  );
}

/**
 * The chips a message went with, over it in the transcript the way they
 * stood over the words as it was written, without the x: what went cannot
 * be left out after it has gone. Each opens what it names the way the
 * surface around the transcript opens things, so in a chat it comes up in
 * the chat's own tabs.
 */
export function SentChips({ chips }: { chips: SentChip[] }) {
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
              said={SENT_WITH_THIS_MESSAGE}
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
          name={nameOfChip(chip)}
          onOpen={openerOf(chip)}
          slot="sent-chip"
        />
      ))}
    </div>
  );
}

/** One thing a group holds, as its mark: a page's icon, or a screen's. */
export function HeldMark({
  appsBySlug,
  tab,
}: {
  appsBySlug: AppsBySlug;
  tab: WindowTab;
}) {
  if (tab.kind === "page") {
    return <TabIcon favicon={tab.favicon} url={tab.url} />;
  }
  return screenPresentation(tab.href, { appsBySlug }).icon;
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
  drags,
  isSelected = false,
  label,
  mark,
  name,
  onLeaveOut,
  onOpen,
  onSelect,
  slot,
}: {
  /** What dragging the chip out of the window carries: a sent chip's files and folders, never a draft's. */
  drags?: { hostPath: string; others: string[] };
  /** Whether the chip's tab is the one its band has up. */
  isSelected?: boolean;
  label: ReactNode;
  mark: ReactNode;
  name: string;
  onLeaveOut?: () => void;
  /** Opens the thing the chip names; a chip that can be left out has none, since the x sits inside it. */
  onOpen?: (options: OpenOptions) => void;
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
  const dragProps = drags ? fileDragProps : {};
  const markAndName = (
    <>
      <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
        {mark}
      </span>
      <span className="truncate">{name}</span>
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
                    ? { newTab: true }
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

/** What a set of drawn chips is, to tell whether it changed. */
function signatureOf(chips: readonly DrawnChip[]): string {
  return chips
    .map((chip) => `${chip.identity}=${chip.key}:${chip.lines.join(",")}`)
    .join("\n");
}

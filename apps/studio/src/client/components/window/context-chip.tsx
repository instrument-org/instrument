import { type ChosenItem, type WindowTab } from "@/client/atoms/window";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode } from "react";

import { type AppsBySlug, useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import { useComputerVolumes } from "./computer-volumes";
import { pageTabTitle } from "./file-tabs";
import { segmentsOf } from "./host-path";
import { screenPresentation, type ScreenNames } from "./screen-presentation";

type SentChip = SessionMessageDataPart.SentChip;

/** What a chip of the composer's is, as its tooltip says it. */
const SENT_WITH_MESSAGE = "Instrument sees this with your message.";

/** What a chip over a sent message is, as its tooltip says it. */
const SENT_WITH_THIS_MESSAGE = "Instrument saw this with your message.";

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
 * The chip at the head of the words naming what the screen already gives
 * the draft: the thing it was opened over, in the row an attached file lands
 * in, since it goes with the words as a file does. One quiet line, its mark
 * and name in grey with an x that leaves it out, so it takes no room from
 * the words and does not ask to be read; what it is for is in its tooltip.
 * Nothing of the thing itself is drawn in the draft, which stands over it.
 */
export function IncludedChip({
  appsBySlug,
  items,
  onLeaveOut,
  said = SENT_WITH_MESSAGE,
  tab,
}: {
  appsBySlug: AppsBySlug;
  /** What the thing points at on this computer, which the chip names in place of the tab. */
  items: ChosenItem[] | undefined;
  onLeaveOut: () => void;
  /** What the chip's tooltip says it is. */
  said?: string;
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
        <ChipLabel paths={(items ?? []).map((item) => item.path)} said={said} />
      }
      mark={
        items?.length === 1 && one !== undefined ? (
          <ItemMark item={one} />
        ) : (
          <HeldMark appsBySlug={appsBySlug} tab={tab} />
        )
      }
      name={nameOfChip(chip)}
      onLeaveOut={onLeaveOut}
      slot="included-chip"
    />
  );
}

/** A file or folder the draft was opened on by name, held for the chat until it is left out. */
export function ChosenChip({
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
 * be left out after it has gone.
 */
export function SentChips({ chips }: { chips: SentChip[] }) {
  const appsBySlug = useAppsBySlug();
  return (
    <div
      className="flex w-full flex-wrap justify-end gap-1"
      data-slot="sent-chips"
    >
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
            chip.kind === "page" ? (
              <TabIcon favicon={undefined} url={chip.url} />
            ) : chip.kind === "screen" ? (
              screenPresentation(chip.url, { appsBySlug }).icon
            ) : chip.items.length === 1 && chip.items[0] ? (
              <ItemMark item={chip.items[0]} />
            ) : (
              <FileSystemFolderGlyph className="h-3 w-auto" />
            )
          }
          name={nameOfChip(chip)}
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
          {path}
        </span>
      ))}
    </span>
  );
}

/**
 * One quiet line at the head of the words: a mark and a name in grey, with
 * an x that leaves the thing out while there is still a message to leave it
 * out of, so it takes no room from the words and does not ask to be read;
 * what it is is in its tooltip.
 */
function ContextChip({
  label,
  mark,
  name,
  onLeaveOut,
  slot,
}: {
  label: ReactNode;
  mark: ReactNode;
  name: string;
  onLeaveOut?: () => void;
  slot: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-6 max-w-44 min-w-0 items-center gap-1 self-center rounded-full bg-muted/60 pl-2 text-xs text-muted-foreground ring-1 ring-border/70",
            onLeaveOut ? "pr-0.5" : "pr-2.5",
          )}
          data-slot={slot}
        >
          <span className="grid size-3.5 shrink-0 place-items-center [&_img]:size-3.5 [&_svg]:size-3.5">
            {mark}
          </span>
          <span className="truncate">{name}</span>
          {onLeaveOut && (
            <button
              aria-label={`Leave out ${name}`}
              className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-foreground/8 hover:text-foreground"
              onClick={onLeaveOut}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </span>
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
  return chip.kind === "paths"
    ? chip.items.map((item) => item.path).join("\n")
    : `${chip.kind}:${chip.url}`;
}

/** The last name in a path, which is what a chip calls the thing. */
function nameOfPath(path: string) {
  return segmentsOf(path).at(-1) ?? path;
}

import { useBookmarkActions } from "@/client/bookmarks/actions";
import { sameAddress } from "@/client/bookmarks/address";
import { useBookmarkFolders } from "@/client/bookmarks/folders";
import {
  bookmarksLoadedAtom,
  bookmarksStateAtom,
  lastBookmarkFolderAtom,
} from "@/client/bookmarks/store";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { keyboardPlace } from "@/client/lib/keyboard-place";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { cn } from "@/client/lib/utils";
import { bookmarkPlaces, keyOfPlace, placeOf } from "@/shared/bookmarks";
import { instrumentAddressOf, SCREENS } from "@/shared/instrument-screens";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/BookmarksSimple";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { useAtomValue, useSetAtom } from "jotai";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { AddressMark } from "./app-chip";
import { BookmarkEditor, PlaceIndent } from "./bookmark-editor";

/**
 * The stars on screen that ⌘D may mean, each with the element it is drawn
 * as. The one nearest the keyboard answers (`requestBookmarkTab`).
 */
const stars = new Set<{
  element: () => HTMLElement | null;
  press: () => void;
}>();

/**
 * The window's Bookmark This Tab: the star of the tab the keyboard is in
 * keeps it, or shows its bookmark when it is kept already. Among the stars
 * on screen, the one sharing the most of its surroundings with where the
 * keyboard is (`keyboardPlace`) answers, so a chat's own row and the row of the tab
 * beside it each answer for their side.
 */
export function requestBookmarkTab() {
  const held = keyboardPlace();
  let best: { depth: number; press: () => void } | undefined;
  for (const star of stars) {
    const element = star.element();
    if (!element?.checkVisibility({ visibilityProperty: true })) {
      continue;
    }
    let depth = 0;
    for (let at: Element | null = element; at; at = at.parentElement) {
      if (held && at.contains(held)) {
        depth += 1;
      }
    }
    if (!best || depth >= best.depth) {
      best = { depth, press: star.press };
    }
  }
  best?.press();
}

/** Apps and Chats, which the bookmarks bar always starts with. */
function isFixedOnBar(address: string) {
  return [SCREENS.apps.href, SCREENS.chats.href].some((href) => {
    const fixed = instrumentAddressOf(href);
    return fixed !== undefined && sameAddress(fixed, address);
  });
}

/**
 * The star at the end of the address field: hollow until the address is
 * kept, filled once it is. A press keeps it where a new bookmark goes (the
 * folder picked last, or the bar) and opens its card, where it can be
 * renamed, filed or removed; pressed again, the card opens on the bookmark
 * kept. ⌘D does the same. Hollow, it is out of sight on a page the bar
 * always has (`isFixedOnBar`), and stays laid out there so that ⌘D still
 * means that page and not one beside it. Until the bookmarks are read it
 * is dimmed and does nothing, since whether the address is kept is not yet
 * known.
 */
export function BookmarkStar({
  address,
  title,
}: {
  /** What is kept: a site's address, or the app's own `instrument://` one. */
  address: string;
  /** What the bookmark is called until it is renamed. */
  title: string;
}) {
  const actions = useBookmarkActions();
  const isLoaded = useAtomValue(bookmarksLoadedAtom);
  const kept = actions.bookmarkOf(address);
  const isOutOfSight = kept === undefined && isFixedOnBar(address);
  const state = useAtomValue(bookmarksStateAtom);
  const folders = useBookmarkFolders();
  const setLastFolder = useSetAtom(lastBookmarkFolderAtom);
  const [card, setCard] = useState<"added" | "edit">();
  // The editor Choose another folder… opens, with the folder picked as it opened.
  const [editing, setEditing] = useState<{ folder: string | undefined }>();
  useCloseOnWindowBlur(card !== undefined, () => {
    setCard(undefined);
  });
  const button = useRef<HTMLButtonElement>(null);

  const press = () => {
    if (!isLoaded) {
      return;
    }
    // Pressed again while its card is up, the star puts the card away.
    if (card !== undefined) {
      setCard(undefined);
      return;
    }
    if (kept) {
      setCard("edit");
      return;
    }
    actions.bookmark({ title, url: address });
    setCard("added");
  };
  const pressForChord = useEffectEvent(press);
  useEffect(() => {
    const star = {
      element: () => button.current,
      press: () => {
        pressForChord();
      },
    };
    stars.add(star);
    return () => {
      stars.delete(star);
    };
  }, []);

  const keep = (name: string, place: string | undefined) => {
    if (!kept) {
      return;
    }
    actions.rename(kept, name);
    if (place !== keyOfPlace(placeOf(state, kept))) {
      folders.moveTo(kept, place);
      setLastFolder(place ?? null);
    }
  };

  return (
    <>
      <Popover
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setCard(undefined);
          }
        }}
        open={card !== undefined && kept !== undefined}
      >
        <ToolbarTooltip
          chord="bookmarkTab"
          label={kept ? "Edit bookmark" : "Bookmark this tab"}
        >
          <PopoverAnchor asChild>
            <button
              {...(isOutOfSight ? { "aria-hidden": true, tabIndex: -1 } : {})}
              className={cn(
                "-mr-1 grid size-6 shrink-0 cursor-default place-items-center rounded-md hover:bg-foreground/8",
                kept
                  ? "text-warning-500"
                  : "text-foreground/45 hover:text-foreground",
                !isLoaded &&
                  "text-foreground/20 hover:bg-transparent hover:text-foreground/20",
                isOutOfSight && "pointer-events-none opacity-0",
              )}
              data-bookmark-star={
                isLoaded ? (kept ? "kept" : "") : "loading"
              }
              disabled={!isLoaded}
              onClick={press}
              ref={button}
              type="button"
            >
              <StarIcon className="size-4" weight={kept ? "fill" : "regular"} />
            </button>
          </PopoverAnchor>
        </ToolbarTooltip>
        {kept && card && (
          <BookmarkCard
            address={kept.url}
            folder={keyOfPlace(placeOf(state, kept))}
            places={bookmarkPlaces(state)}
            // A fresh card for each bookmark, so the name typed is its own.
            key={kept.id}
            name={kept.title}
            onAnchor={(target) =>
              target instanceof Node &&
              button.current?.contains(target) === true
            }
            onChooseFolder={(folder) => {
              setCard(undefined);
              setEditing({ folder });
            }}
            onClose={() => {
              setCard(undefined);
            }}
            onKeep={keep}
            onRemove={() => {
              actions.remove(kept);
              setCard(undefined);
            }}
            title={card === "added" ? "Bookmark added" : "Edit bookmark"}
          />
        )}
      </Popover>
      {kept && editing && (
        <BookmarkEditor
          bookmark={kept}
          initialFolder={editing.folder}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </>
  );
}

/** Where the card's folder list stands for the bar, which has no id. */
const BAR = "bar";
/** The folder list's last row, which opens the editor. */
const CHOOSE = "choose";

/**
 * The star's card, the way a browser's is: the page's mark beside its name,
 * the folder it is filed in, and Remove or Done. The folder list has the bar
 * and its folders, All Bookmarks and its folders, and Choose another
 * folder… for the editor, where the address can change and a folder be
 * made. What is typed and picked is kept as the card goes away, by Done,
 * Escape or a press elsewhere; only Remove lets the bookmark go.
 */
function BookmarkCard({
  address,
  folder,
  name,
  onAnchor,
  onChooseFolder,
  onClose,
  onKeep,
  onRemove,
  places,
  title,
}: {
  address: string;
  /** Where it is kept, by the place's key (`placeOfKey`): the bar without one. */
  folder: string | undefined;
  name: string;
  /** Whether a press is on the star, which puts the card away itself rather than as a press elsewhere. */
  onAnchor: (target: EventTarget | null) => boolean;
  /** Choose another folder…, with the folder picked so far, once the card has kept what was typed (`onKeep`). */
  onChooseFolder: (folder: string | undefined) => void;
  onClose: () => void;
  onKeep: (name: string, folder: string | undefined) => void;
  onRemove: () => void;
  /** Every place it can be kept (`bookmarkPlaces`). */
  places: ReturnType<typeof bookmarkPlaces>;
  title: string;
}) {
  const [typed, setTyped] = useState(name);
  const [picked, setPicked] = useState(folder);
  const ids = useId();
  const isSettled = useRef(false);
  const keepEdits = useEffectEvent(() => {
    if (!isSettled.current) {
      onKeep(typed, picked);
    }
  });
  useEffect(
    () => () => {
      keepEdits();
    },
    [],
  );
  return (
    <PopoverContent
      align="end"
      className="w-80 p-4"
      data-bookmark-card=""
      onInteractOutside={(event) => {
        if (onAnchor(event.target)) {
          event.preventDefault();
        }
      }}
      onOpenAutoFocus={(event) => {
        // The name, selected whole, so typing names it afresh.
        event.preventDefault();
        const input = document.getElementById(`${ids}-name`);
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      }}
      sideOffset={8}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <p className="text-sm font-semibold">{title}</p>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[13px]">
          <label className="text-muted-foreground" htmlFor={`${ids}-name`}>
            Name
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-5 shrink-0 place-items-center">
              <AddressMark address={address} />
            </span>
            <Input
              className="h-8"
              id={`${ids}-name`}
              onChange={(event) => {
                setTyped(event.currentTarget.value);
              }}
              value={typed}
            />
          </div>
          <label className="text-muted-foreground" htmlFor={`${ids}-folder`}>
            Folder
          </label>
          <Select
            onValueChange={(value) => {
              if (value === CHOOSE) {
                // Kept now, so the editor opens on the name typed.
                isSettled.current = true;
                onKeep(typed, picked);
                onChooseFolder(picked);
                return;
              }
              setPicked(value === BAR ? undefined : value);
            }}
            value={picked ?? BAR}
          >
            <SelectTrigger className="w-full" id={`${ids}-folder`} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {places.map((place) => (
                <SelectItem key={place.key ?? BAR} value={place.key ?? BAR}>
                  {place.depth > 1 && <PlaceIndent depth={place.depth} />}
                  {place.depth === 0 ? (
                    <BookmarksSimpleIcon className="size-4" />
                  ) : (
                    <FolderSimpleIcon className="size-4" />
                  )}
                  <span className="min-w-0 truncate">{place.title}</span>
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={CHOOSE}>Choose another folder…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              isSettled.current = true;
              onRemove();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Remove
          </Button>
          <Button size="sm" type="submit" variant="brand">
            Done
          </Button>
        </div>
      </form>
    </PopoverContent>
  );
}

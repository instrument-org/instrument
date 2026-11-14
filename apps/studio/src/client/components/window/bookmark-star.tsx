import { useBookmarkActions } from "@/client/bookmarks/actions";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { cn } from "@/client/lib/utils";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

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
 * on screen, the one sharing the most of its surroundings with the element
 * holding the keyboard answers, so a chat's own row and the row of the tab
 * beside it each answer for their side.
 */
export function requestBookmarkTab() {
  const held = document.activeElement;
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

/**
 * The star at the end of the address field: hollow until the address is
 * kept, filled once it is. A press keeps it on the bookmarks bar and opens
 * its card, where it can be renamed or removed; pressed again, the card
 * opens on the bookmark kept. ⌘D does the same.
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
  const kept = actions.bookmarkOf(address);
  const [card, setCard] = useState<"added" | "edit">();
  useCloseOnWindowBlur(card !== undefined, () => {
    setCard(undefined);
  });
  const button = useRef<HTMLButtonElement>(null);

  const press = () => {
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

  return (
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
            className={cn(
              "-mr-1 grid size-6 shrink-0 cursor-default place-items-center rounded-md hover:bg-foreground/8",
              kept
                ? "text-brand-600"
                : "text-foreground/45 hover:text-foreground",
            )}
            data-bookmark-star={kept ? "kept" : ""}
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
          // A fresh card for each bookmark, so the name typed is its own.
          key={kept.id}
          name={kept.title}
          onAnchor={(target) =>
            target instanceof Node && button.current?.contains(target) === true
          }
          onClose={() => {
            setCard(undefined);
          }}
          onRemove={() => {
            actions.remove(kept);
            setCard(undefined);
          }}
          onRename={(name) => {
            actions.rename(kept, name);
          }}
          title={card === "added" ? "Bookmark added" : "Edit bookmark"}
        />
      )}
    </Popover>
  );
}

/**
 * The star's card, the way a browser's is: the name, and Remove or Done. The name typed is kept as the card goes away,
 * by Done or a press elsewhere; Esc leaves the name as it was.
 */
function BookmarkCard({
  name,
  onAnchor,
  onClose,
  onRemove,
  onRename,
  title,
}: {
  name: string;
  /** Whether a press is on the star, which puts the card away itself rather than as a press elsewhere. */
  onAnchor: (target: EventTarget | null) => boolean;
  onClose: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  title: string;
}) {
  const [typed, setTyped] = useState(name);
  const ids = useId();
  const isCanceled = useRef(false);
  const keepName = useEffectEvent(() => {
    if (!isCanceled.current) {
      onRename(typed);
    }
  });
  useEffect(
    () => () => {
      keepName();
    },
    [],
  );
  return (
    <PopoverContent
      align="end"
      className="w-80 p-4"
      data-bookmark-card=""
      onEscapeKeyDown={() => {
        isCanceled.current = true;
      }}
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
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 text-[13px]">
          <label className="text-muted-foreground" htmlFor={`${ids}-name`}>
            Name
          </label>
          <Input
            className="h-8"
            id={`${ids}-name`}
            onChange={(event) => {
              setTyped(event.currentTarget.value);
            }}
            value={typed}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              isCanceled.current = true;
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

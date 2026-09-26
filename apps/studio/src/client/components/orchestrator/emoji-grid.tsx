import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { useMemo, useRef, useState } from "react";

import { type Emoji, useEmojiSet } from "./emoji-set";
import { useEmojiSuggestions } from "./emoji-suggestions";

/**
 * The categories every emoji keyboard shows, in the order they show them,
 * keyed by emojibase's group number. The components group (bare skin tones
 * and hair styles) is left out: none of it stands on its own as a mark.
 */
const CATEGORIES = [
  { group: 0, icon: "😀", label: "Smileys & emotion" },
  { group: 1, icon: "👋", label: "People & body" },
  { group: 3, icon: "🐻", label: "Animals & nature" },
  { group: 4, icon: "🍔", label: "Food & drink" },
  { group: 5, icon: "🚗", label: "Travel & places" },
  { group: 6, icon: "⚽", label: "Activities" },
  { group: 7, icon: "💡", label: "Objects" },
  { group: 8, icon: "🔣", label: "Symbols" },
  { group: 9, icon: "🏳️", label: "Flags" },
] as const;

type Category = (typeof CATEGORIES)[number];

/** How many search matches are drawn at once. Past this, the query is too loose to help. */
const SHOWN = 240;

/** Columns in the grid, and the height of one row of it (a size-8 cell plus the gap). */
const COLUMNS = 8;
const ROW_HEIGHT = 34;

export function Cells({
  emoji,
  onPick,
}: {
  emoji: Emoji[];
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emoji.map((one) => (
        <button
          aria-label={one.label}
          className="grid size-8 place-items-center rounded-md text-lg hover:bg-accent"
          key={one.unicode}
          onClick={() => {
            onPick(one.unicode);
          }}
          title={one.label}
          type="button"
        >
          {one.unicode}
        </button>
      ))}
    </div>
  );
}

/**
 * Every emoji, browsable by category and searchable by name and by the words
 * a person would guess. With no query the grid is one scroll of every
 * category under a sticky heading, and the tabs along the top jump to one and
 * follow the scroll; a query replaces it with a flat list of matches.
 *
 * Above both sit the decision model's picks: for the query while there is
 * one, and otherwise for `context`, the name of the thing being marked.
 */
export function EmojiGrid({
  context,
  onPick,
}: {
  context?: string;
  onPick: (emoji: string) => void;
}) {
  const all = useEmojiSet();
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<Category["group"]>(0);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef(new Map<number, HTMLElement>());

  const byCategory = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        ...category,
        emoji: (all ?? []).filter((emoji) => emoji.group === category.group),
      })),
    [all],
  );

  const words = query.trim().toLowerCase();
  const about = words || context?.trim() || "";
  const related = useEmojiSuggestions(about, all);
  const relatedSection = about ? (
    <section aria-label="Related">
      <h3 className="truncate px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {words ? "Related" : `Suggested for “${about}”`}
      </h3>
      <RelatedRow onPick={onPick} related={related} />
    </section>
  ) : undefined;
  const matches = useMemo(() => {
    if (!words) {
      return [];
    }
    const found: Emoji[] = [];
    for (const emoji of all ?? []) {
      if (
        emoji.label.toLowerCase().includes(words) ||
        emoji.tags?.some((tag) => tag.includes(words))
      ) {
        found.push(emoji);
        if (found.length === SHOWN) {
          break;
        }
      }
    }
    return found;
  }, [all, words]);

  // The tab that is lit is the last category whose heading has reached the
  // top of the scroll, so it changes at the moment the sticky heading does.
  const followScroll = () => {
    const top = scroller.current?.scrollTop ?? 0;
    let reached: Category["group"] = CATEGORIES[0].group;
    for (const { group } of CATEGORIES) {
      const section = sections.current.get(group);
      if (section && section.offsetTop <= top + 1) {
        reached = group;
      }
    }
    setCurrent(reached);
  };

  const jumpTo = (group: Category["group"]) => {
    setQuery("");
    setCurrent(group);
    // After the query clears, the sections are back in the tree.
    requestAnimationFrame(() => {
      const section = sections.current.get(group);
      if (scroller.current && section) {
        scroller.current.scrollTop = section.offsetTop;
      }
    });
  };

  return (
    <div className="flex h-80 flex-col">
      <div className="p-2 pb-1">
        <Input
          autoFocus
          className="h-8"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search emoji"
          value={query}
        />
      </div>
      <div
        aria-label="Emoji categories"
        className="flex justify-between border-b px-2 pb-1"
        role="tablist"
      >
        {CATEGORIES.map((category) => (
          <button
            aria-label={category.label}
            aria-selected={!words && current === category.group}
            className={cn(
              "grid size-7 place-items-center rounded-md text-base grayscale transition hover:bg-accent hover:grayscale-0",
              !words && current === category.group && "bg-accent grayscale-0",
            )}
            key={category.group}
            onClick={() => {
              jumpTo(category.group);
            }}
            // A click leaves the caret in the search field, so typing after
            // a jump still searches.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            role="tab"
            title={category.label}
            type="button"
          >
            {category.icon}
          </button>
        ))}
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        onScroll={words ? undefined : followScroll}
        ref={scroller}
      >
        {all === undefined ? (
          <p className="p-2 text-xs text-muted-foreground">Loading…</p>
        ) : words ? (
          <>
            {relatedSection}
            <section aria-label="Matches">
              <h3 className="px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                Matches
              </h3>
              {matches.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  No emoji found.
                </p>
              ) : (
                <Cells emoji={matches} onPick={onPick} />
              )}
            </section>
          </>
        ) : (
          <>
            {relatedSection}
            {byCategory.map((category) => (
              <section
                aria-label={category.label}
                key={category.group}
                ref={(node) => {
                  if (node) {
                    sections.current.set(category.group, node);
                  } else {
                    sections.current.delete(category.group);
                  }
                }}
              >
                <h3 className="sticky top-0 z-10 bg-popover px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {category.label}
                </h3>
                <div
                  // Off-screen categories skip layout and paint until scrolled
                  // near, sized exactly so the scrollbar and the jump offsets
                  // are right before they are drawn.
                  style={{
                    containIntrinsicSize: `auto ${Math.ceil(category.emoji.length / COLUMNS) * ROW_HEIGHT}px`,
                    contentVisibility: "auto",
                  }}
                >
                  <Cells emoji={category.emoji} onPick={onPick} />
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The decision model's row, one grid row tall from the first keystroke
 * whatever it holds, so the matches under it never move when an answer lands.
 * Until the first answer it is empty cells; after that each answer replaces
 * the last in one fade rather than the row blanking in between.
 */
function RelatedRow({
  onPick,
  related,
}: {
  onPick: (emoji: string) => void;
  related: ReturnType<typeof useEmojiSuggestions>;
}) {
  const note = related.error
    ? "Suggestions are unavailable."
    : related.hasAnswer && related.suggestions.length === 0
      ? "Nothing close."
      : undefined;
  return (
    <div className="h-8">
      {note ? (
        <p
          className="flex h-full items-center px-1 text-xs text-muted-foreground"
          title={related.error?.message}
        >
          {note}
        </p>
      ) : related.hasAnswer ? (
        <div
          className="animate-in duration-200 fade-in-0"
          key={related.suggestions.map(({ emoji }) => emoji.unicode).join("")}
        >
          <Cells
            emoji={related.suggestions.map(({ emoji }) => emoji)}
            onPick={onPick}
          />
        </div>
      ) : (
        <div className="grid grid-cols-8 gap-0.5">
          {Array.from({ length: COLUMNS }, (_, index) => (
            <span className="m-1.5 size-5 rounded-md bg-muted/60" key={index} />
          ))}
        </div>
      )}
    </div>
  );
}

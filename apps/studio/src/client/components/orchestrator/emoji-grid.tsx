import { Input } from "@/client/components/ui/input";
import { useEffect, useMemo, useState } from "react";

/** One emoji as the grid needs it: what to draw, and the words that find it. */
interface Emoji {
  label: string;
  tags?: string[];
  unicode: string;
}

/** How many are drawn at once. A grid of every emoji is slower than it is useful. */
const SHOWN = 240;

/**
 * The set, loaded once and shared.
 *
 * Bundled rather than fetched: this is a desktop app, and an emoji picker that
 * needs the network is one that shows "Loading…" forever on a train. The
 * import is dynamic so the ~200KB rides in the chunk the picker opens with
 * rather than in the one the window starts with.
 */
let loaded: Emoji[] | undefined;
let loading: Promise<Emoji[]> | undefined;
/** Every emoji, searchable by name and by the words a person would guess. */
export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const [all, setAll] = useState<Emoji[] | undefined>(loaded);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (all) {
      return;
    }
    let live = true;
    void loadEmoji().then((list) => {
      if (live) {
        setAll(list);
      }
    });
    return () => {
      live = false;
    };
  }, [all]);

  const matches = useMemo(() => {
    const words = query.trim().toLowerCase();
    const list = all ?? [];
    if (!words) {
      return list.slice(0, SHOWN);
    }
    const found: Emoji[] = [];
    for (const emoji of list) {
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
  }, [all, query]);

  return (
    <div className="flex h-64 flex-col">
      <div className="p-2">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {all === undefined ? (
          <p className="p-2 text-xs text-muted-foreground">Loading…</p>
        ) : matches.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">No emoji found.</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {matches.map((emoji) => (
              <button
                aria-label={emoji.label}
                className="grid size-8 place-items-center rounded-md text-lg hover:bg-accent"
                key={emoji.unicode}
                onClick={() => {
                  onPick(emoji.unicode);
                }}
                title={emoji.label}
                type="button"
              >
                {emoji.unicode}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function loadEmoji(): Promise<Emoji[]> {
  loading ??= import("emojibase-data/en/compact.json").then((module) => {
    // Skin-tone bases and regional indicators are noise in a picker this size.
    loaded = (module.default as Emoji[]).filter(
      (emoji) => !emoji.label.startsWith("regional indicator"),
    );
    return loaded;
  });
  return loading;
}

import { useEffect, useState } from "react";

/** One emoji as the grid needs it: what to draw, and the words that find it. */
export interface Emoji {
  group?: number;
  label: string;
  order?: number;
  tags?: string[];
  unicode: string;
}

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

/** Every emoji, once the bundled set has loaded. */
export function useEmojiSet() {
  const [all, setAll] = useState<Emoji[] | undefined>(loaded);
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
  return all;
}

function loadEmoji(): Promise<Emoji[]> {
  loading ??= import("emojibase-data/en/compact.json").then((module) => {
    // Regional indicators carry no group and are noise in a picker this size.
    loaded = (module.default as Emoji[])
      .filter((emoji) => !emoji.label.startsWith("regional indicator"))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return loaded;
  });
  return loading;
}

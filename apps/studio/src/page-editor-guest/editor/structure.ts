/**
 * Moving, duplicating and deleting static elements as source splices. Each
 * element travels with the whitespace run before it, so indentation stays
 * right wherever it lands. The drag gesture runs on proxy boxes in the
 * editor's overlay (SortableJS does the pointer work); the page's own nodes
 * are reordered live as a preview, and the drop becomes one splice of the
 * file.
 */
import SortableJs from "sortablejs";

import {
  type Analysis,
  leadingWs,
  type PageSourceEntry,
  type Range,
} from "./source";

/**
 * How a splice moved offsets: the region [at, at + oldLen) became newLen
 * characters, made of the old pieces in `maps` (old offset, new offset,
 * length); anything else in it was removed or is new.
 */
export interface OffsetMap {
  at: number;
  maps: { len: number; n: number; o: number }[];
  newLen: number;
  oldLen: number;
}

/** A change to the file: `before` at `at` becomes `after`. */
export interface RawRegion {
  after: string;
  at: number;
  before: string;
}

/** An element's chunk: its leading whitespace through its end tag. */
const chunkOf = (src: string, entry: PageSourceEntry) => ({
  end: entry.loc.endOffset,
  start: leadingWs(src, entry.loc.startOffset),
  tagStart: entry.loc.startOffset,
});

export function deleteRegion(A: Analysis, entry: PageSourceEntry) {
  const c = chunkOf(A.src, entry);
  return {
    map: {
      at: c.start,
      maps: [],
      newLen: 0,
      oldLen: c.end - c.start,
    } satisfies OffsetMap,
    region: {
      after: "",
      at: c.start,
      before: A.src.slice(c.start, c.end),
    } satisfies RawRegion,
    removedRange: { end: c.end, start: c.tagStart } satisfies Range,
  };
}

/** Region that inserts a copy of the element right after it, ids removed from the copy. */
export function duplicateRegion(A: Analysis, entry: PageSourceEntry) {
  const src = A.src;
  const c = chunkOf(src, entry);
  let copy = src.slice(c.start, c.end);
  // Drop id attributes in the copy (a second element with the same id breaks anchors and scripts).
  const ids = A.entries
    .flatMap((e) => {
      const id = e.loc.attrs?.id;
      return e.loc.startOffset >= entry.loc.startOffset &&
        e.loc.endOffset <= entry.loc.endOffset &&
        id
        ? [id]
        : [];
    })
    .sort((a, b) => b.startOffset - a.startOffset);
  for (const r of ids) {
    const s = leadingWs(src, r.startOffset) - c.start;
    copy = copy.slice(0, s) + copy.slice(r.endOffset - c.start);
  }
  const before = src.slice(c.start, c.end);
  // The copy goes after the original, with the whitespace the original has
  // before it.
  const ws = src.slice(c.start, c.tagStart);
  const copyBody = copy.slice(ws.length);
  const after = before + ws + copyBody;
  const newAt = c.end + ws.length;
  return {
    copyRange: { end: newAt + copyBody.length, start: newAt } satisfies Range,
    map: {
      at: c.start,
      maps: [{ len: before.length, n: c.start, o: c.start }],
      newLen: after.length,
      oldLen: before.length,
    } satisfies OffsetMap,
    region: { after, at: c.start, before } satisfies RawRegion,
  };
}

/**
 * The region that moves `entries[from]` to index `to` among `entries`
 * (siblings in source order), and how it moves every offset inside it.
 */
export function moveRegion(
  src: string,
  entries: PageSourceEntry[],
  from: number,
  to: number,
): { map: OffsetMap; region: RawRegion } {
  const chunks = entries.map((e) => chunkOf(src, e));
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const chunk = (i: number) => {
    const c = chunks[i];
    if (!c) {
      throw new Error(`No sibling at ${i}`);
    }
    return c;
  };
  const start = chunk(lo).start;
  const end = chunk(hi).end;
  const pieces: { gap: string; i: number; text: string }[] = [];
  for (let i = lo; i <= hi; i++) {
    pieces.push({
      gap: i < hi ? src.slice(chunk(i).end, chunk(i + 1).start) : "",
      i,
      text: src.slice(chunk(i).start, chunk(i).end),
    });
  }
  const order = pieces.map((p) => p.i);
  order.splice(order.indexOf(from), 1);
  order.splice(to - lo, 0, from);
  let after = "";
  const maps: OffsetMap["maps"] = [];
  for (const [k, i] of order.entries()) {
    const text = pieces.find((x) => x.i === i)?.text ?? "";
    maps.push({ len: text.length, n: start + after.length, o: chunk(i).start });
    after += text;
    const g = pieces[k];
    if (g?.gap) {
      maps.push({
        len: g.gap.length,
        n: start + after.length,
        o: chunk(g.i).end,
      });
      after += g.gap;
    }
  }
  return {
    map: { at: start, maps, newLen: after.length, oldLen: end - start },
    region: { after, at: start, before: src.slice(start, end) },
  };
}

/** Old offset -> new offset through `m`, or null for text that is gone. */
export function offsetMapper(m: OffsetMap) {
  return (off: number) => {
    if (off < m.at) {
      return off;
    }
    if (off >= m.at + m.oldLen) {
      return off + m.newLen - m.oldLen;
    }
    const hit = m.maps.find((x) => x.o <= off && off < x.o + x.len);
    return hit ? hit.n + off - hit.o : null;
  };
}

/** The same map read backwards (new offsets -> old). */
export const invertMap = (m: OffsetMap): OffsetMap => ({
  at: m.at,
  maps: m.maps.map((x) => ({ len: x.len, n: x.o, o: x.n })),
  newLen: m.oldLen,
  oldLen: m.newLen,
});

export interface ReorderGesture {
  destroy: () => void;
  place: () => void;
}

/**
 * Reorder gesture for the selected element among its siblings. Proxy boxes sit
 * over each sibling in the overlay; only the selected one has a grip.
 * `onPreview(order)` reorders the live page while dragging, `onDrop(from, to)`
 * commits.
 */
export function reorderGesture<T>({
  gripHtml,
  host,
  items,
  onCancel,
  onDrop,
  onPreview,
  onStart,
  rectOf,
  selectedIndex,
  vertical,
}: {
  gripHtml: string;
  host: HTMLElement;
  items: T[];
  onCancel: () => void;
  onDrop: (from: number, to: number) => void;
  onPreview: (order: number[]) => void;
  onStart: () => void;
  rectOf: (item: T) => DOMRect | null;
  selectedIndex: number;
  vertical: boolean;
}): ReorderGesture {
  host.replaceChildren();
  for (const i of items.keys()) {
    const p = document.createElement("div");
    p.className = `proxy${i === selectedIndex ? " selected" : ""}`;
    p.dataset.i = String(i);
    if (i === selectedIndex) {
      const g = document.createElement("button");
      g.type = "button";
      g.className = `grip ${vertical ? "v" : "h"}`;
      g.title = "Drag to reorder (⌥↑ / ⌥↓)";
      g.innerHTML = gripHtml;
      p.append(g);
    }
    host.append(p);
  }
  const proxies = () =>
    [...host.children].filter((p) => p instanceof HTMLElement);
  const place = () => {
    for (const p of proxies()) {
      const item = items[Number(p.dataset.i)];
      const r = item === undefined ? null : rectOf(item);
      if (!r) {
        p.style.display = "none";
        continue;
      }
      p.style.display = "";
      p.style.left = `${r.left}px`;
      p.style.top = `${r.top}px`;
      p.style.width = `${r.width}px`;
      p.style.height = `${r.height}px`;
    }
  };
  place();
  const order = () => proxies().map((p) => Number(p.dataset.i));
  const sortable = SortableJs.create(host, {
    animation: 0,
    chosenClass: "proxy-chosen",
    direction: vertical ? "vertical" : "horizontal",
    draggable: ".proxy",
    fallbackClass: "proxy-ghost",
    fallbackOnBody: false,
    forceFallback: true,
    ghostClass: "proxy-placeholder",
    handle: ".grip",
    onChange: () => {
      onPreview(order());
      place();
    },
    onEnd: () => {
      host.classList.remove("dragging");
      const to = order().indexOf(selectedIndex);
      if (to === selectedIndex) {
        onCancel();
      } else {
        onDrop(selectedIndex, to);
      }
    },
    onStart: () => {
      host.classList.add("dragging");
      onStart();
    },
    scroll: false,
    swapThreshold: 0.6,
  });
  return {
    destroy() {
      sortable.destroy();
      host.replaceChildren();
    },
    place,
  };
}

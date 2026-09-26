// Moving, duplicating and deleting static elements as source splices. Each
// element travels with the whitespace run before it, so indentation stays right
// wherever it lands. The drag gesture runs on proxy boxes in the host overlay
// (SortableJS does the pointer work); the page's own nodes are reordered live
// as a preview, and the drop becomes one splice of the file.
import Sortable from "sortablejs";
import { leadingWs } from "./source.js";

/** An element's chunk: its leading whitespace through its end tag. */
export const chunkOf = (src, entry) => ({
  start: leadingWs(src, entry.loc.startOffset),
  tagStart: entry.loc.startOffset,
  end: entry.loc.endOffset,
});

/**
 * Region (for the undo stack) that moves `entries[from]` to index `to` among
 * `entries` (siblings in source order). Returns { region, movedAt } where
 * movedAt is the moved element's start offset in the new text.
 */
export function moveRegion(src, entries, from, to) {
  const chunks = entries.map((e) => chunkOf(src, e));
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const start = chunks[lo].start;
  const end = chunks[hi].end;
  const pieces = [];
  for (let i = lo; i <= hi; i++)
    pieces.push({
      i,
      text: src.slice(chunks[i].start, chunks[i].end),
      gap: i < hi ? src.slice(chunks[i].end, chunks[i + 1].start) : "",
    });
  const order = pieces.map((p) => p.i);
  order.splice(order.indexOf(from), 1);
  order.splice(to - lo, 0, from);
  let after = "";
  let movedAt = -1;
  const maps = [];
  order.forEach((i, k) => {
    const p = pieces.find((x) => x.i === i);
    if (i === from)
      movedAt = start + after.length + (chunks[i].tagStart - chunks[i].start);
    maps.push({
      o: chunks[i].start,
      n: start + after.length,
      len: p.text.length,
    });
    after += p.text;
    const g = pieces[k];
    if (g.gap)
      maps.push({
        o: chunks[g.i].end,
        n: start + after.length,
        len: g.gap.length,
      });
    after += g.gap;
  });
  return {
    region: { at: start, before: src.slice(start, end), after },
    movedAt,
    map: { at: start, oldLen: end - start, newLen: after.length, maps },
  };
}

/** Region that inserts a copy of the element right after it, ids removed from the copy. */
export function duplicateRegion(A, entry) {
  const src = A.src;
  const c = chunkOf(src, entry);
  let copy = src.slice(c.start, c.end);
  // Drop id attributes in the copy (a second element with the same id breaks anchors and scripts).
  const ids = A.entries
    .filter(
      (e) =>
        e.loc.startOffset >= entry.loc.startOffset &&
        e.loc.endOffset <= entry.loc.endOffset &&
        e.loc.attrs?.id,
    )
    .map((e) => e.loc.attrs.id)
    .sort((a, b) => b.startOffset - a.startOffset);
  for (const r of ids) {
    const s = leadingWs(src, r.startOffset) - c.start;
    copy = copy.slice(0, s) + copy.slice(r.endOffset - c.start);
  }
  const before = src.slice(c.start, c.end);
  const firstWs = src.slice(c.start, c.tagStart);
  // The copy goes after the original; if the original had no whitespace before
  // it (first child on the parent's line), borrow a newline + indent from the parent's layout.
  const ws = firstWs || "";
  const copyBody = copy.slice(firstWs.length);
  const after = before + ws + copyBody;
  const newAt = c.end + ws.length;
  return {
    region: { at: c.start, before, after },
    newAt,
    copyRange: { start: newAt, end: newAt + copyBody.length },
    map: {
      at: c.start,
      oldLen: before.length,
      newLen: after.length,
      maps: [{ o: c.start, n: c.start, len: before.length }],
    },
  };
}

export function deleteRegion(A, entry) {
  const c = chunkOf(A.src, entry);
  return {
    region: { at: c.start, before: A.src.slice(c.start, c.end), after: "" },
    removedRange: { start: c.tagStart, end: c.end },
    map: { at: c.start, oldLen: c.end - c.start, newLen: 0, maps: [] },
  };
}

/**
 * How a splice moved offsets: the region [at, at + oldLen) became
 * newLen characters, made of the old pieces in `maps` ({ o, n, len }: old
 * offset, new offset, length); anything else in it was removed or is new.
 * Returns old offset -> new offset, or null for text that is gone.
 */
export function offsetMapper(m) {
  return (off) => {
    if (off < m.at) return off;
    if (off >= m.at + m.oldLen) return off + m.newLen - m.oldLen;
    const hit = m.maps.find((x) => x.o <= off && off < x.o + x.len);
    return hit ? hit.n + off - hit.o : null;
  };
}

/** The same map read backwards (new offsets -> old). */
export const invertMap = (m) => ({
  at: m.at,
  oldLen: m.newLen,
  newLen: m.oldLen,
  maps: m.maps.map((x) => ({ o: x.n, n: x.o, len: x.len })),
});

/**
 * Reorder gesture for the selected element among its siblings. Proxy boxes sit
 * over each sibling in the host overlay; only the selected one has a grip.
 * `onPreview(order)` reorders the live page while dragging, `onDrop(from, to)`
 * commits. Returns { place(rects), destroy() }.
 */
export function reorderGesture({
  host,
  items,
  selectedIndex,
  rectOf,
  gripHtml,
  vertical,
  onStart,
  onPreview,
  onDrop,
  onCancel,
}) {
  host.replaceChildren();
  const proxies = items.map((it, i) => {
    const p = document.createElement("div");
    p.className = `proxy${i === selectedIndex ? " selected" : ""}`;
    p.dataset.i = i;
    if (i === selectedIndex) {
      const g = document.createElement("button");
      g.type = "button";
      g.className = `grip ${vertical ? "v" : "h"}`;
      g.title = "Drag to reorder (⌥↑ / ⌥↓)";
      g.innerHTML = gripHtml;
      p.append(g);
    }
    host.append(p);
    return p;
  });
  const place = () => {
    for (const p of host.children) {
      const r = rectOf(items[Number(p.dataset.i)]);
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
  const order = () => [...host.children].map((p) => Number(p.dataset.i));
  const sortable = Sortable.create(host, {
    handle: ".grip",
    draggable: ".proxy",
    forceFallback: true,
    fallbackOnBody: false,
    fallbackClass: "proxy-ghost",
    chosenClass: "proxy-chosen",
    ghostClass: "proxy-placeholder",
    animation: 0,
    scroll: false,
    swapThreshold: 0.6,
    direction: vertical ? "vertical" : "horizontal",
    onStart: () => {
      host.classList.add("dragging");
      onStart?.();
    },
    onChange: () => {
      onPreview(order());
      place();
    },
    onEnd: (e) => {
      host.classList.remove("dragging");
      const o = order();
      const to = o.indexOf(selectedIndex);
      if (to === selectedIndex) onCancel?.();
      else onDrop(selectedIndex, to);
      void e;
    },
  });
  return {
    place,
    proxies,
    destroy() {
      sortable.destroy();
      host.replaceChildren();
    },
  };
}

/**
 * Live patching: a direct edit changes the live page first and the file
 * second. The page's elements carry `data-src-id` ordinals of the file they
 * were loaded from; after a splice that adds, removes or moves elements,
 * those ordinals shift, so the live ids are renumbered from where each
 * element's source landed (an offset map from the splice) instead of
 * reloading the page. Anything that cannot be matched falls back to a reload.
 */
import { textBlockFor } from "./classify";
import {
  type Editor,
  type LiveApi,
  type LiveStep,
  type NewRoot,
  type WriteResult,
} from "./context";
import { type AppliedRegion, type Region } from "./regions";
import {
  type Analysis,
  innerRange,
  type PageSourceEntry,
  type Range,
  segments,
} from "./source";
import { type OffsetMap, offsetMapper } from "./structure";

/** Make `parent`'s children exactly `kids`, moving only the nodes that are out of place. */
function setChildren(parent: Element, kids: ChildNode[]) {
  const want = new Set(kids);
  // A copy: removing children from the live list while walking it skips some.
  const current = [...parent.childNodes];
  for (const n of current) {
    if (!want.has(n)) {
      n.remove();
    }
  }
  let ref = parent.firstChild;
  for (const n of kids) {
    if (n === ref) {
      ref = ref.nextSibling;
    } else if (ref) {
      ref.before(n);
    } else {
      parent.append(n);
    }
  }
}

/** Whether every region landed exactly where it was written, with nothing else in between. */
const exactlyPlaced = (res: WriteResult, regions: Region[]) =>
  res.ok &&
  !res.external &&
  regions.every((r) =>
    res.placed.applied.some((a) => a.at === r.at && a.before === r.before),
  );

export function createLive(ed: Editor): LiveApi {
  const { state, watch } = ed;

  /** Run a DOM change the page watch should not count as script activity. */
  function quietly(scope: Node, fn: () => void) {
    const was = watch.editing;
    watch.editing = scope;
    try {
      fn();
    } finally {
      watch.flush();
      watch.editing = was;
    }
  }

  function withAttributes(fn: () => void) {
    watch.applying = true;
    try {
      fn();
      watch.flush();
    } finally {
      watch.applying = false;
    }
  }

  /**
   * Renumber the live page's data-src-id after a splice described by `map`
   * (old offsets -> new). `roots` are new material: live elements matched in
   * order to the entries whose source starts in [start, end).
   */
  function restamp(prevA: Analysis, map: OffsetMap, roots: NewRoot[] = []) {
    const { A } = state;
    const f = offsetMapper(map);
    const fresh = new Set(roots.flatMap((r) => r.nodes));
    const plan: [Element, number][] = [];
    for (const el of document.querySelectorAll("[data-src-id]")) {
      if (fresh.has(el)) {
        continue;
      }
      const old = prevA.entries[Number(el.getAttribute("data-src-id"))];
      const at = old ? f(old.loc.startOffset) : null;
      const ne = at === null ? undefined : A.byStart.get(at);
      if (!old || !ne || ne.tag.toLowerCase() !== old.tag.toLowerCase()) {
        return false;
      }
      plan.push([el, ne.id]);
    }
    for (const r of roots) {
      const news = A.entries.filter(
        (e) => e.loc.startOffset >= r.start && e.loc.startOffset < r.end,
      );
      if (
        news.length !== r.nodes.length ||
        news.some(
          (e, i) => e.tag.toLowerCase() !== r.nodes[i]?.tagName.toLowerCase(),
        )
      ) {
        return false;
      }
      for (const [i, e] of news.entries()) {
        const node = r.nodes[i];
        if (node) {
          plan.push([node, e.id]);
        }
      }
    }
    for (const [el, id] of plan) {
      if (el.getAttribute("data-src-id") !== String(id)) {
        el.setAttribute("data-src-id", String(id));
      }
    }
    return true;
  }

  /**
   * Write regions for a change already made to the live page (`live`: the
   * parent's children before and after, the offset map, new-material roots).
   * Keeps the page as it is when the ids can be renumbered, else reloads it.
   */
  async function applyLive({
    key,
    label,
    live,
    regions,
  }: {
    key: string;
    label: string;
    live: LiveStep;
    regions: Region[];
  }) {
    const prevA = state.A;
    const res = await ed.history.write({ key, label, regions });
    if (!res.ok) {
      return res;
    }
    const ok =
      exactlyPlaced(res, regions) && restamp(prevA, live.map, live.fwdRoots());
    const top = state.undoStack.at(-1);
    if (ok && top) {
      top.live = live;
      ed.selection.verdictCacheReset();
    }
    if (!ok || live.reload) {
      await (ok
        ? ed.reload.reloadKeeping(state.src, ed.selection.selOffset())
        : ed.reload.reloadKeeping(res.prev, ed.selection.selOffsetIn(prevA)));
      return {
        ...res,
        how: ok
          ? "live, then reloaded for the page’s scripts"
          : "page reloaded",
      };
    }
    return { ...res, how: "live" };
  }

  /**
   * Renumber a text block's inner elements after its content changed from
   * `oi` (in the previous index) to `ni`; false when they do not match the
   * entries its new source writes.
   */
  function matchInner(prevA: Analysis, el: Element, oi: Range, ni: Range) {
    const map = {
      at: oi.start,
      maps: [],
      newLen: ni.end - ni.start,
      oldLen: oi.end - oi.start,
    };
    return restamp(prevA, map, [
      { end: ni.end, nodes: [...el.querySelectorAll("*")], start: ni.start },
    ]);
  }

  /** Rebuild a text block's content from the file, then renumber it. */
  function rebuildInner(prevA: Analysis, el: Element, oi: Range, ni: Range) {
    quietly(el, () => {
      el.innerHTML = state.A.src.slice(ni.start, ni.end);
    });
    return matchInner(prevA, el, oi, ni);
  }

  /**
   * Bring the live page in line with regions just written, without a reload:
   * attribute changes are copied onto the element, text changes go into its
   * text nodes, a <style> block gets its new text (the Tailwind build
   * recompiles it), and a text block whose inline markup changed is rebuilt
   * from the file. False when any region is something else (a script, a
   * structural change outside a text block): the caller reloads.
   */
  function patchLive(prevA: Analysis, applied: AppliedRegion[]) {
    const { A } = state;
    const sameCount = prevA.entries.length === A.entries.length;
    if (!sameCount && applied.length > 1) {
      return false;
    }
    for (const r of applied) {
      const a = r.atAfter + r.pre;
      const b = r.atAfter + r.after.length - r.post;
      const oldCore = r.before.slice(r.pre, r.before.length - r.post);
      const newCore = r.after.slice(r.pre, r.after.length - r.post);
      let e: null | PageSourceEntry = null;
      for (const x of A.entries) {
        if (x.loc.startOffset <= a && b <= x.loc.endOffset) {
          e = x;
        }
      }
      if (!e) {
        return false;
      }
      const el = document.querySelector(`[data-src-id="${e.id}"]`);
      const pe = prevA.byStart.get(e.loc.startOffset);
      if (!el || !pe || el.tagName.toLowerCase() !== e.tag.toLowerCase()) {
        return false;
      }
      const tag = e.loc.startTag;
      if (a >= tag.startOffset && b <= tag.endOffset) {
        if (!sameCount) {
          return false;
        }
        syncAttrs(el, pe, e);
        continue;
      }
      if (e.tag === "script") {
        return false;
      }
      if (e.tag === "style") {
        const inner = innerRange(e);
        if (inner) {
          quietly(el, () => {
            el.textContent = A.src.slice(inner.start, inner.end);
          });
        }
        continue;
      }
      const markup = /[<>]/.test(oldCore + newCore);
      if (sameCount && !markup) {
        if (!ed.text.restoreText(el, segments(A, e))) {
          return false;
        }
        continue;
      }
      // Inline markup changed inside a text block: rebuild its content from the file.
      const oi = innerRange(pe);
      const ni = innerRange(e);
      if (textBlockFor(el) !== el || !oi || !ni) {
        return false;
      }
      if (!matchInner(prevA, el, oi, ni) && !rebuildInner(prevA, el, oi, ni)) {
        return false;
      }
      // The ids line up, but the words may not: a region that spans the whole
      // element (a text edit's) changes only its text.
      if (
        el.textContent !== segments(A, e).text &&
        !ed.text.restoreText(el, segments(A, e)) &&
        !rebuildInner(prevA, el, oi, ni)
      ) {
        return false;
      }
    }
    ed.selection.verdictCacheReset();
    return true;
  }

  /** Copy the attributes that differ between two parses of the same start tag onto the live element. */
  function syncAttrs(el: Element, pe: PageSourceEntry, e: PageSourceEntry) {
    const before = new Map(pe.node.attrs.map((x) => [x.name, x.value]));
    const after = new Map(e.node.attrs.map((x) => [x.name, x.value]));
    withAttributes(() => {
      for (const k of before.keys()) {
        if (!after.has(k)) {
          el.removeAttribute(k);
        }
      }
      for (const [k, v] of after) {
        if (before.get(k) !== v) {
          el.setAttribute(k, v);
        }
      }
    });
  }

  return {
    applyLive,
    exactlyPlaced,
    patchLive,
    quietly,
    restamp,
    setChildren,
    withAttributes,
  };
}

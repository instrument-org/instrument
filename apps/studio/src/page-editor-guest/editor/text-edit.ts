/**
 * Editing an element's text in place: the rich editor (or plain
 * contenteditable where the markup is more than it can hold), then the
 * change turned into the smallest splices of the file's text nodes, or, when
 * formatting changed, one splice of the element's inner markup with the
 * source's whitespace and entities kept. The page shows the result at once;
 * the file is written behind it, and what cannot be written goes to the
 * agent as an ask.
 */
import { DIFF_DELETE, DIFF_INSERT, diffMain } from "diff-match-patch-es";

import { classify } from "./classify";
import { type Editor, type EditSession, type TextEditApi } from "./context";
import { find } from "./dom";
import { clip, collapse } from "./payload";
import { type Region, regionOf } from "./regions";
import { type CaretAt, mountRich, type RichResult } from "./richtext";
import {
  changedRanges,
  innerRange,
  keepWhitespace,
  segments,
  type Segments,
  type Splice,
  textSplices,
  trimmedSplice,
} from "./source";

/** What a finished edit changed. */
type EditResult = RichResult | { changed: true; marks: false; plain: string };

export function createTextEdit(ed: Editor): TextEditApi {
  const { state, ui, watch } = ed;

  function startEdit(el: HTMLElement, at: CaretAt) {
    const v = classify(state.A, el);
    if (!v.ok) {
      ed.asks.openAskFor(el);
      return;
    }
    if (state.editing) {
      commitEdit();
    }
    ed.asks.closeAsk();
    ed.image.closeImgPop();
    watch.editing = el;
    const inner = innerRange(v.entry);
    const srcInner = inner ? state.src.slice(inner.start, inner.end) : null;
    const display = getComputedStyle(el).display;
    let rich = null;
    if (srcInner !== null && !/grid|table/.test(display)) {
      rich = mountRich(el, srcInner, {
        at,
        layer: ui.layer,
        onDone: () => {
          commitEdit();
        },
      });
      if (rich) {
        rich.editor.view.dom.style.display = display.includes("flex")
          ? "flex"
          : display === "inline"
            ? "inline"
            : "block";
      }
    }
    if (!rich) {
      el.setAttribute("contenteditable", "plaintext-only");
      el.spellcheck = false;
      el.focus({ preventScroll: true });
      const d = el.ownerDocument;
      const r = at === "end" ? null : d.caretRangeFromPoint(at.x, at.y);
      const s = d.getSelection();
      s?.removeAllRanges();
      if (r && el.contains(r.startContainer)) {
        s?.addRange(r);
      } else {
        const range = d.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        s?.addRange(range);
      }
    }
    watch.flush();
    state.editing = {
      baseSrc: state.src,
      el,
      entry: v.entry,
      inner,
      oldText: el.textContent,
      rich,
      seg: v.seg,
      srcInner,
    };
    find(ui.hint, ".keys").innerHTML = rich
      ? "<kbd>⇧↵</kbd> new line <kbd>⌘B</kbd> <kbd>⌘I</kbd> <kbd>⌘K</kbd> <kbd>Esc</kbd> done"
      : "<kbd>↵</kbd> or <kbd>Esc</kbd> done";
    ui.hint.hidden = false;
    ed.selection.setHover(null);
    ed.toolbar.render();
    ed.status(
      `Editing ${state.info?.name.toLowerCase() ?? "text"}${rich ? "" : " (plain text: this markup keeps its structure)"}${state.pendingExternal ? " · agent changed the page" : ""}`,
    );
    ed.overlay.layout();
  }

  function commitEdit() {
    const E = state.editing;
    if (!E) {
      return;
    }
    state.editing = null;
    ui.hint.hidden = true;
    let result: EditResult;
    if (E.rich) {
      result = E.rich.result();
      E.rich.destroy();
    } else {
      E.el.removeAttribute("contenteditable");
      E.el.ownerDocument.getSelection()?.removeAllRanges();
      const t = E.el.textContent;
      result =
        t === E.oldText
          ? { changed: false }
          : { changed: true, marks: false, plain: t };
    }
    watch.flush();
    if (!result.changed) {
      if (!E.rich && !restoreText(E.el, E.seg)) {
        void ed.serial(() => ed.reload.reloadKeeping(state.src));
      }
      watch.editing = null;
      ed.reload.afterBusy();
      ed.toolbar.render();
      ed.overlay.layout();
      return;
    }
    const regionFor = (splices: Splice[]): Region =>
      regionOf(
        E.baseSrc,
        E.entry.loc.startOffset,
        E.entry.loc.endOffset,
        splices,
      );
    if (result.marks) {
      const html = result.html;
      const visibleAfter = collapse(
        new DOMParser().parseFromString(`<body>${html}`, "text/html").body
          .textContent,
      );
      E.newVisible = visibleAfter;
      const srcInner = E.srcInner ?? "";
      const neu = keepWhitespace(srcInner, restoreEntities(srcInner, html));
      const sp = trimmedSplice(srcInner, neu, E.inner?.start ?? 0);
      ed.live.quietly(E.el, () => {
        E.el.innerHTML = neu;
      });
      void ed.serial(() =>
        writeText(
          E,
          [regionFor([sp])],
          `Formatting · ${clip(collapse(visibleAfter), 40)}`,
          true,
          null,
        ),
      );
    } else {
      const newVisible =
        "plain" in result
          ? result.plain
          : transplant(E.seg.text, result.oldText, result.newText);
      E.newVisible = newVisible;
      const r = newVisible === null ? null : textSplices(E.seg, newVisible);
      if (!r) {
        watch.editing = null;
        ed.asks.toAgent(
          E,
          newVisible,
          "the change could not be mapped to the file",
        );
        return;
      }
      const splices = r.splices.filter(
        (sp) => E.baseSrc.slice(sp.start, sp.end) !== sp.text,
      );
      if (splices.length === 0) {
        restoreText(E.el, segments(state.A, E.entry));
        watch.editing = null;
        ed.reload.afterBusy();
        return;
      }
      const label = describe(E.oldText, r.written);
      // Show the result now; the file is written behind it.
      if (E.rich) {
        setTextValues(E.el, textAfter(E.seg, splices, E.baseSrc));
      }
      void ed.serial(() =>
        writeText(E, [regionFor(splices)], label, false, r.written),
      );
    }
    ed.toolbar.render();
    ed.overlay.layout();
  }

  async function writeText(
    E: EditSession,
    regions: Region[],
    label: string,
    reload: boolean,
    written: null | string,
  ) {
    const prevA = state.A;
    const res = await ed.history.write({
      key: `text:${E.entry.loc.startOffset}`,
      label,
      regions,
    });
    watch.editing = null;
    if (!res.ok) {
      ed.asks.toAgent(
        E,
        E.newVisible ?? E.el.textContent,
        "the agent changed this part of the page while you were typing",
      );
      return;
    }
    const at =
      (res.placed.applied[0]?.at ?? 0) +
      (E.entry.loc.startOffset - (regions[0]?.at ?? 0));
    const entry = state.A.byStart.get(at);
    if (
      !reload &&
      !res.external &&
      entry &&
      restoreText(E.el, segments(state.A, entry))
    ) {
      if (written !== null && segments(state.A, entry).text !== written) {
        ed.status(
          "Saved, but the file text differs from what you typed",
          "warn",
        );
      }
      if (state.sel === E.el) {
        ed.selection.select(E.el);
      }
    } else if (
      reload &&
      !res.external &&
      entry &&
      ed.live.patchLive(prevA, res.placed.applied)
    ) {
      if (state.sel === E.el) {
        ed.selection.select(E.el);
      }
    } else {
      await ed.reload.reloadWith({
        flash: res.external ? changedRanges(res.prev, state.src) : null,
        sel: entry ? at : null,
      });
    }
    ed.overlay.showToast(label, { undo: true });
    ed.status(
      `Saved ${label}${res.external ? " on top of the agent’s change" : ""}`,
      res.external ? "agent" : "",
    );
    ed.reload.afterBusy();
  }

  /** Write each source text node's value back into the live element; false if the shapes differ. */
  function restoreText(el: Element, seg: Segments) {
    return (
      setTextValues(
        el,
        seg.segs.map((g) => g.node.value),
      ) && el.textContent === seg.text
    );
  }

  /** Put `values` into the element's text nodes, in order; false if the counts differ. */
  function setTextValues(el: Element, values: string[]) {
    const live = textNodes(el);
    const ok = live.length === values.length;
    if (ok) {
      ed.live.quietly(el, () => {
        for (const [i, n] of live.entries()) {
          const value = values[i] ?? "";
          if (n.data !== value) {
            n.data = value;
          }
        }
      });
    }
    return ok;
  }

  return { commitEdit, restoreText, startEdit };
}

/** A short "old → new" for the toast. */
function describe(a: string, b: string) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) {
    s++;
  }
  let e = 0;
  while (
    e < a.length - s &&
    e < b.length - s &&
    a[a.length - 1 - e] === b[b.length - 1 - e]
  ) {
    e++;
  }
  const from = grow(a, s, a.length - e);
  const to = grow(b, s, b.length - e);
  return from
    ? to
      ? `“${clip(from, 28)}” → “${clip(to, 28)}”`
      : `Removed “${clip(from, 28)}”`
    : `Added “${clip(to, 28)}”`;
}

/** `t[from, to)` widened to whole words, whitespace collapsed. */
function grow(t: string, from: number, to: number) {
  let i = from;
  let j = to;
  while (i > 0 && /\S/.test(t[i - 1] ?? "")) {
    i--;
  }
  while (j < t.length && /\S/.test(t[j] ?? "")) {
    j++;
  }
  return collapse(t.slice(i, j));
}

/** `html` with the characters the source wrote as entities written as those entities again. */
function restoreEntities(srcInner: string, html: string) {
  const decoder = document.createElement("textarea");
  const ents = new Map<string, string>();
  for (const m of srcInner.matchAll(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi)) {
    decoder.innerHTML = m[0];
    const ch = decoder.value;
    if (ch.length === 1 && !'&<>" '.includes(ch)) {
      ents.set(ch, m[0]);
    }
  }
  let out = html
    .split(/(<[^>]*>)/)
    .map((part, i) => {
      if (i % 2) {
        return part;
      }
      let text = part;
      for (const [ch, e] of ents) {
        text = text.split(ch).join(e);
      }
      return text;
    })
    .join("");
  if (/<br\s*\/>/.test(srcInner)) {
    out = out.replaceAll("<br>", "<br />");
  }
  return out;
}

/** Each source text node's decoded value once `splices` are applied to `base`. */
function textAfter(seg: Segments, splices: Splice[], base: string) {
  const dec = document.createElement("textarea");
  return seg.segs.map((sg) => {
    let raw = base.slice(sg.start, sg.end);
    for (const sp of [...splices].sort((x, y) => y.start - x.start)) {
      if (sp.start >= sg.start && sp.end <= sg.end) {
        raw =
          raw.slice(0, sp.start - sg.start) +
          sp.text +
          raw.slice(sp.end - sg.start);
      }
    }
    dec.innerHTML = raw;
    return dec.value;
  });
}

/** The element's text nodes, in document order. */
function textNodes(el: Element) {
  const live: Text[] = [];
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n instanceof Text) {
      live.push(n);
    }
  }
  return live;
}

/** Map a change between two whitespace-collapsed strings onto the raw text they came from. */
function transplant(raw: string, a: string, b: string) {
  const map: number[] = [];
  let collapsed = "";
  let lastSpace = true;
  for (let i = 0; i < raw.length; i++) {
    // By UTF-16 unit, as the offsets into `raw` count.
    const ch = raw.charAt(i);
    if (/\s/.test(ch)) {
      if (lastSpace) {
        continue;
      }
      collapsed += " ";
      map.push(i);
      lastSpace = true;
    } else {
      collapsed += ch;
      map.push(i);
      lastSpace = false;
    }
  }
  if (collapsed.endsWith(" ")) {
    collapsed = collapsed.slice(0, -1);
    map.pop();
  }
  if (collapsed !== a) {
    return null;
  }
  const diffs = diffMain(a, b);
  let out = "";
  let rawPos = 0;
  let ap = 0;
  const rawEnd = (map.at(-1) ?? -1) + 1;
  const rawAt = (p: number) => (p < map.length ? (map[p] ?? rawEnd) : rawEnd);
  for (const [op, s] of diffs) {
    if (op === DIFF_INSERT) {
      const at = rawAt(ap);
      out += raw.slice(rawPos, at) + s;
      rawPos = at;
    } else if (op === DIFF_DELETE) {
      const from = rawAt(ap);
      const to = rawAt(ap + s.length);
      out += raw.slice(rawPos, from);
      rawPos = Math.max(from, to);
      ap += s.length;
    } else {
      ap += s.length;
    }
  }
  return out + raw.slice(rawPos);
}

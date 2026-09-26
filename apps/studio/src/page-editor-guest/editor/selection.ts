/**
 * What is hovered and selected: which element a pointer means, what the
 * editor may do to it, the hover label, and finding the selection again
 * after the file changes (by its start tag's offset).
 */
import {
  type Blocked,
  classify,
  kindName,
  REASONS,
  staticEntry,
  structureVerdict,
  styleVerdict,
  textBlockFor,
} from "./classify";
import {
  type Editor,
  type ElementKind,
  type Inspection,
  type QuickVerdict,
  type SelectionApi,
} from "./context";
import { esc, find } from "./dom";
import { UI_ICONS } from "./icons";
import { type Analysis } from "./source";
import { closePalette } from "./style-panel";

const kindOf = (el: Element): ElementKind =>
  el.tagName === "IMG" ? "image" : textBlockFor(el) === el ? "text" : "box";

export function createSelection(ed: Editor): SelectionApi {
  const { state, ui } = ed;
  let sizeWatch: null | ResizeObserver = null;

  /** Cheap verdict for hover: what the element is and whether it is ours to change. */
  function quick(el: HTMLElement): QuickVerdict {
    const cached = state.verdictCache.get(el);
    if (cached) {
      return cached;
    }
    const kind = kindOf(el);
    let blocked = null;
    if (kind === "text") {
      const v = classify(state.A, el);
      if (!v.ok && v.reason !== "markup") {
        blocked = v.reason;
      }
    }
    if (!blocked) {
      const s = styleVerdict(state.A, el);
      if (!s.ok) {
        blocked = s.reason;
      }
    }
    const out = { blocked, kind, name: kindName(el) };
    state.verdictCache.set(el, out);
    return out;
  }

  /** Everything the toolbar and panel need about an element. */
  function inspect(el: Element): Inspection {
    const { A } = state;
    const kind = kindOf(el);
    const style = styleVerdict(A, el);
    const text = kind === "text" ? classify(A, el) : null;
    const struct = structureVerdict(A, el);
    let blocked: Blocked | null = null;
    if (text && !text.ok && text.reason !== "markup") {
      blocked = text;
    }
    if (!blocked && !style.ok) {
      blocked = style;
    }
    const imageOk =
      kind === "image" && style.ok && !!style.entry.loc.attrs?.src;
    return {
      blocked,
      entry: style.entry ?? text?.entry ?? null,
      imageOk,
      kind,
      name: kindName(el),
      struct,
      style,
      styleOk: style.ok,
      textOk: !!text?.ok,
    };
  }

  function onHover(t: EventTarget | null) {
    const { editing } = state;
    if (
      editing &&
      t instanceof Node &&
      (editing.el === t || editing.el.contains(t))
    ) {
      setHover(null);
      return;
    }
    const el = pickTarget(t);
    if (el === state.hoverEl) {
      return;
    }
    if (!el || el === state.sel) {
      setHover(null);
      return;
    }
    const q = quick(el);
    if (q.blocked) {
      setHover(el, "refuse", REASONS[q.blocked], "ask");
    } else {
      setHover(el, "edit", q.name);
    }
  }

  function setHover(
    el: HTMLElement | null,
    kind?: "edit" | "refuse",
    label?: string,
    sub?: string,
  ) {
    state.hoverEl = el;
    ui.hoverBox.hidden = !el;
    if (!el) {
      return;
    }
    ui.hoverBox.className = `box ${kind ?? ""}`;
    find(ui.hoverBox, ".tag").innerHTML = label
      ? `${kind === "refuse" ? UI_ICONS.lock : ""}<span>${esc(label)}</span>${sub ? `<em>${esc(sub)}</em>` : ""}`
      : "";
    ed.overlay.layout();
  }

  function onClick(e: MouseEvent) {
    if (state.dragging) {
      return;
    }
    if (state.editing) {
      ed.text.commitEdit();
    }
    const el = pickTarget(e.target);
    if (el === state.sel && el) {
      return;
    }
    select(el);
  }

  function onDblClick(e: MouseEvent) {
    const el = pickTarget(e.target);
    if (!el) {
      return;
    }
    if (el !== state.sel) {
      select(el);
    }
    const { info } = state;
    if (!info) {
      return;
    }
    if (info.kind === "text" && info.textOk) {
      ed.text.startEdit(el, { select: true, x: e.clientX, y: e.clientY });
    } else if (info.kind === "image" && info.imageOk) {
      ed.image.openImgPop();
    } else if (info.blocked) {
      ed.asks.openAskFor(el);
    }
  }

  function select(el: HTMLElement | null) {
    if (state.editing && state.editing.el !== el) {
      ed.text.commitEdit();
    }
    ed.asks.closeAsk();
    closePalette();
    ed.image.closeImgPop();
    ed.style.clearPreview();
    const sel = el?.isConnected ? el : null;
    state.sel = sel;
    state.info = sel ? inspect(sel) : null;
    state.probe = null;
    if (sel && state.info?.styleOk) {
      ed.style.startProbe(sel);
    }
    ed.structure.setupGesture();
    setHover(null);
    ui.dockHint.hidden = !!sel;
    watchSize();
    ed.toolbar.render();
    if (state.panelMode === "style") {
      ed.style.renderInspector();
    }
    ed.overlay.layout();
  }

  /** Select the nearest ancestor; with none left, clear the selection. */
  function selectParent() {
    if (!state.sel) {
      return;
    }
    select(ancestors(state.sel)[0] ?? null);
  }

  /** Re-find the selection after the file changed, from its start offset. */
  function reselectAt(offset: null | number) {
    if (offset === null) {
      select(null);
      return;
    }
    const entry = state.A.byStart.get(offset);
    const el = entry
      ? document.querySelector(`[data-src-id="${entry.id}"]`)
      : null;
    select(el instanceof HTMLElement ? el : null);
  }

  const selOffset = () => {
    if (!state.sel) {
      return null;
    }
    const s = staticEntry(state.A, state.sel);
    return s.entry?.loc.startOffset ?? null;
  };

  /** The selection's source offset, read against an earlier index. */
  function selOffsetIn(prevA: Analysis) {
    const id = state.sel?.getAttribute("data-src-id");
    const e = id == null ? undefined : prevA.entries[Number(id)];
    return e ? e.loc.startOffset : null;
  }

  function verdictCacheReset() {
    // WeakMap entries die with their elements; clear what the current page holds.
    for (const el of document.querySelectorAll("[data-src-id]")) {
      state.verdictCache.delete(el);
    }
  }

  function watchSize() {
    if (!sizeWatch) {
      return;
    }
    sizeWatch.disconnect();
    sizeWatch.observe(document.body);
    const el = state.editing?.el ?? state.sel;
    if (el?.isConnected) {
      sizeWatch.observe(el);
    }
  }

  /**
   * The outline follows the selection as it grows or shrinks (typing, a style
   * change, an image loading) and as the page reflows around it.
   */
  function init() {
    sizeWatch = new ResizeObserver(() => {
      ed.overlay.layout();
    });
    watchSize();
  }

  return {
    ancestors,
    init,
    inspect,
    onClick,
    onDblClick,
    onHover,
    quick,
    reselectAt,
    select,
    selectParent,
    selOffset,
    selOffsetIn,
    setHover,
    verdictCacheReset,
    watchSize,
  };
}

/**
 * The selection's ancestors worth selecting, nearest first: every element up
 * to <body>, skipping wrappers that draw exactly the same box as the element
 * inside them (selecting one would look like nothing happened).
 */
function ancestors(el: Element) {
  const out: HTMLElement[] = [];
  let prev = el.getBoundingClientRect();
  for (
    let p = el.parentElement;
    p && p.tagName !== "BODY" && p.tagName !== "HTML";
    p = p.parentElement
  ) {
    const r = p.getBoundingClientRect();
    const same =
      Math.abs(r.left - prev.left) < 1 &&
      Math.abs(r.top - prev.top) < 1 &&
      Math.abs(r.width - prev.width) < 1 &&
      Math.abs(r.height - prev.height) < 1;
    prev = r;
    if (same || !r.width || !r.height) {
      continue;
    }
    out.push(p);
  }
  return out;
}

function pickTarget(target: EventTarget | null): HTMLElement | null {
  let t: Element | null = target instanceof Element ? target : null;
  if (!t) {
    return null;
  }
  if (t.closest("[data-editor-guest]")) {
    return null;
  }
  if (t.tagName === "HTML" || t.tagName === "BODY") {
    return null;
  }
  if (t.tagName === "IMG") {
    return t instanceof HTMLElement ? t : null;
  }
  const svg = t.closest("svg");
  if (svg) {
    t = svg.parentElement ?? svg;
  }
  const block = textBlockFor(t);
  if (block) {
    return block instanceof HTMLElement ? block : null;
  }
  if (t.tagName === "I" && !/\S/.test(t.textContent)) {
    t = t.parentElement;
  }
  if (!t || t.tagName === "BODY" || t.tagName === "HTML") {
    return null;
  }
  return t instanceof HTMLElement ? t : null;
}

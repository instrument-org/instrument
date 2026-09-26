// Edit in place v2: one Edit mode over the page, like a design tool. Click
// selects an element and a floating toolbar offers what can be done to it:
// edit its text (Tiptap, with a bubble menu), style it (Tailwind classes bound
// to the page's theme tokens), replace an image, move, duplicate or delete it,
// or ask the agent. Script-made and data-backed elements offer only the ask,
// with the reason. Every direct edit is a minimal splice of the file on disk,
// kept on an undo stack; the agent's own edits reload the page in place.
//
// Runs in the guest's isolated world, over the page itself: its UI lives in a
// shadow root on the page, and it talks to the window through the preload's
// bridge (saves, asks, reloads), never to the disk or the page's scripts.
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { DIFF_DELETE, DIFF_INSERT, diffMain } from "diff-match-patch-es";
import { twMerge } from "tailwind-merge";
import {
  REASONS,
  classify,
  kindName,
  measure,
  staticAncestor,
  staticEntry,
  structureVerdict,
  styleVerdict,
  textBlockFor,
} from "./classify.js";
import { buildRequest } from "./payload.js";
import { mountRich } from "./richtext.js";
import {
  analyze,
  changedRanges,
  classAttr,
  classSplice,
  findNearest,
  innerRange,
  keepWhitespace,
  mapOffset,
  segments,
  textSplices,
  trimmedSplice,
} from "./source.js";
import {
  previewText,
  readPage,
  renderPagePanel,
  tokenSplices,
} from "./page-panel.js";
import {
  deleteRegion,
  duplicateRegion,
  invertMap,
  moveRegion,
  offsetMapper,
  reorderGesture,
} from "./structure.js";
import { loadFonts } from "./fonts.js";
import { icon, mark } from "./icons.js";
import { closePalette, probeClasses, renderStylePanel } from "./style-panel.js";
import { readTheme, resolveColors } from "./tokens.js";
import CSS from "./style.css?inline";
import { UI_HTML } from "./ui-html.js";

export async function startEditor(bridge) {
  const boot = bridge.boot;
  const path = boot.name;
  // The editor's own UI: one element on the page, its contents in a shadow root
  // the page's styles do not reach.
  const uiHost = document.createElement("instrument-page-editor");
  uiHost.setAttribute("data-editor-guest", "");
  uiHost.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;";
  loadFonts();
  const shadow = uiHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${CSS}</style>${UI_HTML}`;
  const ui = shadow.getElementById("ui");
  const $ = (s, root = shadow) => root.querySelector(s);
  const isOurs = (e) => e.composedPath().includes(uiHost);
  const bar = {
    status(message, kind) {
      bridge.send({ type: "status", message, kind: kind ?? null });
    },
  };
  const hoverBox = $("#hover");
  const selBox = $("#selbox");
  const proxiesEl = $("#proxies");
  const pinsEl = $("#pins");
  const flashesEl = $("#flashes");
  const layer = $("#float-layer");
  const tb = $("#tb");
  const hint = $("#edit-hint");
  const pill = $("#agent-pill");
  const pop = $("#popover");
  const imgPop = $("#img-pop");
  const inspector = $("#inspector");
  const panel = $("#panel");
  const toast = $("#toast");
  const dockHint = $("#dock-hint");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const collapse = (s) => s.replace(/\s+/g, " ").trim();
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  const I = {
    chevron: icon("caretDown", 10),
    lock: icon("lock", 12),
    edit: icon("pencil", 14),
    style: icon("sliders", 14),
    image: icon("image", 14),
    dup: icon("copy", 14),
    trash: icon("trash", 14),
    ask: mark(14),
    grip: icon("grip", 14),
    close: icon("x", 14),
  };

  let doc; // openDoc handle; doc.content is the last text known on disk
  let src = ""; // the text the iframe and index describe
  let A; // analyze(src)
  let theme;
  let colors = new Map();
  let placement = "row";
  let mode = "view";
  let hoverEl = null;
  let sel = null; // selected element in the page
  let info = null; // inspect(sel)
  let editing = null; // { el, entry, seg, baseSrc, oldText, rich, srcInner }
  let asking = null; // { el, verdict, edit, change }
  let panelMode = null; // 'style' | 'requests' | null
  let probe = null; // { el, promise, blocked }
  let gesture = null;
  let preview = null; // { el, prop, saved }
  let pendingExternal = false;
  let dragging = false;
  const undoStack = [];
  const redoStack = [];
  const requests = [];
  let nextN = 1;
  let flashes = []; // { el, until, self }
  const verdictCache = new WeakMap();

  let chain = Promise.resolve();
  const serial = (fn) =>
    (chain = chain
      .then(fn, fn)
      .catch(
        (e) => (console.error(e), bar.status(`Error: ${e.message}`, "warn")),
      ));

  // ---------------------------------------------------------------- frame

  // Every reload is the window's: the page is loaded again from the file with
  // ids stamped on it, and this world goes with it. What must survive (the undo
  // stack, the requests, the selection, the scroll) is handed over first, and
  // comes back in the boot of the next one.
  function mount({
    keepScroll = true,
    sel: selAt = null,
    flash = null,
    flashSelf = false,
    agent = false,
  } = {}) {
    bridge.send({
      type: "reload",
      text: src,
      state: snapshot({ keepScroll, selAt, flash, flashSelf, agent }),
    });
    return new Promise(() => {});
  }

  function snapshot({ keepScroll, selAt, flash, flashSelf, agent }) {
    const plainRegions = (list) =>
      list.map(({ at, atAfter, before, after, pre, post }) => ({
        at,
        atAfter,
        before,
        after,
        pre,
        post,
      }));
    const plainOp = (op) => ({
      label: op.label,
      key: op.key,
      time: op.time,
      regions: plainRegions(op.regions),
    });
    return {
      placement,
      doc: {
        content: doc.content,
        version: doc.version,
        original: doc.original,
      },
      undo: undoStack.map(plainOp),
      redo: redoStack.map(plainOp),
      requests: requests.map((r) => ({
        n: r.n,
        kind: r.kind,
        instruction: r.instruction,
        edit: r.edit,
        change: r.change,
        payload: r.payload,
      })),
      nextN,
      scroll: keepScroll ? { x: scrollX, y: scrollY } : null,
      sel: selAt,
      flash,
      flashSelf,
      agent,
      panel: panelMode === "style" && !sel ? "page" : panelMode,
    };
  }

  const fdoc = () => document;
  const fwin = () => window;
  const guest = () => window.__srcEdit;
  const cs = (el) => el.ownerDocument.defaultView.getComputedStyle(el);
  const colorNames = () => [
    ...theme.semantic,
    ...theme.ramps.flatMap((r) => r.steps),
  ];

  function wire() {
    const d = document;
    const w = window;
    const style = d.createElement("style");
    style.setAttribute("data-editor-guest", "");
    style.textContent = `
    html[data-editor-mode=edit] body *{cursor:default!important}
    html[data-editor-mode=edit] .editor-guest-pm, html[data-editor-mode=edit] .editor-guest-pm *, html[data-editor-mode=edit] [contenteditable]{cursor:text!important}
    .editor-guest-pm{outline:none;white-space:pre-wrap;word-wrap:break-word;flex-direction:inherit;flex-wrap:inherit;align-items:inherit;justify-content:inherit;gap:inherit;text-align:inherit;min-width:0}
    .editor-guest-pm ::selection, [contenteditable] ::selection{background:rgb(13 153 255 / .28)}
    [contenteditable]{outline:none}`;
    (d.head ?? d.documentElement).append(style);

    const inEditor = (t) =>
      editing && (editing.el === t || editing.el.contains(t));
    d.addEventListener(
      "mousemove",
      (e) =>
        mode === "edit" &&
        !dragging &&
        (isOurs(e) ? setHover(null) : onHover(e.target)),
      true,
    );
    d.documentElement.addEventListener("mouseleave", () => setHover(null));
    for (const type of [
      "mousedown",
      "mouseup",
      "pointerdown",
      "pointerup",
      "contextmenu",
      "submit",
      "auxclick",
    ]) {
      d.addEventListener(
        type,
        (e) => {
          if (mode === "view") return;
          if (isOurs(e) || inEditor(e.target)) return;
          e.stopImmediatePropagation();
          e.preventDefault();
        },
        true,
      );
    }
    d.addEventListener(
      "click",
      (e) => {
        if (mode === "view") return;
        if (isOurs(e) || inEditor(e.target)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        onClick(e);
      },
      true,
    );
    d.addEventListener(
      "dblclick",
      (e) => {
        if (mode === "view") return;
        if (isOurs(e) || inEditor(e.target)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        onDblClick(e);
      },
      true,
    );
    d.addEventListener(
      "keydown",
      (e) => {
        if (editing && inEditor(e.target)) {
          if (!editing.rich) {
            e.stopImmediatePropagation();
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              commitEdit();
            }
          }
          return;
        }
        if (mode === "edit" && !isOurs(e)) e.stopImmediatePropagation();
        hostKeys(e);
      },
      true,
    );
    w.addEventListener("scroll", layout, { passive: true, capture: true });
    w.addEventListener("resize", layout);
    // The outline follows the selection as it grows or shrinks (typing, a style
    // change, an image loading) and as the page reflows around it.
    sizeWatch = new w.ResizeObserver(() => layout());
    watchSize();
  }

  let sizeWatch = null;
  function watchSize() {
    if (!sizeWatch) return;
    sizeWatch.disconnect();
    sizeWatch.observe(fdoc().body);
    const el = editing?.el ?? sel;
    if (el?.isConnected) sizeWatch.observe(el);
  }

  function applyModeToFrame() {
    const html = fdoc().documentElement;
    if (mode === "view") html.removeAttribute("data-editor-mode");
    else html.setAttribute("data-editor-mode", mode);
  }

  // ---------------------------------------------------------------- modes

  function setMode(next) {
    if (editing) commitEdit();
    closeAsk();
    select(null);
    mode = next;
    $("#page-btn").hidden = mode !== "edit";
    ui.classList.toggle("editing-mode", mode === "edit");
    if (mode === "view" && panelMode === "style") setPanel(null);
    setHover(null);
    applyModeToFrame();
    dockHint.hidden = mode !== "edit";
    layout();
  }

  function hostKeys(e) {
    const t = e.composedPath()[0];
    const inField = t.closest?.(
      "input,textarea,[contenteditable],hex-color-picker",
    );
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !inField && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (inField) return;
    if (mod && e.key.toLowerCase() === "d" && sel && mode === "edit") {
      e.preventDefault();
      return structureOp("duplicate");
    }
    if (mod && e.key === "ArrowUp" && sel && mode === "edit") {
      e.preventDefault();
      return selectParent();
    }
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key;
    if (k === "Escape") {
      if (asking) closeAsk();
      else if (!imgPop.hidden) closeImgPop();
      else if (!crumbs.hidden) hideCrumbs();
      else if (sel) selectParent();
      else if (panelMode) setPanel(null);
      else leave();
      return;
    }
    if (mode === "edit" && sel) {
      if (k === "Enter") {
        e.preventDefault();
        if (e.shiftKey) return selectParent();
        if (info.kind === "text" && info.textOk) return startEdit(sel, "end");
        if (info.kind === "image" && info.imageOk) return openImgPop();
        return;
      }
      if (k === "Backspace" || k === "Delete") {
        e.preventDefault();
        return structureOp("delete");
      }
      if (
        e.altKey &&
        (k === "ArrowUp" ||
          k === "ArrowDown" ||
          k === "ArrowLeft" ||
          k === "ArrowRight")
      ) {
        e.preventDefault();
        return nudge(k === "ArrowUp" || k === "ArrowLeft" ? -1 : 1);
      }
    }
  }

  /** Done: finish what is in hand, let the writes land, then ask the window for the page as it is. */
  function leave() {
    if (editing) commitEdit();
    serial(async () => {
      bridge.send({ type: "leave" });
    });
  }

  // ---------------------------------------------------------------- targets + hover

  function pickTarget(t) {
    if (!t || t.nodeType !== 1) return null;
    if (t.closest("[data-editor-guest]")) return null;
    if (t.tagName === "HTML" || t.tagName === "BODY") return null;
    if (t.tagName === "IMG") return t;
    const svg = t.closest("svg");
    if (svg) t = svg.parentElement ?? svg;
    const block = textBlockFor(t);
    if (block) return block;
    if (t.tagName === "I" && !/\S/.test(t.textContent)) t = t.parentElement;
    if (!t || t.tagName === "BODY" || t.tagName === "HTML") return null;
    return t;
  }

  /** Cheap verdict for hover: what the element is and whether it is ours to change. */
  function quick(el) {
    if (verdictCache.has(el)) return verdictCache.get(el);
    const kind =
      el.tagName === "IMG" ? "image" : textBlockFor(el) === el ? "text" : "box";
    let blocked = null;
    if (kind === "text") {
      const v = classify(A, el);
      if (!v.ok && v.reason !== "markup") blocked = v.reason;
    }
    if (!blocked) {
      const s = styleVerdict(A, el);
      if (!s.ok) blocked = s.reason;
    }
    const out = { kind, blocked, name: kindName(el) };
    verdictCache.set(el, out);
    return out;
  }

  /** Everything the toolbar and panel need about an element. */
  function inspect(el) {
    const kind =
      el.tagName === "IMG" ? "image" : textBlockFor(el) === el ? "text" : "box";
    const style = styleVerdict(A, el);
    const text = kind === "text" ? classify(A, el) : null;
    const struct = structureVerdict(A, el);
    let blocked = null;
    if (text && !text.ok && text.reason !== "markup") blocked = text;
    if (!blocked && !style.ok) blocked = style;
    const imageOk =
      kind === "image" && style.ok && !!style.entry.loc.attrs?.src;
    return {
      kind,
      name: kindName(el),
      style,
      styleOk: style.ok,
      text,
      textOk: !!text?.ok,
      struct,
      blocked,
      imageOk,
      entry: style.entry ?? text?.entry ?? null,
    };
  }

  function onHover(t) {
    if (editing && (editing.el === t || editing.el.contains(t)))
      return setHover(null);
    const el = pickTarget(t);
    if (el === hoverEl) return;
    if (!el || el === sel) return setHover(el === sel ? null : null);
    const q = quick(el);
    if (q.blocked) setHover(el, "refuse", REASONS[q.blocked], "ask Instrument");
    else setHover(el, "edit", q.name);
  }

  function setHover(el, kind, label, sub) {
    hoverEl = el;
    hoverBox.hidden = !el;
    if (!el) return;
    hoverBox.className = `box ${kind}`;
    hoverBox.querySelector(".tag").innerHTML = label
      ? `${kind === "refuse" ? I.lock : ""}<span>${esc(label)}</span>${sub ? `<em>${esc(sub)}</em>` : ""}`
      : "";
    layout();
  }

  function onClick(e) {
    if (dragging) return;
    const t = e.target;
    if (editing) commitEdit();
    const el = pickTarget(t);
    if (el === sel && el) return;
    select(el);
  }

  function onDblClick(e) {
    const el = pickTarget(e.target);
    if (!el) return;
    if (el !== sel) select(el);
    if (info.kind === "text" && info.textOk)
      startEdit(el, { x: e.clientX, y: e.clientY, select: true });
    else if (info.kind === "image" && info.imageOk) openImgPop();
    else if (info.blocked) openAskFor(el);
  }

  // ---------------------------------------------------------------- selection

  function select(el) {
    if (editing && editing.el !== el) commitEdit();
    closeAsk();
    closePalette();
    closeImgPop();
    clearPreview();
    sel = el && el.isConnected ? el : null;
    info = sel ? inspect(sel) : null;
    probe = null;
    if (sel && info.styleOk) startProbe(sel);
    setupGesture();
    setHover(null);
    dockHint.hidden = mode !== "edit" || !!sel;
    watchSize();
    renderToolbar();
    if (panelMode === "style") renderInspector();
    layout();
  }

  /**
   * The selection's ancestors worth selecting, nearest first: every element up
   * to <body>, skipping wrappers that draw exactly the same box as the element
   * inside them (selecting one would look like nothing happened).
   */
  function ancestors(el) {
    const out = [];
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
      if (same || !r.width || !r.height) continue;
      out.push(p);
    }
    return out;
  }

  /** Select the nearest ancestor; with none left, clear the selection. */
  function selectParent() {
    if (!sel) return;
    select(ancestors(sel)[0] ?? null);
  }

  /** Re-find the selection after the file changed, from its start offset. */
  function reselectAt(offset) {
    if (offset == null) return select(null);
    const entry = A.byStart.get(offset);
    const el = entry
      ? fdoc().querySelector(`[data-src-id="${entry.id}"]`)
      : null;
    select(el);
  }

  const selOffset = () =>
    sel ? (staticEntry(A, sel).entry?.loc.startOffset ?? null) : null;

  // ---------------------------------------------------------------- toolbar

  const STRUCT_WHY = {
    generated: () => "A script makes this, so it is not in the file.",
    copied: () => "A script copies this from a template.",
    changed: () => "A script changes this part of the page after it loads.",
    "script-reads": (v, verb) =>
      `A script uses ${v.detail ?? "it"}, so ${verb} it could break the page.`,
    data: () => "Its text is also in the page’s data.",
    root: () => "This holds the whole page.",
  };

  /** Why duplicate or delete is off for this element, in one short line. */
  function structWhy(v, act) {
    return (
      STRUCT_WHY[v.reason]?.(v, act === "duplicate" ? "copying" : "removing") ??
      REASONS[v.reason] ??
      ""
    );
  }

  function renderToolbar() {
    hideCrumbs();
    hideTip();
    if (!sel || mode !== "edit" || editing || dragging) {
      tb.hidden = true;
      return;
    }
    const i = info;
    let html = `<button type="button" class="tb-name" data-act="crumbs" data-tip="Select a parent · Esc or ⌘↑">${esc(i.name)}${I.chevron}</button>`;
    if (i.blocked) {
      html += `<span class="tb-reason">${I.lock}${esc(REASONS[i.blocked.reason])}</span>`;
      html += `<button type="button" class="tb-ask solo" data-act="ask" data-tip="${esc(noteFor(i.blocked))}">${I.ask}<span>Ask Instrument</span></button>`;
    } else {
      html += '<span class="tb-sep"></span>';
      if (i.kind === "text" && i.textOk)
        html += `<button type="button" data-act="edit" data-tip="Edit text · double-click or ↵">${I.edit}<span>Edit</span></button>`;
      if (i.kind === "image" && i.imageOk)
        html += `<button type="button" data-act="replace" data-tip="Replace image">${I.image}<span>Replace</span></button>`;
      html += `<button type="button" data-act="style" class="${panelMode === "style" ? "on" : ""}" data-tip="Style">${I.style}<span>Style</span></button>`;
      html += '<span class="tb-sep"></span>';
      const off = (act) =>
        i.struct.ok
          ? ""
          : ` aria-disabled="true" data-off="${esc(structWhy(i.struct, act))}"`;
      html += `<button type="button" class="tb-icon" data-act="duplicate" data-tip="Duplicate · ⌘D"${off("duplicate")}>${I.dup}</button>`;
      html += `<button type="button" class="tb-icon" data-act="delete" data-tip="Delete · ⌫"${off("delete")}>${I.trash}</button>`;
      html += '<span class="tb-sep"></span>';
      html += `<button type="button" class="tb-ask" data-act="ask" data-tip="Ask Instrument about this">${I.ask}<span>Ask</span></button>`;
    }
    tb.innerHTML = html;
    tb.hidden = false;
    placeToolbar();
  }

  tb.addEventListener("mousedown", (e) => e.preventDefault());
  tb.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const act = b?.dataset.act;
    if (!act || !sel) return;
    if (b.getAttribute("aria-disabled") === "true") return showTip(b, true);
    if (act === "crumbs") return crumbs.hidden ? showCrumbs() : hideCrumbs();
    if (act === "edit") startEdit(sel, "end");
    else if (act === "replace") openImgPop();
    else if (act === "style") setPanel(panelMode === "style" ? null : "style");
    else if (act === "duplicate" || act === "delete") structureOp(act);
    else if (act === "ask") openAskFor(sel);
  });

  // ---------------------------------------------------------------- tooltips + ancestor crumbs

  const tip = $("#tip");
  const crumbs = $("#crumbs");
  let tipTimer = 0;

  /** A small label under a toolbar button; a disabled one says why it is off. */
  function showTip(b, now = false) {
    clearTimeout(tipTimer);
    const why = b.dataset.off;
    const text = b.dataset.tip;
    if (!text && !why) return hideTip();
    const run = () => {
      const [name, keys] = (text ?? "").split(" · ");
      tip.innerHTML = why
        ? `<b>Can’t ${esc(b.dataset.act)}</b><span>${esc(why)} Ask Instrument instead.</span>`
        : `<span class="t">${esc(name)}</span>${keys ? `<kbd>${esc(keys)}</kbd>` : ""}`;
      tip.className = why ? "why" : "";
      tip.hidden = false;
      computePosition(b, tip, {
        strategy: "fixed",
        placement: tb.dataset.placement?.startsWith("bottom")
          ? "bottom"
          : "top",
        middleware: [
          offset(7),
          flip({ padding: { top: barH() + 6, bottom: 70 } }),
          shift({ padding: 8 }),
        ],
      }).then(({ x, y }) => {
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
      });
    };
    if (now || why || !tip.hidden) run();
    else tipTimer = setTimeout(run, 450);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tip.hidden = true;
  }
  tb.addEventListener("mouseover", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.dataset.act === "crumbs") return hideTip();
    showTip(b);
  });
  tb.addEventListener("mouseleave", hideTip);

  // The element's ancestors, outermost first, as a breadcrumb under its name.
  let crumbTimer = 0;
  function showCrumbs() {
    clearTimeout(crumbTimer);
    if (!sel || !crumbs.hidden) return;
    hideTip();
    const list = ancestors(sel).slice(0, 5).reverse();
    if (!list.length) return;
    crumbs.replaceChildren();
    crumbs.insertAdjacentHTML(
      "beforeend",
      '<span class="c-head">Select</span>',
    );
    for (const el of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = kindName(el);
      b.onmouseenter = () => {
        const q = quick(el);
        setHover(el, q.blocked ? "refuse" : "edit", "");
      };
      b.onmouseleave = () => setHover(null);
      b.onclick = () => select(el);
      crumbs.append(
        b,
        Object.assign(document.createElement("span"), {
          className: "c-sep",
          textContent: "›",
        }),
      );
    }
    crumbs.insertAdjacentHTML(
      "beforeend",
      `<span class="c-here">${esc(info.name)}</span>`,
    );
    crumbs.hidden = false;
    const name = $(".tb-name", tb);
    computePosition(name, crumbs, {
      strategy: "fixed",
      placement: tb.dataset.placement?.startsWith("bottom")
        ? "bottom-start"
        : "top-start",
      middleware: [
        offset(9),
        flip({ padding: { top: barH() + 6, bottom: 70 } }),
        shift({ padding: 8 }),
      ],
    }).then(({ x, y }) => {
      crumbs.style.left = `${x}px`;
      crumbs.style.top = `${y}px`;
    });
  }
  function hideCrumbs() {
    clearTimeout(crumbTimer);
    if (crumbs.hidden) return;
    crumbs.hidden = true;
    setHover(null);
  }
  const crumbsLater = () => {
    clearTimeout(crumbTimer);
    crumbTimer = setTimeout(hideCrumbs, 220);
  };
  tb.addEventListener("mouseover", (e) => {
    if (e.target.closest(".tb-name")) {
      clearTimeout(crumbTimer);
      crumbTimer = setTimeout(showCrumbs, 180);
    } else if (!crumbs.hidden) crumbsLater();
  });
  tb.addEventListener("mouseleave", crumbsLater);
  crumbs.addEventListener("mouseenter", () => clearTimeout(crumbTimer));
  crumbs.addEventListener("mouseleave", crumbsLater);
  crumbs.addEventListener("mousedown", (e) => e.preventDefault());

  /** The selection's rect in host viewport coordinates, as a Floating UI reference. */
  function refFor(el) {
    return { getBoundingClientRect: () => el.getBoundingClientRect() };
  }

  const barH = () => 0;

  function placeToolbar() {
    if (tb.hidden || !sel?.isConnected) return;
    const r = sel.getBoundingClientRect();
    const visible =
      r.bottom > 0 && r.top < innerHeight && r.width + r.height > 0;
    tb.style.visibility = visible ? "" : "hidden";
    computePosition(refFor(sel), tb, {
      strategy: "fixed",
      placement: "top-start",
      middleware: [
        offset(8),
        flip({
          fallbackPlacements: ["bottom-start", "top-end", "bottom-end"],
          padding: { top: barH() + 8, bottom: 70, left: 8, right: 8 },
        }),
        shift({
          crossAxis: true,
          padding: {
            top: barH() + 8,
            left: 8,
            right: panelMode ? 300 : 8,
            bottom: 70,
          },
        }),
      ],
    }).then(({ x, y, placement }) => {
      tb.style.left = `${x}px`;
      tb.style.top = `${y}px`;
      tb.dataset.placement = placement;
    });
  }

  // ---------------------------------------------------------------- style

  function setPanel(next) {
    panelMode = next;
    closePalette();
    clearPreview();
    panel.hidden = panelMode !== "requests";
    if (panelMode === "style") renderInspector();
    else inspector.hidden = true;
    $("#req-btn").classList.toggle("on", panelMode === "requests");
    $("#page-btn").classList.toggle("on", panelMode === "style" && !sel);
    ui.classList.toggle("panel-open", !!panelMode);
    renderToolbar();
    layout();
  }

  function renderInspector() {
    if (panelMode !== "style") return;
    inspector.hidden = false;
    const head = $(".ins-head", inspector);
    const body = $(".ins-body", inspector);
    closePalette();
    $("#page-btn").classList.toggle("on", !sel);
    if (!sel) {
      $(".ins-title", head).textContent = "Page";
      $(".ins-sub", head).textContent =
        "Accent, corners and type, for the whole page";
      renderPagePanel(body, {
        page: readPage(A),
        colorOf: (n) => colors.get(n.replace(/^color-/, "")) ?? "transparent",
        onSet: (sets, label) => serial(() => pageOp(sets, label)),
        onPreview: (sets) => pagePreview(sets),
      });
      return;
    }
    $(".ins-title", head).textContent = info.name;
    $(".ins-sub", head).textContent = "Saves to the page as you go";
    if (!info.styleOk || info.blocked) {
      const r = info.blocked ?? info.style;
      body.innerHTML = `<div class="ins-blocked"><p><b>${esc(REASONS[r.reason])}.</b> ${esc(noteFor(r))}</p><button type="button" class="primary agent">${I.ask}<span>Ask Instrument</span></button></div>`;
      $("button", body).onclick = () => openAskFor(sel);
      return;
    }
    const tokens = classAttr(A, info.style.entry).tokens;
    renderStylePanel(body, {
      el: sel,
      kind: info.kind === "image" ? "image" : info.kind,
      name: info.name.toLowerCase(),
      tokens,
      theme,
      colors,
      blocked: probe?.el === sel ? probe.blocked : null,
      paletteHost: layer,
      onOp: (op) => serial(() => styleOp(op)),
      onAsk: ({ change, reason }) =>
        offerAsk(sel, { change }, reason ?? "page-css"),
      onPreview: (prop, value) => setPreview(prop, value),
    });
  }

  /** Show token values on the live page without writing them (the custom accent picker while dragging). */
  function pagePreview(sets) {
    const page = readPage(A);
    const tw =
      page &&
      fdoc().querySelector(`[data-src-id="${page.blocks[0].entry.id}"]`);
    if (!tw) return;
    const inner = innerRange(page.blocks[0].entry);
    quietly(
      tw,
      () =>
        (tw.textContent = sets
          ? previewText(A, page, sets)
          : src.slice(inner.start, inner.end)),
    );
  }

  /** Write page tokens (both blocks) and let the live page recompile its styles. */
  async function pageOp(sets, label) {
    const page = readPage(A);
    if (!page) return;
    const t0 = performance.now();
    const splices = tokenSplices(A, page, sets).sort(
      (a, b) => a.start - b.start,
    );
    if (!splices.length) return;
    // Nearby splices share a region, so their context never overlaps.
    const groups = [];
    for (const sp of splices) {
      const g = groups.at(-1);
      if (g && sp.start - g.end < 160) {
        g.end = Math.max(g.end, sp.end);
        g.splices.push(sp);
      } else groups.push({ start: sp.start, end: sp.end, splices: [sp] });
    }
    const prevA = A;
    const res = await write({
      regions: groups.map((g) => regionOf(g.start, g.end, g.splices)),
      label,
      key: `page:${sets[0][0]}`,
    });
    if (!res.ok)
      return bar.status(
        "Could not save: the agent changed the page’s theme block",
        "warn",
      );
    if (res.external || !patchLive(prevA, res.placed.applied))
      await reloadKeeping(res.prev);
    await refreshColors();
    showToast(label, { undo: true });
    bar.status(
      `Saved ${label} · ${splices.length} token value${splices.length === 1 ? "" : "s"} in ${page.blocks.length === 2 ? "the theme block and its compiled copy" : "the theme block"} · ${Math.round(performance.now() - t0)} ms`,
    );
  }

  /** Re-read the page's resolved token colors once its styles have recompiled. */
  async function refreshColors() {
    await frames();
    await frames();
    colors = resolveColors(fdoc(), colorNames());
    if (panelMode === "style") renderInspector();
  }

  function setPreview(prop, value) {
    if (!prop || value == null) return clearPreview();
    if (!sel) return;
    if (!preview || preview.el !== sel || preview.prop !== prop) {
      clearPreview();
      preview = {
        el: sel,
        prop,
        saved: sel.style.getPropertyValue(prop),
        priority: sel.style.getPropertyPriority(prop),
      };
    }
    sel.style.setProperty(prop, value, "important");
  }

  function clearPreview() {
    if (!preview) return;
    const { el, prop, saved, priority } = preview;
    preview = null;
    if (saved) el.style.setProperty(prop, saved, priority);
    else el.style.removeProperty(prop);
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  }

  /**
   * Which properties a utility class cannot change on this element: a hidden
   * shallow copy next to it gets one probe class per property, and whatever does
   * not take the probe's value is decided by the page's own CSS (unlayered rules
   * beat Tailwind's layers) or by a screen-size variant.
   */
  function startProbe(el) {
    const p = { el, blocked: null };
    probe = p;
    p.promise = (async () => {
      await frames();
      if (probe !== p || !el.isConnected) return;
      const G = guest();
      const probes = probeClasses(cs(el));
      const clone = el.cloneNode(false);
      clone.removeAttribute("id");
      clone.removeAttribute("data-src-id");
      clone.setAttribute("data-editor-guest", "");
      clone.setAttribute("aria-hidden", "true");
      clone.style.setProperty("position", "absolute", "important");
      clone.style.setProperty("visibility", "hidden", "important");
      clone.style.setProperty("pointer-events", "none", "important");
      const base = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean);
      clone.setAttribute(
        "class",
        mergeClasses(
          base,
          probes.map((x) => x[1]),
        ).join(" "),
      );
      G.applying = true;
      el.after(clone);
      G.flush();
      G.applying = false;
      const ccs = cs(clone);
      const hit = ([prop, , want]) =>
        prop === "box-shadow"
          ? ccs.getPropertyValue(prop).includes(want)
          : ccs.getPropertyValue(prop) === want;
      const t0 = performance.now();
      while (performance.now() - t0 < 900 && !probes.some(hit)) await frames();
      await frames();
      const blocked = new Map();
      const tokens = classAttr(A, staticEntry(A, el).entry).tokens;
      for (const pr of probes)
        if (!hit(pr)) blocked.set(pr[0], blockReason(tokens, pr[1]));
      clone.remove();
      G.flush();
      p.blocked = blocked;
      if (probe === p && panelMode === "style" && sel === el) renderInspector();
    })();
  }

  const BP = { sm: 40, md: 48, lg: 64, xl: 80, "2xl": 96 };
  function blockReason(tokens, cls) {
    const w = fwin();
    for (const t of tokens) {
      const m = /^(sm|md|lg|xl|2xl):(.+)$/.exec(t);
      if (!m || !w.matchMedia(`(min-width: ${BP[m[1]]}rem)`).matches) continue;
      if (!twMerge(`${m[2]} ${cls}`).split(" ").includes(m[2]))
        return "responsive";
    }
    return "page-css";
  }

  /**
   * `tokens` with `adds` merged in. A token a new class overrides is replaced in
   * place (so `mt-3` -> `mt-4` stays where it was written); a clear sentinel
   * removes what it overrides and is itself dropped.
   */
  function mergeClasses(tokens, adds, clear = null) {
    let out = [...tokens];
    for (const add of adds) {
      const baseSet = new Set(twMerge(out.join(" ")).split(" "));
      const kept = new Set(twMerge(out.join(" "), add).split(" "));
      const next = [];
      let placed = false;
      for (const t of out) {
        if (t === add) {
          if (!placed && add !== clear) next.push(t);
          placed = true;
          continue;
        }
        if (!baseSet.has(t) || kept.has(t)) next.push(t);
        else if (!placed) {
          if (add !== clear) next.push(add);
          placed = true;
        }
      }
      if (!placed && add !== clear) next.push(add);
      out = next;
    }
    return out;
  }
  const mergeOp = (tokens, op) =>
    mergeClasses(tokens, [op.add ?? op.clear], op.clear ?? null);

  function setLiveClass(el, value) {
    const G = guest();
    G.applying = true;
    if (value) el.setAttribute("class", value);
    else el.removeAttribute("class");
    G.flush();
    G.applying = false;
  }

  async function waitChange(el, props, before, ms) {
    const c = cs(el);
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (props.some((p, i) => c.getPropertyValue(p) !== before[i]))
        return true;
      await frames();
    }
    return false;
  }

  async function styleOp(op) {
    const el = sel;
    if (!el || !info?.styleOk) return;
    const entry = staticEntry(A, el).entry;
    if (probe?.el === el) await probe.promise;
    const liveTokens = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const before = op.props.map((p) => cs(el).getPropertyValue(p));
    setLiveClass(el, mergeOp(liveTokens, op).join(" "));
    const changed = await waitChange(el, op.props, before, 700);
    const probed =
      probe?.el === el
        ? op.props.map((p) => probe.blocked?.get(p)).find(Boolean)
        : "page-css";
    if (!changed && probed) {
      setLiveClass(el, liveTokens.join(" "));
      bar.status(
        `${op.label}: no visible change, the page’s own CSS decides this`,
        "warn",
      );
      return offerAsk(el, op, probed);
    }
    verdictCache.delete(el);
    const srcTokens = classAttr(A, entry).tokens;
    const nextSrc = mergeOp(srcTokens, op);
    const sp = classSplice(A, entry, nextSrc.join(" "));
    if (!sp) return;
    const tag = entry.loc.startTag;
    const regions = [regionOf(tag.startOffset, tag.endOffset, [sp])];
    const floor = floorRegion(nextSrc.filter((t) => !srcTokens.includes(t)));
    if (floor.region) regions.push(floor.region);
    const res = await write({
      regions,
      label: op.label,
      key: `style:${entry.loc.startOffset}:${op.key}`,
      merge: !floor.region,
    });
    if (!res.ok) {
      setLiveClass(el, liveTokens.join(" "));
      return toAgentChange(
        el,
        op.change,
        "the agent changed this part of the page",
      );
    }
    if (res.external) await reloadKeeping(res.prev);
    else {
      info = inspect(sel);
      renderInspector();
      renderToolbar();
      layout();
    }
    const floorNote = floor.region
      ? " · thumbnail CSS updated"
      : floor.missing?.length
        ? " · thumbnail CSS could not be updated"
        : "";
    showToast(op.label, { undo: true });
    bar.status(
      `Saved ${op.label} (1 class attribute${floor.region ? " + 1 line of the compiled stylesheet" : ""})${floorNote}`,
    );
  }

  /**
   * The page ships a compiled Tailwind "floor" (<style data-tailwind="compiled">)
   * for renderers that never run its scripts (thumbnails, Quick Look). A class
   * it does not contain is copied in from the rules the page's browser build
   * just generated, so the file renders the edit with scripts off too.
   */
  function floorRegion(added) {
    const floor = A.entries.find(
      (e) =>
        e.tag === "style" &&
        e.node.attrs.some(
          (a) => a.name === "data-tailwind" && a.value === "compiled",
        ),
    );
    if (!floor || !added.length) return {};
    const inner = innerRange(floor);
    const text = src.slice(inner.start, inner.end);
    const w = fwin();
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const missing = added.filter(
      (c) => !new RegExp(`\\.${escRe(w.CSS.escape(c))}\\s*\\{`).test(text),
    );
    if (!missing.length) return {};
    const rules = [];
    for (const c of missing) {
      const selector = `.${w.CSS.escape(c)}`;
      const find = (list) => {
        for (const r of list) {
          if (r.selectorText === selector) return r.cssText;
          if (r.cssRules) {
            const f = find(r.cssRules);
            if (f) return f;
          }
        }
        return null;
      };
      for (const sheet of fdoc().styleSheets) {
        if (sheet.ownerNode?.matches?.('style[data-tailwind="compiled"]'))
          continue;
        let hit = null;
        try {
          hit = find(sheet.cssRules);
        } catch {}
        if (hit) {
          rules.push(hit);
          break;
        }
      }
    }
    if (!rules.length) return { missing };
    const at = src.lastIndexOf("\n", inner.end - 1) + 1;
    const tail = src.slice(at, floor.loc.endOffset);
    return {
      region: withContext({
        at,
        before: tail,
        after: `@layer utilities { ${rules.join(" ")} }\n${tail}`,
      }),
      missing,
    };
  }

  // ---------------------------------------------------------------- regions, write, undo

  /** A region covering [a, b) of src with `splices` applied inside it, plus context. */
  function regionOf(a, b, splices) {
    let after = src.slice(a, b);
    for (const sp of [...splices].sort((x, y) => y.start - x.start))
      after = after.slice(0, sp.start - a) + sp.text + after.slice(sp.end - a);
    return withContext({ at: a, before: src.slice(a, b), after });
  }

  /** Widen a region with unchanged text on both sides so it can be found again after other edits. */
  function withContext(r, k = 48) {
    const s = Math.max(0, r.at - k);
    const e = Math.min(src.length, r.at + r.before.length + k);
    const pre = src.slice(s, r.at);
    const post = src.slice(r.at + r.before.length, e);
    return {
      at: s,
      before: pre + r.before + post,
      after: pre + r.after + post,
      pre: pre.length,
      post: post.length,
    };
  }

  /** Where a region's text sits in `text`: exact offset, else nearest copy with context, else nearest copy of the changed core alone. */
  function locate(text, r) {
    if (text.slice(r.at, r.at + r.before.length) === r.before)
      return { at: r.at, before: r.before, after: r.after };
    const at = findNearest(text, r.before, r.at);
    if (at >= 0) return { at, before: r.before, after: r.after };
    // A neighbor changed (the agent wrote next to this edit): drop the context.
    const pre = r.pre ?? 0;
    const post = r.post ?? 0;
    const before = r.before.slice(pre, r.before.length - post);
    const after = r.after.slice(pre, r.after.length - post);
    if (!before) return null;
    const core = findNearest(text, before, r.at + pre);
    return core < 0 ? null : { at: core, before, after };
  }

  /** Apply regions to `text` (exact offsets if they still match, else nearest copy). */
  function place(text, regions) {
    const sorted = [...regions].sort((a, b) => b.at - a.at);
    let out = text;
    const applied = [];
    for (const r of sorted) {
      const hit = locate(out, r);
      if (!hit) return null;
      out =
        out.slice(0, hit.at) +
        hit.after +
        out.slice(hit.at + hit.before.length);
      const exact = hit.before === r.before;
      applied.push({
        at: hit.at,
        before: hit.before,
        after: hit.after,
        pre: exact ? r.pre : 0,
        post: exact ? r.post : 0,
      });
    }
    applied.sort((a, b) => a.at - b.at);
    let shiftBy = 0;
    for (const r of applied) {
      r.atAfter = r.at + shiftBy;
      shiftBy += r.after.length - r.before.length;
    }
    return { text: out, applied };
  }

  async function saveRegions(regions) {
    const base = src;
    let external = doc.content !== base;
    let placed = place(doc.content, regions);
    if (!placed) return { ok: false };
    let res = await doc.save(placed.text);
    if (!res.ok) {
      doc.content = res.conflict.content;
      doc.version = res.conflict.version;
      external = true;
      placed = place(doc.content, regions);
      if (!placed) return { ok: false };
      res = await doc.save(placed.text);
      if (!res.ok) return { ok: false };
    }
    const prev = src;
    src = placed.text;
    A = analyze(src);
    pendingExternal = false;
    pill.hidden = true;
    return { ok: true, placed, prev, external };
  }

  async function write({ regions, label, key, merge = false }) {
    const res = await saveRegions(regions);
    if (!res.ok) return res;
    const last = undoStack.at(-1);
    const now = Date.now();
    const r0 = res.placed.applied[0];
    if (
      merge &&
      last &&
      last.key === key &&
      now - last.time < 1800 &&
      last.regions.length === 1 &&
      res.placed.applied.length === 1 &&
      last.regions[0].atAfter === r0.at &&
      last.regions[0].after === r0.before
    ) {
      last.regions[0] = {
        ...last.regions[0],
        after: r0.after,
        atAfter: r0.atAfter,
      };
      last.label = `${last.label.split(" → ")[0]} → ${label.split(" → ").at(-1)}`;
      last.time = now;
    } else
      undoStack.push({ label, key, regions: res.placed.applied, time: now });
    redoStack.length = 0;
    updateUndoButtons();
    verdictCacheReset();
    return res;
  }

  function verdictCacheReset() {
    // WeakMap entries die with their elements; clear what the current page holds.
    for (const el of fdoc().querySelectorAll("[data-src-id]"))
      verdictCache.delete(el);
  }

  async function undo() {
    if (editing) return;
    const op = undoStack.pop();
    if (!op) return;
    await serial(async () => {
      const t0 = performance.now();
      const inv = op.regions.map((r) => ({
        at: r.atAfter,
        before: r.after,
        after: r.before,
        pre: r.pre,
        post: r.post,
      }));
      const res = await replay(
        inv,
        op.live && {
          kids: op.live.before,
          map: invertMap(op.live.map),
          roots: op.live.invRoots,
          live: op.live,
        },
      );
      if (!res.ok) {
        undoStack.push(op);
        return bar.status(
          "Could not undo: that part of the page has changed since",
          "warn",
        );
      }
      redoStack.push({
        ...op,
        regions: res.placed.applied.map((r) => ({
          at: r.atAfter,
          before: r.after,
          after: r.before,
          pre: r.pre,
          post: r.post,
        })),
      });
      showToast(`Undid ${op.label}`, { redo: true });
      bar.status(
        `Undid ${op.label} · ${res.how} in ${Math.round(performance.now() - t0)} ms`,
      );
      updateUndoButtons();
    });
  }

  async function redo() {
    if (editing) return;
    const op = redoStack.pop();
    if (!op) return;
    await serial(async () => {
      const t0 = performance.now();
      const res = await replay(
        op.regions,
        op.live && {
          kids: op.live.after,
          map: op.live.map,
          roots: op.live.fwdRoots,
          live: op.live,
        },
      );
      if (!res.ok) {
        redoStack.push(op);
        return bar.status(
          "Could not redo: that part of the page has changed since",
          "warn",
        );
      }
      undoStack.push({ ...op, regions: res.placed.applied, time: 0 });
      showToast(`Redid ${op.label}`, { undo: true });
      bar.status(
        `Redid ${op.label} · ${res.how} in ${Math.round(performance.now() - t0)} ms`,
      );
      updateUndoButtons();
    });
  }

  /**
   * Write undo/redo regions and bring the live page along: a structural step
   * puts the parent's children back as they were (`step.kids`) and renumbers
   * ids; anything else is patched in place. Reloads when neither fits.
   */
  async function replay(regions, step) {
    const prevA = A;
    const off = selOffset();
    const res = await saveRegions(regions);
    if (!res.ok) return res;
    let ok = exactlyPlaced(res, regions);
    let focus = null;
    if (ok && step) {
      quietly(step.live.parent, () => setChildren(step.live.parent, step.kids));
      const roots = step.roots();
      ok = restamp(prevA, step.map, roots);
      focus = roots[0]?.nodes[0] ?? null;
    } else if (ok) ok = patchLive(prevA, res.placed.applied);
    if (!ok || step?.live.reload) {
      await reloadKeeping(res.prev, off, true);
      return { ...res, how: "page reloaded" };
    }
    verdictCacheReset();
    const mapped = off != null ? mapOffset(res.prev, src, off) : null;
    if (focus?.isConnected) select(focus);
    else if (sel && !sel.isConnected) select(null);
    else if (mapped != null) reselectAt(mapped);
    repin();
    flashRanges(changedRanges(res.prev, src), true);
    if (panelMode === "style") await refreshColors();
    return { ...res, how: "live" };
  }

  function updateUndoButtons() {
    $("#undo-btn").disabled = !undoStack.length;
    $("#redo-btn").disabled = !redoStack.length;
    $("#undo-btn").title = undoStack.length
      ? `Undo ${undoStack.at(-1).label} (⌘Z)`
      : "Undo (⌘Z)";
    $("#redo-btn").title = redoStack.length
      ? `Redo ${redoStack.at(-1).label} (⇧⌘Z)`
      : "Redo (⇧⌘Z)";
  }

  /** Reload the page from `src`, keeping scroll and re-finding the selection. */
  async function reloadKeeping(
    prev,
    selOff = selOffset(),
    flashSelf = false,
    reselect = true,
  ) {
    const mapped = selOff != null ? mapOffset(prev, src, selOff) : null;
    await mount({
      sel: reselect ? mapped : null,
      flash: flashSelf ? changedRanges(prev, src) : null,
      flashSelf,
    });
  }

  // ---------------------------------------------------------------- text editing

  function startEdit(el, at) {
    const v = classify(A, el);
    if (!v.ok) return openAskFor(el);
    if (editing) commitEdit();
    closeAsk();
    closeImgPop();
    const G = guest();
    G.editing = el;
    const inner = innerRange(v.entry);
    const srcInner = inner ? src.slice(inner.start, inner.end) : null;
    const display = cs(el).display;
    let rich = null;
    if (srcInner != null && !/grid|table/.test(display)) {
      rich = mountRich(el, srcInner, { layer, at, onDone: () => commitEdit() });
      if (rich)
        rich.editor.view.dom.style.display = /flex/.test(display)
          ? "flex"
          : display === "inline"
            ? "inline"
            : "block";
    }
    if (!rich) {
      el.setAttribute("contenteditable", "plaintext-only");
      el.spellcheck = false;
      el.focus({ preventScroll: true });
      const d = el.ownerDocument;
      const r = at && at !== "end" ? d.caretRangeFromPoint?.(at.x, at.y) : null;
      const s = d.getSelection();
      s.removeAllRanges();
      if (r && el.contains(r.startContainer)) s.addRange(r);
      else {
        const range = d.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        s.addRange(range);
      }
    }
    G.flush();
    editing = {
      el,
      entry: v.entry,
      seg: v.seg,
      baseSrc: src,
      oldText: el.textContent,
      rich,
      srcInner,
      inner,
    };
    $(".keys", hint).innerHTML = rich
      ? "<kbd>⇧↵</kbd> new line <kbd>⌘B</kbd> <kbd>⌘I</kbd> <kbd>⌘K</kbd> <kbd>Esc</kbd> done"
      : "<kbd>↵</kbd> or <kbd>Esc</kbd> done";
    hint.hidden = false;
    setHover(null);
    renderToolbar();
    bar.status(
      `Editing ${info?.name?.toLowerCase() ?? "text"}${rich ? "" : " (plain text: this markup keeps its structure)"}${pendingExternal ? " · agent changed the page" : ""}`,
    );
    layout();
  }

  /** Map a change between two whitespace-collapsed strings onto the raw text they came from. */
  function transplant(raw, a, b) {
    const map = [];
    let collapsed = "";
    let lastSpace = true;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) {
        if (lastSpace) continue;
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
    if (collapsed !== a) return null;
    const diffs = diffMain(a, b);
    let out = "";
    let rawPos = 0;
    let ap = 0;
    const rawEnd = map.length ? map[map.length - 1] + 1 : 0;
    const rawAt = (p) => (p < map.length ? map[p] : rawEnd);
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
      } else ap += s.length;
    }
    return out + raw.slice(rawPos);
  }

  function restoreEntities(srcInner, html) {
    const decoder = document.createElement("textarea");
    const ents = new Map();
    for (const m of srcInner.matchAll(
      /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi,
    )) {
      decoder.innerHTML = m[0];
      const ch = decoder.value;
      if (ch.length === 1 && !'&<>" '.includes(ch)) ents.set(ch, m[0]);
    }
    let out = html
      .split(/(<[^>]*>)/)
      .map((part, i) =>
        i % 2
          ? part
          : [...ents].reduce((s, [ch, e]) => s.split(ch).join(e), part),
      )
      .join("");
    if (/<br\s*\/>/.test(srcInner)) out = out.replace(/<br>/g, "<br />");
    return out;
  }

  function commitEdit() {
    if (!editing) return;
    const E = editing;
    editing = null;
    hint.hidden = true;
    const G = guest();
    let result;
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
    G.flush();
    if (!result.changed) {
      if (!E.rich && !restoreText(E.el, E.seg))
        serial(() => reloadKeeping(src));
      G.editing = null;
      afterBusy();
      renderToolbar();
      layout();
      return;
    }
    const newVisible = result.marks
      ? null
      : (result.plain ??
        transplant(E.seg.text, result.oldText, result.newText));
    const visibleAfter = result.marks
      ? collapse(
          new DOMParser().parseFromString(`<body>${result.html}`, "text/html")
            .body.textContent,
        )
      : newVisible;
    E.newVisible = visibleAfter;
    if (!result.marks) {
      const r = newVisible != null && textSplices(E.seg, newVisible);
      if (!r) {
        G.editing = null;
        return toAgent(
          E,
          newVisible ?? visibleAfter,
          "the change could not be mapped to the file",
        );
      }
      const splices = r.splices.filter(
        (sp) => E.baseSrc.slice(sp.start, sp.end) !== sp.text,
      );
      if (!splices.length) {
        restoreText(E.el, segments(A, E.entry));
        G.editing = null;
        return afterBusy();
      }
      const label = describe(E.oldText, r.written);
      // Show the result now; the file is written behind it.
      if (E.rich) setTextValues(E.el, textAfter(E.seg, splices, E.baseSrc));
      serial(() =>
        writeText(
          E,
          [
            regionAt(
              E.baseSrc,
              E.entry.loc.startOffset,
              E.entry.loc.endOffset,
              splices,
            ),
          ],
          label,
          false,
          r.written,
        ),
      );
    } else {
      const neu = keepWhitespace(
        E.srcInner,
        restoreEntities(E.srcInner, result.html),
      );
      const sp = trimmedSplice(E.srcInner, neu, E.inner.start);
      quietly(E.el, () => (E.el.innerHTML = neu));
      serial(() =>
        writeText(
          E,
          [
            regionAt(
              E.baseSrc,
              E.entry.loc.startOffset,
              E.entry.loc.endOffset,
              [sp],
            ),
          ],
          `Formatting · ${clip(collapse(visibleAfter), 40)}`,
          true,
          null,
        ),
      );
    }
    renderToolbar();
    layout();
  }

  /** Each source text node's decoded value once `splices` are applied to `base`. */
  function textAfter(seg, splices, base) {
    const dec = document.createElement("textarea");
    return seg.segs.map((sg) => {
      let raw = base.slice(sg.start, sg.end);
      for (const sp of [...splices].sort((x, y) => y.start - x.start)) {
        if (sp.start >= sg.start && sp.end <= sg.end)
          raw =
            raw.slice(0, sp.start - sg.start) +
            sp.text +
            raw.slice(sp.end - sg.start);
      }
      dec.innerHTML = raw;
      return dec.value;
    });
  }

  /** regionOf against a base text other than src (an edit that started before the agent wrote). */
  function regionAt(base, a, b, splices) {
    const keep = src;
    src = base;
    const r = regionOf(a, b, splices);
    src = keep;
    return r;
  }

  async function writeText(E, regions, label, reload, written) {
    const prevA = A;
    const res = await write({
      regions,
      label,
      key: `text:${E.entry.loc.startOffset}`,
    });
    const G = guest();
    G.editing = null;
    if (!res.ok)
      return toAgent(
        E,
        E.newVisible ?? E.el.textContent,
        "the agent changed this part of the page while you were typing",
      );
    const at =
      res.placed.applied[0].at + (E.entry.loc.startOffset - regions[0].at);
    const entry = A.byStart.get(at);
    if (
      !reload &&
      !res.external &&
      entry &&
      restoreText(E.el, segments(A, entry))
    ) {
      if (written != null && segments(A, entry).text !== written)
        bar.status(
          "Saved, but the file text differs from what you typed",
          "warn",
        );
      if (sel === E.el) select(E.el);
    } else if (
      reload &&
      !res.external &&
      entry &&
      patchLive(prevA, res.placed.applied)
    ) {
      if (sel === E.el) select(E.el);
    } else {
      await mount({
        sel: entry ? at : null,
        flash: res.external ? changedRanges(res.prev, src) : null,
      });
    }
    showToast(label, { undo: true });
    bar.status(
      `Saved ${label}${res.external ? " on top of the agent’s change" : ""}`,
      res.external ? "agent" : "",
    );
    afterBusy();
  }

  /** Write each source text node's value back into the live element; false if the shapes differ. */
  function restoreText(el, seg) {
    return (
      setTextValues(
        el,
        seg.segs.map((g) => g.node.value),
      ) && el.textContent === seg.text
    );
  }

  /** Put `values` into the element's text nodes, in order; false if the counts differ. */
  function setTextValues(el, values) {
    const live = [];
    const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) live.push(n);
    const ok = live.length === values.length;
    if (ok)
      quietly(el, () =>
        live.forEach((n, i) => n.data !== values[i] && (n.data = values[i])),
      );
    return ok;
  }

  /** A short "old → new" for the toast. */
  function describe(a, b) {
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0;
    while (
      e < a.length - s &&
      e < b.length - s &&
      a[a.length - 1 - e] === b[b.length - 1 - e]
    )
      e++;
    const grow = (t, i, j) => {
      while (i > 0 && /\S/.test(t[i - 1])) i--;
      while (j < t.length && /\S/.test(t[j])) j++;
      return collapse(t.slice(i, j));
    };
    const from = grow(a, s, a.length - e);
    const to = grow(b, s, b.length - e);
    return from
      ? to
        ? `“${clip(from, 28)}” → “${clip(to, 28)}”`
        : `Removed “${clip(from, 28)}”`
      : `Added “${clip(to, 28)}”`;
  }

  function toAgent(E, newText, why) {
    addRequest(
      E.el,
      { ok: true, entry: E.entry },
      `Change the text "${clip(collapse(E.oldText), 120)}" to "${clip(collapse(newText ?? ""), 200)}".`,
      { from: collapse(E.oldText), to: collapse(newText ?? "") },
    );
    bar.status(
      `Could not save directly: ${why}. Turned it into request ${nextN - 1} for the agent.`,
      "warn",
    );
    showToast(`Sent to requests · ${why}`, {});
    serial(() => reloadKeeping(src));
    if (pendingExternal) serial(applyExternal);
  }

  function toAgentChange(el, change, why) {
    addRequest(
      el,
      {
        ok: true,
        entry: staticEntry(A, el).entry,
        status: "element",
        label: kindName(el),
      },
      change,
      null,
      change,
    );
    bar.status(
      `Could not save directly: ${why}. Turned it into request ${nextN - 1} for the agent.`,
      "warn",
    );
    showToast(`Sent to requests · ${why}`, {});
  }

  // ---------------------------------------------------------------- image

  const imgFile = $("#img-file");

  function openImgPop() {
    if (!sel || info.kind !== "image") return;
    closeAsk();
    imgPop.hidden = false;
    $("[name=url]", imgPop).value = "";
    $("[name=alt]", imgPop).value = sel.getAttribute("alt") ?? "";
    computePosition(refFor(sel), imgPop, {
      strategy: "fixed",
      placement: "bottom-start",
      middleware: [
        offset(10),
        flip({ padding: { top: barH() + 8, bottom: 70 } }),
        shift({ padding: 10 }),
      ],
    }).then(({ x, y }) => {
      imgPop.style.left = `${x}px`;
      imgPop.style.top = `${y}px`;
    });
  }
  function closeImgPop() {
    imgPop.hidden = true;
  }
  $("[data-upload]", imgPop).onclick = () => {
    imgFile.value = "";
    imgFile.click();
  };
  imgFile.onchange = () => {
    const file = imgFile.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => serial(() => setImage(fr.result, `Image → ${file.name}`));
    fr.readAsDataURL(file);
  };
  $("form[data-url]", imgPop).addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("[name=url]", imgPop).value.trim();
    if (url)
      serial(() =>
        setImage(url, `Image → ${clip(url.replace(/^https?:\/\//, ""), 32)}`),
      );
  });
  $("[name=alt]", imgPop).addEventListener("change", (e) =>
    serial(() => setAlt(e.target.value)),
  );
  $("[name=alt]", imgPop).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  });

  async function setImage(url, label) {
    const img = sel;
    if (!img || img.tagName !== "IMG") return;
    closeImgPop();
    const entry = staticEntry(A, img).entry;
    const at = entry.loc.attrs.src;
    const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const splices = [
      {
        start: at.startOffset,
        end: at.endOffset,
        text: `src="${escAttr(url)}"`,
      },
    ];
    const ss = entry.loc.attrs.srcset;
    if (ss) {
      let s = ss.startOffset;
      while (/\s/.test(src[s - 1])) s--;
      splices.push({ start: s, end: ss.endOffset, text: "" });
    }
    const tag = entry.loc.startTag;
    const res = await write({
      regions: [regionOf(tag.startOffset, tag.endOffset, splices)],
      label,
      key: `img:${tag.startOffset}`,
    });
    if (!res.ok)
      return toAgentChange(
        img,
        `Replace this image with ${url}`,
        "the agent changed this part of the page",
      );
    const G = guest();
    G.applying = true;
    img.removeAttribute("srcset");
    img.src = url;
    G.flush();
    G.applying = false;
    if (res.external) await reloadKeeping(res.prev);
    info = inspect(sel);
    showToast(label, { undo: true });
    bar.status(`Saved ${label}${ss ? " (dropped srcset)" : ""}`);
    layout();
  }

  async function setAlt(value) {
    const img = sel;
    if (
      !img ||
      img.tagName !== "IMG" ||
      (img.getAttribute("alt") ?? "") === value
    )
      return;
    const entry = staticEntry(A, img).entry;
    const a = entry.loc.attrs.alt;
    const text = `alt="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    const sp = a
      ? { start: a.startOffset, end: a.endOffset, text }
      : {
          start: entry.loc.startTag.startOffset + 4,
          end: entry.loc.startTag.startOffset + 4,
          text: ` ${text}`,
        };
    const tag = entry.loc.startTag;
    const res = await write({
      regions: [regionOf(tag.startOffset, tag.endOffset, [sp])],
      label: "Image description",
      key: `alt:${tag.startOffset}`,
    });
    if (!res.ok) return;
    img.setAttribute("alt", value);
    showToast("Image description updated", { undo: true });
  }

  // ---------------------------------------------------------------- structure

  async function structureOp(kind) {
    if (!sel || mode !== "edit" || editing) return;
    const el = sel;
    const v = structureVerdict(A, el);
    const name = kindName(el).toLowerCase();
    if (!v.ok) {
      const why = structWhy(v, kind);
      showToast(`Can’t ${kind} this ${name}: ${why.replace(/\.$/, "")}`, {});
      bar.status(
        `Can’t ${kind} this ${name}: ${why} Ask Instrument instead.`,
        "warn",
      );
      return;
    }
    const t0 = performance.now();
    const label =
      kind === "duplicate" ? `Duplicated ${name}` : `Deleted ${name}`;
    const parent = el.parentElement;
    const before = [...parent.childNodes];
    const r =
      kind === "duplicate"
        ? duplicateRegion(A, v.entry)
        : deleteRegion(A, v.entry);
    // The page changes now; the file follows.
    let clone = null;
    quietly(parent, () => {
      if (kind === "duplicate") {
        clone = el.cloneNode(true);
        for (const n of [clone, ...clone.querySelectorAll("[id]")])
          n.removeAttribute("id");
        const ws = src.slice(r.region.at, v.entry.loc.startOffset);
        el.after(...(ws ? [document.createTextNode(ws)] : []), clone);
      } else unitOf(el).forEach((n) => n.remove());
    });
    const after = [...parent.childNodes];
    if (kind === "delete") select(null);
    layout();
    const live = {
      parent,
      before,
      after,
      map: r.map,
      fwdRoots: () =>
        clone
          ? [
              {
                nodes: [clone, ...clone.querySelectorAll("[data-src-id]")],
                ...r.copyRange,
              },
            ]
          : [],
      invRoots: () =>
        kind === "delete"
          ? [
              {
                nodes: [el, ...el.querySelectorAll("[data-src-id]")],
                ...r.removedRange,
              },
            ]
          : [],
      reload: !!clone && scriptTouches(clone),
    };
    serial(async () => {
      const res = await applyLive({
        regions: [withContext(r.region)],
        label,
        key: `${kind}:${v.entry.loc.startOffset}`,
        live,
      });
      if (!res.ok) {
        quietly(parent, () => setChildren(parent, before));
        return toAgentChange(
          el,
          `${kind === "duplicate" ? "Duplicate" : "Delete"} this ${name}`,
          "the agent changed this part of the page",
        );
      }
      if (clone?.isConnected) {
        select(clone);
        flashes.push({ el: clone, until: Date.now() + 1400, self: true });
      }
      showToast(label, { undo: true });
      bar.status(
        `${label} · ${res.how} in ${Math.round(performance.now() - t0)} ms`,
      );
      layout();
    });
  }

  /** An element plus the whitespace-only text right before it: what the file moves as one chunk. */
  function unitOf(el) {
    const p = el.previousSibling;
    return p && p.nodeType === 3 && !/\S/.test(p.data) ? [p, el] : [el];
  }

  /** Do the page's scripts name any class used in this subtree? Then a copy made here would be missing their wiring. */
  function scriptTouches(root) {
    const classes = new Set();
    for (const n of [root, ...root.querySelectorAll("[class]")])
      for (const c of n.classList) classes.add(c);
    const interactive =
      root.matches("button,input,select,textarea,details,form,[onclick]") ||
      root.querySelector("button,input,select,textarea,details,form,[onclick]");
    if (interactive && A.scripts.some((s) => s.type !== "application/json"))
      return true;
    return A.scripts.some(
      (s) =>
        s.type !== "application/json" &&
        [...classes].some(
          (c) =>
            s.text.includes(`.${c}`) ||
            s.text.includes(`'${c}'`) ||
            s.text.includes(`"${c}"`),
        ),
    );
  }

  async function moveTo(
    from,
    to,
    items = info?.struct.siblings,
    before = null,
  ) {
    if (!sel || !items) return;
    const el = items[from];
    // Entries in source order; `from`/`to` index the same order.
    const entries = items.map((n) => staticEntry(A, n).entry);
    if (
      entries.some(
        (e, i) =>
          !e || (i && e.loc.startOffset <= entries[i - 1].loc.startOffset),
      )
    )
      return reloadKeeping(src);
    const t0 = performance.now();
    const name = kindName(el).toLowerCase();
    const parent = el.parentElement;
    const kids = before ?? [...parent.childNodes];
    const { region, map } = moveRegion(src, entries, from, to);
    // Reorder the live nodes the way the file will be: each element with the whitespace before it.
    const order = items.map((_, i) => i);
    order.splice(order.indexOf(from), 1);
    order.splice(to, 0, from);
    quietly(parent, () => {
      setChildren(parent, kids);
      const units = items.map(unitOf);
      const end = items.at(-1).nextSibling;
      for (const i of order)
        for (const n of units[i]) parent.insertBefore(n, end);
    });
    const after = [...parent.childNodes];
    layout();
    const live = {
      parent,
      before: kids,
      after,
      map,
      fwdRoots: () => [],
      invRoots: () => [],
      reload: false,
    };
    const res = await applyLive({
      regions: [withContext(region)],
      label: `Moved ${name}`,
      key: `move:${entries[from].loc.startOffset}`,
      live,
    });
    if (!res.ok) {
      quietly(parent, () => setChildren(parent, kids));
      return reloadKeeping(src);
    }
    if (el.isConnected) select(el);
    if (sel) flashes.push({ el: sel, until: Date.now() + 1400, self: true });
    showToast(`Moved ${name} to position ${to + 1}`, { undo: true });
    bar.status(
      `Moved ${name} ${from + 1} → ${to + 1} · ${res.how} in ${Math.round(performance.now() - t0)} ms`,
    );
    layout();
  }

  function nudge(dir) {
    if (!sel || !info?.struct.ok) return;
    const items = info.struct.siblings;
    const i = items.indexOf(sel);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    serial(() => moveTo(i, j, items));
  }

  function setupGesture() {
    gesture?.destroy();
    gesture = null;
    if (!sel || mode !== "edit" || editing || !info?.struct.ok) return;
    const items = info.struct.siblings;
    if (items.length < 2) return;
    const a = items[0].getBoundingClientRect();
    const b = items[1].getBoundingClientRect();
    const vertical = Math.abs(b.top - a.top) >= Math.abs(b.left - a.left);
    const parent = sel.parentElement;
    let marker = null;
    let kids = null;
    const end = () => {
      dragging = false;
      ui.classList.remove("dragging");
      marker?.remove();
      marker = null;
      guest().editing = null;
    };
    gesture = reorderGesture({
      host: proxiesEl,
      items,
      selectedIndex: items.indexOf(sel),
      vertical,
      gripHtml: I.grip,
      rectOf: (el) => rectOf(el),
      onStart: () => {
        dragging = true;
        ui.classList.add("dragging");
        kids = [...parent.childNodes];
        guest().editing = parent;
        marker = fdoc().createComment("");
        items[0].before(marker);
        renderToolbar();
        setHover(null);
        layout();
      },
      onPreview: (order) => {
        marker.after(...order.map((i) => items[i]));
        guest().flush();
      },
      onDrop: (from, to) => {
        marker?.remove();
        marker = null;
        guest().flush();
        end();
        // The preview order stays on screen; moveTo lays the nodes out exactly as the file will be.
        serial(() => moveTo(from, to, items, kids));
      },
      onCancel: () => {
        marker?.remove();
        marker = null;
        quietly(parent, () => setChildren(parent, kids));
        end();
        renderToolbar();
        layout();
      },
    });
  }

  // ---------------------------------------------------------------- live patching
  //
  // A direct edit changes the live page first and the file second. The page's
  // elements carry data-src-id ordinals of the file they were loaded from; after
  // a splice that adds, removes or moves elements, those ordinals shift, so the
  // live ids are renumbered from where each element's source landed (an offset
  // map from the splice) instead of reloading the page. Anything that cannot be
  // matched falls back to a reload.

  /** Run a DOM change the guest should not count as script activity. */
  function quietly(scope, fn) {
    const G = guest();
    const was = G.editing;
    G.editing = scope;
    try {
      fn();
    } finally {
      G.flush();
      G.editing = was;
    }
  }

  /** Make `parent`'s children exactly `kids`, moving only the nodes that are out of place. */
  function setChildren(parent, kids) {
    const want = new Set(kids);
    for (const n of [...parent.childNodes]) if (!want.has(n)) n.remove();
    let ref = parent.firstChild;
    for (const n of kids) {
      if (n === ref) ref = ref.nextSibling;
      else parent.insertBefore(n, ref);
    }
  }

  /**
   * Renumber the live page's data-src-id after a splice described by `map`
   * (old offsets -> new). `roots` are new material ({ nodes, start, end }): live
   * elements matched in order to the entries whose source starts in [start, end).
   */
  function restamp(prevA, map, roots = []) {
    const f = offsetMapper(map);
    const fresh = new Set(roots.flatMap((r) => r.nodes));
    const plan = [];
    for (const el of fdoc().querySelectorAll("[data-src-id]")) {
      if (fresh.has(el)) continue;
      const old = prevA.entries[Number(el.getAttribute("data-src-id"))];
      const at = old ? f(old.loc.startOffset) : null;
      const ne = at == null ? null : A.byStart.get(at);
      if (!ne || ne.tag.toLowerCase() !== old.tag.toLowerCase()) return false;
      plan.push([el, ne.id]);
    }
    for (const r of roots) {
      const news = A.entries.filter(
        (e) => e.loc.startOffset >= r.start && e.loc.startOffset < r.end,
      );
      if (
        news.length !== r.nodes.length ||
        news.some(
          (e, i) => e.tag.toLowerCase() !== r.nodes[i].tagName.toLowerCase(),
        )
      )
        return false;
      news.forEach((e, i) => plan.push([r.nodes[i], e.id]));
    }
    for (const [el, id] of plan)
      if (el.getAttribute("data-src-id") !== String(id))
        el.setAttribute("data-src-id", id);
    return true;
  }

  const exactlyPlaced = (res, regions) =>
    !res.external &&
    regions.every((r) =>
      res.placed.applied.some((a) => a.at === r.at && a.before === r.before),
    );

  /**
   * Write regions for a change already made to the live page (`live`: the parent's
   * children before and after, the offset map, new-material roots). Keeps the
   * page as it is when the ids can be renumbered, else reloads it. Returns the
   * write result plus `how` for the status line.
   */
  async function applyLive({ regions, label, key, live }) {
    const prevA = A;
    const res = await write({ regions, label, key });
    if (!res.ok) return res;
    const ok =
      exactlyPlaced(res, regions) && restamp(prevA, live.map, live.fwdRoots());
    if (ok) {
      undoStack.at(-1).live = live;
      verdictCacheReset();
    }
    if (!ok || live.reload) {
      if (ok) await reloadKeeping(src, selOffset());
      else await reloadKeeping(res.prev, selOffsetIn(prevA));
      return {
        ...res,
        how: ok
          ? "live, then reloaded for the page’s scripts"
          : "page reloaded",
      };
    }
    return { ...res, how: "live" };
  }

  /** The selection's source offset, read against an earlier index. */
  function selOffsetIn(prevA) {
    const id = sel?.getAttribute("data-src-id");
    const e = id != null ? prevA.entries[Number(id)] : null;
    return e ? e.loc.startOffset : null;
  }

  /**
   * Bring the live page in line with regions just written, without a reload:
   * attribute changes are copied onto the element, text changes go into its
   * text nodes, a <style> block gets its new text (the Tailwind build recompiles
   * it), and a text block whose inline markup changed is rebuilt from the file.
   * False when any region is something else (a script, a structural change
   * outside a text block): the caller reloads.
   */
  function patchLive(prevA, applied) {
    const d = fdoc();
    const sameCount = prevA.entries.length === A.entries.length;
    if (!sameCount && applied.length > 1) return false;
    for (const r of applied) {
      const a = r.atAfter + (r.pre ?? 0);
      const b = r.atAfter + r.after.length - (r.post ?? 0);
      const oldCore = r.before.slice(
        r.pre ?? 0,
        r.before.length - (r.post ?? 0),
      );
      const newCore = r.after.slice(r.pre ?? 0, r.after.length - (r.post ?? 0));
      let e = null;
      for (const x of A.entries)
        if (x.loc.startOffset <= a && b <= x.loc.endOffset) e = x;
      if (!e) return false;
      const el = d.querySelector(`[data-src-id="${e.id}"]`);
      const pe = prevA.byStart.get(e.loc.startOffset);
      if (!el || !pe || el.tagName.toLowerCase() !== e.tag.toLowerCase())
        return false;
      const tag = e.loc.startTag;
      if (a >= tag.startOffset && b <= tag.endOffset) {
        if (!sameCount) return false;
        syncAttrs(el, pe, e);
        continue;
      }
      if (e.tag === "script") return false;
      if (e.tag === "style") {
        const inner = innerRange(e);
        quietly(
          el,
          () => (el.textContent = A.src.slice(inner.start, inner.end)),
        );
        continue;
      }
      const markup = /[<>]/.test(oldCore + newCore);
      if (sameCount && !markup) {
        if (!restoreText(el, segments(A, e))) return false;
        continue;
      }
      // Inline markup changed inside a text block: rebuild its content from the file.
      if (textBlockFor(el) !== el || !pe.loc.endTag || !e.loc.endTag)
        return false;
      const oi = innerRange(pe);
      const ni = innerRange(e);
      const map = {
        at: oi.start,
        oldLen: oi.end - oi.start,
        newLen: ni.end - ni.start,
        maps: [],
      };
      const rebuild = () => {
        quietly(el, () => (el.innerHTML = A.src.slice(ni.start, ni.end)));
        return restamp(prevA, map, [
          {
            nodes: [...el.querySelectorAll("*")],
            start: ni.start,
            end: ni.end,
          },
        ]);
      };
      if (
        !restamp(prevA, map, [
          {
            nodes: [...el.querySelectorAll("*")],
            start: ni.start,
            end: ni.end,
          },
        ])
      ) {
        if (!rebuild()) return false;
      }
      // The ids line up, but the words may not: a region that spans the whole
      // element (a text edit's) changes only its text.
      if (
        el.textContent !== segments(A, e).text &&
        !restoreText(el, segments(A, e)) &&
        !rebuild()
      )
        return false;
    }
    verdictCacheReset();
    return true;
  }

  /** Copy the attributes that differ between two parses of the same start tag onto the live element. */
  function syncAttrs(el, pe, e) {
    const before = new Map(pe.node.attrs.map((x) => [x.name, x.value]));
    const after = new Map(e.node.attrs.map((x) => [x.name, x.value]));
    const G = guest();
    G.applying = true;
    for (const k of before.keys()) if (!after.has(k)) el.removeAttribute(k);
    for (const [k, v] of after) if (before.get(k) !== v) el.setAttribute(k, v);
    G.flush();
    G.applying = false;
  }

  // ---------------------------------------------------------------- ask + requests

  function noteFor(v) {
    return (
      {
        generated:
          "A script draws this, so it is not in the file as you see it. The agent will change the data or code behind it.",
        copied:
          "A script copies this from a template. The agent will change the source it is copied from.",
        changed:
          "A script rewrites this after the page loads, so a change here would be overwritten.",
        data: `This text also lives in the page's data (${v.shadows?.length ?? 0} ${v.shadows?.length === 1 ? "place" : "places"}), so the agent should change every copy.`,
        markup: "This text has markup the editor does not rewrite safely.",
        "script-class":
          "A script sets this element’s classes after the page loads, so a style change here would be undone.",
        "script-reads": `A script finds this by ${v.detail ?? "its attributes"}, so moving or removing it could break the page.`,
        "page-css":
          "The page’s own stylesheet decides this here, so a class has no effect. The agent can change the stylesheet.",
        responsive:
          "A screen-size rule sets this at the current width. The agent can change it for every size.",
        root: "This is the page itself.",
      }[v.reason] ?? ""
    );
  }

  function openAskFor(el) {
    const i = el === sel ? info : inspect(el);
    const verdict = i.blocked ?? {
      ok: true,
      entry: i.entry,
      status: i.kind === "text" ? "static" : "element",
      label: i.name,
    };
    openAsk(el, verdict, { note: i.blocked ? noteFor(i.blocked) : "" });
  }

  function offerAsk(el, op, reason) {
    const verdict = { ok: false, reason, entry: staticEntry(A, el).entry };
    openAsk(el, verdict, {
      note: noteFor(verdict),
      prefill: op.change,
      change: op.change,
    });
  }

  function openAsk(
    el,
    verdict,
    { note = "", edit = null, prefill = "", change = null } = {},
  ) {
    closeAsk();
    closeImgPop();
    asking = { el, verdict, edit, change };
    const kind = $(".kind", pop);
    kind.innerHTML = verdict.ok
      ? `${I.ask}<span>Ask Instrument</span>`
      : esc(REASONS[verdict.reason]);
    kind.className = `kind ${verdict.ok ? "" : "refuse"}`;
    $(".where", pop).textContent = verdict.ok
      ? (verdict.label ?? kindName(el))
      : "";
    $(".note", pop).hidden = !note;
    $(".note", pop).textContent = note;
    $("textarea", pop).value = prefill;
    pop.hidden = false;
    placeAsk();
    const ta = $("textarea", pop);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    layout();
  }

  function placeAsk() {
    if (!asking || pop.hidden) return;
    computePosition(refFor(asking.el), pop, {
      strategy: "fixed",
      placement: "bottom-start",
      middleware: [
        offset(10),
        flip({
          fallbackPlacements: ["top-start", "right-start", "left-start"],
          padding: { top: barH() + 8, bottom: 70, left: 10, right: 10 },
        }),
        shift({
          padding: {
            top: barH() + 8,
            left: 10,
            right: panelMode ? 300 : 10,
            bottom: 70,
          },
        }),
      ],
    }).then(({ x, y }) => {
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    });
  }

  function closeAsk() {
    if (!asking) return;
    asking = null;
    pop.hidden = true;
    afterBusy();
    layout();
  }

  pop.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("textarea", pop).value.trim();
    if (!text || !asking) return;
    const { el, verdict, edit, change } = asking;
    addRequest(el, verdict, text, edit, change);
    closeAsk();
  });
  $("textarea", pop).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      pop.requestSubmit();
    } else if (e.key === "Escape") closeAsk();
  });
  $("[data-cancel]", pop).onclick = closeAsk;

  function addRequest(el, verdict, instruction, edit, change) {
    const payload = buildRequest({
      A,
      path,
      el,
      verdict,
      instruction,
      edit,
      change,
    });
    const r = {
      n: nextN++,
      kind: edit ? "edit" : "ask",
      instruction,
      edit,
      change,
      payload,
      el,
      stale: false,
    };
    requests.push(r);
    renderPanel();
    layout();
    sendAsk(r);
    return r;
  }

  /**
   * Hands a request to the conversation: the element's source as written, by
   * its exact lines, and what the person asked. The pin stays on the page for
   * the rest of the session, so it can be found again.
   */
  function sendAsk(r) {
    const p = r.payload;
    const quote = p.anchorSnippet ? clip(p.anchorSnippet, 1200) : p.displayText;
    // What the quote alone does not say: a script makes or feeds this, and where.
    const context = p.text
      .split("\n")
      .filter(
        (line) =>
          /^(Status:|Fed by|Also appears|  line )/.test(line) &&
          !/static (text|element) in the file$/.test(line),
      )
      .join("\n");
    bridge.send({
      type: "ask",
      quote,
      lines: p.line != null && p.endLine != null ? [p.line, p.endLine] : null,
      note: context ? `${r.instruction}\n\n${context}` : r.instruction,
      instruction: r.instruction,
    });
    showToast(`Sent to Instrument · ${clip(r.instruction, 60)}`, {});
  }

  /** After the file changes, find each request's element again from its source snippet. */
  function repin() {
    const d = fdoc();
    for (const r of requests) {
      const p = r.payload;
      let el = null;
      if (p.anchorSnippet) {
        const at = findNearest(src, p.anchorSnippet, p.anchorStart);
        const entry = at >= 0 ? A.byStart.get(at) : null;
        if (entry) {
          p.anchorStart = at;
          const base = d.querySelector(`[data-src-id="${entry.id}"]`);
          el = base;
          if (p.generated && base) {
            const hit = [...base.querySelectorAll("*")].find(
              (n) => collapse(n.textContent) === p.liveText,
            );
            if (hit) el = textBlockFor(hit) ?? hit;
          }
        }
      } else {
        el =
          [...d.querySelectorAll(p.selector)].find(
            (n) => collapse(n.textContent) === p.liveText,
          ) ?? null;
      }
      r.el = el;
      r.stale = !el;
      if (el) {
        const i = inspect(el);
        const verdict = i.blocked ?? {
          ok: true,
          entry: i.entry,
          status: i.kind === "text" ? "static" : "element",
          label: i.name,
        };
        r.payload = buildRequest({
          A,
          path,
          el,
          verdict,
          instruction: r.instruction,
          edit: r.edit,
          change: r.change,
        });
      }
    }
    renderPanel();
    layout();
  }

  function renderPanel() {
    const list = $("#req-list");
    list.innerHTML = "";
    for (const r of requests) {
      const li = document.createElement("li");
      li.dataset.n = r.n;
      li.innerHTML = `<span class="pin num ${r.kind} ${r.stale ? "stale" : ""}">${r.n}</span><div><div class="instr"></div><div class="what"></div></div><button class="x" title="Remove">${I.close}</button>`;
      $(".instr", li).textContent = r.instruction;
      $(".what", li).append(
        clip(r.payload.displayText || kindName(r.el ?? document.body), 60),
      );
      const badge = document.createElement("span");
      badge.className = `badge ${r.stale ? "stale" : ""} ${r.kind}`;
      badge.textContent = r.stale
        ? "moved or gone"
        : r.kind === "edit"
          ? "Queued edit"
          : r.payload.label;
      $(".what", li).prepend(badge);
      li.onclick = (e) => {
        if (e.target.closest(".x")) {
          requests.splice(requests.indexOf(r), 1);
          renderPanel();
          layout();
          return;
        }
        if (r.el?.isConnected) {
          r.el.scrollIntoView({ block: "center", behavior: "smooth" });
          flashes.push({ el: r.el, until: Date.now() + 2200 });
          setTimeout(layout, 400);
        }
      };
      list.append(li);
    }
    $(".empty", panel).hidden = requests.length > 0;
    const count = $("#req-btn .count");
    count.textContent = requests.length;
    count.classList.toggle("has", requests.length > 0);
  }

  $("#req-btn").onclick = () =>
    setPanel(panelMode === "requests" ? null : "requests");
  $("#page-btn").onclick = () => {
    const showing = panelMode === "style" && !sel;
    select(null);
    setPanel(showing ? null : "style");
  };
  $("[data-close]", panel).onclick = () => setPanel(null);
  $("[data-close]", inspector).onclick = () => setPanel(null);

  // ---------------------------------------------------------------- live agent edits

  async function onExternalChange() {
    if (editing || asking || dragging) {
      pendingExternal = true;
      pill.hidden = false;
      bar.status(
        editing
          ? "Agent changed this page. Keep typing; your edit will be placed on top."
          : "Agent changed this page; it will reload when you finish.",
        "agent",
      );
      return;
    }
    serial(applyExternal);
  }

  async function applyExternal() {
    if (editing || asking || dragging) return;
    pendingExternal = false;
    pill.hidden = true;
    const next = doc.content;
    if (next === src) return;
    const prev = src;
    const off = selOffset();
    src = next;
    A = analyze(src);
    await mount({
      sel: off != null ? mapOffset(prev, src, off) : null,
      flash: changedRanges(prev, src),
      agent: true,
    });
  }

  function afterBusy() {
    if (pendingExternal && !editing && !asking && !dragging)
      serial(applyExternal);
  }

  /** Highlight the elements whose source changed; returns how many are visible. */
  function flashRanges(ranges, self = false) {
    const ids = new Set();
    for (const r of ranges) {
      let deepest = null;
      for (const e of A.entries) {
        const { startOffset: a, endOffset: b } = e.loc;
        if (a <= r.start && r.end <= b) deepest = e;
        else if (a >= r.start && b <= r.end && r.end > r.start) {
          const parent = e.node.parentNode?.__entry;
          if (!parent || parent.loc.startOffset < r.start) ids.add(e.id);
        }
      }
      if (deepest) ids.add(deepest.id);
    }
    const d = fdoc();
    let n = 0;
    for (const id of ids) {
      const el = d.querySelector(`[data-src-id="${id}"]`);
      if (
        !el ||
        !el.closest("body") ||
        ["BODY", "MAIN", "SCRIPT", "STYLE", "HEAD"].includes(el.tagName) ||
        !el.getClientRects().length
      )
        continue;
      flashes.push({ el, until: Date.now() + 2200, self });
      n++;
    }
    layout();
    setTimeout(layout, 2300);
    return n;
  }

  // ---------------------------------------------------------------- layout

  let raf = 0;
  function layout() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      placeAll();
    });
  }

  function rectOf(el) {
    if (!el?.isConnected || uiHost.contains(el)) return null;
    const r = el.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }

  function put(node, r, pad = 3) {
    node.style.left = `${r.left - pad}px`;
    node.style.top = `${r.top - pad}px`;
    node.style.width = `${r.width + pad * 2}px`;
    node.style.height = `${r.height + pad * 2}px`;
  }

  function placeAll() {
    const hr = hoverEl && hoverEl !== sel && rectOf(hoverEl);
    hoverBox.hidden = !hr;
    if (hr) {
      put(hoverBox, hr, 2);
      hoverBox.classList.toggle("below", hr.top < 28);
    }
    const target = editing?.el ?? sel;
    const sr = target && mode === "edit" && rectOf(target);
    selBox.hidden = !sr || dragging;
    if (sr) {
      put(selBox, sr, editing ? 4 : 2);
      selBox.className = `box sel${editing ? " editing" : ""}${info?.blocked ? " blocked" : ""}`;
    }
    if (editing && sr) {
      const below = sr.bottom + 10;
      hint.style.left = `${Math.max(8, sr.left - 4)}px`;
      hint.style.top = `${below + 34 > innerHeight - 70 ? sr.top - 40 : below}px`;
    }
    placeToolbar();
    placeAsk();
    gesture?.place();
    // Pins
    const stageW = innerWidth;
    pinsEl.innerHTML = "";
    for (const r of requests) {
      const rr = rectOf(r.el);
      if (!rr) continue;
      const ring = document.createElement("div");
      ring.className = `pin-ring ${r.kind}`;
      put(ring, rr, 2);
      const p = document.createElement("button");
      p.className = `pin ${r.kind} ${r.stale ? "stale" : ""}`;
      p.textContent = r.n;
      p.style.left = `${Math.min(rr.right, stageW - 14)}px`;
      p.style.top = `${Math.max(rr.top, 12)}px`;
      p.title = r.instruction;
      p.onclick = () => {
        setPanel("requests");
        for (const li of shadow.querySelectorAll("#req-list li"))
          li.classList.toggle("focus", Number(li.dataset.n) === r.n);
      };
      pinsEl.append(ring, p);
    }
    // Flashes
    const now = Date.now();
    flashes = flashes.filter((f) => f.until > now && f.el.isConnected);
    flashesEl.innerHTML = "";
    for (const f of flashes) {
      const fr = rectOf(f.el);
      if (!fr) continue;
      const box = document.createElement("div");
      box.className = `flash${f.self ? " self" : ""}`;
      box.style.animationDelay = `${-(2200 - (f.until - now))}ms`;
      put(box, fr, 4);
      flashesEl.append(box);
    }
  }

  addEventListener("resize", layout);

  // Clicking the host chrome ends a text edit, except inside the bubble menu.
  // Page clicks are the page listeners' to judge; this is for the editor's own UI.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!editing || !isOurs(e)) return;
      const t = e.composedPath()[0];
      if (editing.rich?.containsHost(t)) return;
      commitEdit();
    },
    true,
  );

  // ---------------------------------------------------------------- toast

  let toastTimer = 0;
  function showToast(
    msg,
    { undo: withUndo = false, redo: withRedo = false } = {},
  ) {
    $(".msg", toast).textContent = msg;
    $(".undo", toast).hidden = !withUndo;
    $(".redo", toast).hidden = !withRedo;
    toast.hidden = false;
    toast.classList.remove("in");
    void toast.offsetWidth;
    toast.classList.add("in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 6000);
  }
  $(".undo", toast).onclick = () => {
    toast.hidden = true;
    undo();
  };
  $(".redo", toast).onclick = () => {
    toast.hidden = true;
    redo();
  };

  // ---------------------------------------------------------------- boot

  $("#undo-btn").onclick = () => undo();
  $("#redo-btn").onclick = () => redo();
  $("#done-btn").onclick = () => leave();

  function applyPlacement(next) {
    placement = next === "pill" ? "pill" : "row";
    ui.dataset.placement = placement;
  }

  // The window's answers: a save's result, the file changing under the page,
  // where the Edit control is drawn, and Done pressed in the window.
  const replies = new Map();
  let nextReply = 1;
  const request = (message) =>
    new Promise((resolve) => {
      const id = nextReply++;
      replies.set(id, resolve);
      bridge.send({ ...message, id });
    });
  bridge.listen((message) => {
    if (message.type === "reply") {
      replies.get(message.id)?.(message.result);
      replies.delete(message.id);
    } else if (message.type === "external") {
      if (message.version === doc.version) return;
      doc.content = message.content;
      doc.version = message.version;
      onExternalChange();
    } else if (message.type === "placement") {
      applyPlacement(message.placement);
    } else if (message.type === "leave") {
      leave();
    }
  });

  const state = boot.state ?? {};
  applyPlacement(state.placement);
  doc = {
    original: state.doc?.original ?? boot.src,
    content: state.doc?.content ?? boot.src,
    version: state.doc?.version ?? boot.version,
    async save(next) {
      const result = await request({
        type: "save",
        content: next,
        baseVersion: doc.version,
      });
      if (!result.ok)
        return {
          ok: false,
          conflict: { content: result.content, version: result.version },
        };
      doc.content = next;
      doc.version = result.version;
      return { ok: true };
    },
  };
  src = boot.src;
  A = analyze(src);
  theme = readTheme(src);
  for (const op of state.undo ?? []) undoStack.push(op);
  for (const op of state.redo ?? []) redoStack.push(op);
  for (const r of state.requests ?? [])
    requests.push({ ...r, el: null, stale: false });
  nextN = state.nextN ?? nextN;

  document.documentElement.append(uiHost);
  wire();
  setMode("edit");
  renderPanel();
  updateUndoButtons();

  // The page may hold itself hidden until its styles are in; the scroll and the
  // selection are put back once it shows.
  {
    const t0 = performance.now();
    while (
      document.documentElement.classList.contains("instrument-wait") &&
      performance.now() - t0 < 8000
    )
      await sleep(16);
    await frames();
  }
  colors = resolveColors(document, colorNames());
  if (state.scroll) {
    scrollTo(state.scroll.x, state.scroll.y);
    await sleep(120);
    scrollTo(state.scroll.x, state.scroll.y);
  }
  repin();
  if (state.sel != null) reselectAt(state.sel);
  if (state.panel) setPanel(state.panel === "page" ? "style" : state.panel);
  if (state.flash) flashRanges(state.flash, state.flashSelf);
  if (state.agent) {
    pill.hidden = false;
    $(".text", pill).textContent = "Updated by Instrument";
    setTimeout(() => (pill.hidden = true), 2600);
  }
  layout();
  bridge.send({ type: "hello", version: doc.version, agent: !!state.agent });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    colors = resolveColors(document, colorNames());
    if (panelMode === "style") renderInspector();
  });

  // Hooks for scripted checks, reachable from this world only.
  window.__pageEditor = {
    get A() {
      return A;
    },
    patchLive,
    get src() {
      return src;
    },
    get doc() {
      return doc;
    },
    get requests() {
      return requests;
    },
    get sel() {
      return sel;
    },
    get info() {
      return info;
    },
    get editing() {
      return editing;
    },
    get undoStack() {
      return undoStack;
    },
    idle: () => chain,
    measure: () => measure(A, document),
    classify: (el) => classify(A, el),
    textBlockFor,
    select,
    setPanel,
    startEdit,
    commitEdit,
    structureOp,
    openAskFor,
    undo,
    redo,
    leave,
    shadow,
  };
}

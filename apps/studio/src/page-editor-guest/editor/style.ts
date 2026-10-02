/**
 * Styling from the dock's side panel: the Style panel for the selection
 * (class changes, written as a splice of the element's class attribute and
 * mirrored into the page's compiled stylesheet), the Page panel when nothing
 * is selected (theme tokens), live previews of both, and the probe that finds
 * which properties the page's own CSS keeps a class from changing.
 */
import { twMerge } from "tailwind-merge";

import { escapeRegExp, REASONS, staticEntry } from "./classify";
import {
  type Editor,
  type PanelMode,
  type Probe,
  type StyleApi,
} from "./context";
import { esc, find, findAs } from "./dom";
import { UI_ICONS as I } from "./icons";
import { noteFor } from "./notes";
import {
  previewText,
  readPage,
  renderPagePanel,
  type TokenSet,
  tokenSplices,
} from "./page-panel";
import { type Region, regionOf, withContext } from "./regions";
import { classAttr, classSplice, innerRange, type Splice } from "./source";
import {
  type BlockedBy,
  closePalette,
  probeClasses,
  renderStylePanel,
  type StyleOp,
} from "./style-panel";
import { resolveColors } from "./tokens";

const frames = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        r();
      }),
    ),
  );

/** Tailwind's breakpoints, in rem. */
const BP: Record<string, number> = {
  "2xl": 96,
  lg: 64,
  md: 48,
  sm: 40,
  xl: 80,
};

/**
 * `tokens` with `adds` merged in. A token a new class overrides is replaced in
 * place (so `mt-3` -> `mt-4` stays where it was written); a clear sentinel
 * removes what it overrides and is itself dropped.
 */
function mergeClasses(
  tokens: string[],
  adds: string[],
  clear: null | string = null,
) {
  let out = [...tokens];
  for (const add of adds) {
    const baseSet = new Set(twMerge(out.join(" ")).split(" "));
    const kept = new Set(twMerge(out.join(" "), add).split(" "));
    const next: string[] = [];
    let placed = false;
    for (const t of out) {
      if (t === add) {
        if (!placed && add !== clear) {
          next.push(t);
        }
        placed = true;
        continue;
      }
      if (!baseSet.has(t) || kept.has(t)) {
        next.push(t);
      } else if (!placed) {
        if (add !== clear) {
          next.push(add);
        }
        placed = true;
      }
    }
    if (!placed && add !== clear) {
      next.push(add);
    }
    out = next;
  }
  return out;
}
const mergeOp = (tokens: string[], op: StyleOp) =>
  mergeClasses(tokens, [op.add ?? op.clear ?? ""], op.clear ?? null);

const classTokens = (el: Element) =>
  (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

export function createStyle(ed: Editor): StyleApi {
  const { state, ui } = ed;
  const colorNames = () => [
    ...state.theme.semantic,
    ...state.theme.ramps.flatMap((r) => r.steps),
  ];

  function setPanel(next: null | PanelMode) {
    state.panelMode = next;
    closePalette();
    clearPreview();
    ui.panel.hidden = state.panelMode !== "requests";
    if (state.panelMode === "style") {
      renderInspector();
    } else {
      ui.inspector.hidden = true;
    }
    const isListOpen = state.panelMode === "requests";
    ui.reqBtn.classList.toggle("on", isListOpen);
    ui.reqBtn.setAttribute("aria-expanded", String(isListOpen));
    ui.reqBtn.title = isListOpen ? "Hide comments" : "Show comments";
    ui.pageBtn.classList.toggle(
      "on",
      state.panelMode === "style" && !state.sel,
    );
    ui.root.classList.toggle("panel-open", !!state.panelMode);
    ed.toolbar.render();
    ed.overlay.layout();
  }

  function renderInspector() {
    if (state.panelMode !== "style") {
      return;
    }
    const { inspector } = ui;
    inspector.hidden = false;
    const head = find(inspector, ".ins-head");
    const body = find(inspector, ".ins-body");
    closePalette();
    const { info, sel } = state;
    ui.pageBtn.classList.toggle("on", !sel);
    if (!sel || !info) {
      find(head, ".ins-title").textContent = "Page";
      find(head, ".ins-sub").textContent =
        "Accent, corners and type, for the whole page";
      renderPagePanel(body, {
        colorOf: (n) =>
          state.colors.get(n.replace(/^color-/, "")) ?? "transparent",
        onPreview: pagePreview,
        onSet: (sets, label) => {
          void ed.serial(() => pageOp(sets, label));
        },
        page: readPage(state.A),
      });
      return;
    }
    find(head, ".ins-title").textContent = info.name;
    find(head, ".ins-sub").textContent = "Saves to the page as you go";
    const blocked = info.blocked ?? (info.style.ok ? null : info.style);
    if (blocked || !info.style.ok) {
      const why = blocked
        ? `<b>${esc(REASONS[blocked.reason])}.</b> ${esc(noteFor(blocked))}`
        : "";
      body.innerHTML = `<div class="ins-blocked"><p>${why}</p><button type="button" class="primary agent">${I.ask}<span>Ask</span></button></div>`;
      findAs(body, "button", HTMLButtonElement).addEventListener(
        "click",
        () => {
          ed.asks.openAskFor(sel);
        },
      );
      return;
    }
    const tokens = classAttr(state.A, info.style.entry).tokens;
    renderStylePanel(body, {
      blocked: state.probe?.el === sel ? state.probe.blocked : null,
      colors: state.colors,
      el: sel,
      kind: info.kind,
      name: info.name.toLowerCase(),
      onAsk: ({ change, reason }) => {
        ed.asks.offerAsk(sel, change, reason ?? "page-css");
      },
      onOp: (op) => {
        void ed.serial(() => styleOp(op));
      },
      onPreview: setPreview,
      paletteHost: ui.layer,
      theme: state.theme,
      tokens,
    });
  }

  /** Show token values on the live page without writing them (the custom accent picker while dragging). */
  function pagePreview(sets: TokenSet[]) {
    const page = readPage(state.A);
    const tw =
      page &&
      document.querySelector(`[data-src-id="${page.blocks[0].entry.id}"]`);
    if (!page || !tw) {
      return;
    }
    ed.live.quietly(tw, () => {
      tw.textContent = previewText(state.A, page, sets);
    });
  }

  /** Write page tokens (both blocks) and let the live page recompile its styles. */
  async function pageOp(sets: TokenSet[], label: string) {
    const page = readPage(state.A);
    if (!page) {
      return;
    }
    const t0 = performance.now();
    const splices = tokenSplices(state.A, page.blocks, sets).sort(
      (a, b) => a.start - b.start,
    );
    if (splices.length === 0) {
      return;
    }
    // Nearby splices share a region, so their context never overlaps.
    const groups: { end: number; splices: Splice[]; start: number }[] = [];
    for (const sp of splices) {
      const g = groups.at(-1);
      if (g && sp.start - g.end < 160) {
        g.end = Math.max(g.end, sp.end);
        g.splices.push(sp);
      } else {
        groups.push({ end: sp.end, splices: [sp], start: sp.start });
      }
    }
    const prevA = state.A;
    const res = await ed.history.write({
      key: `page:${sets[0]?.[0] ?? ""}`,
      label,
      regions: groups.map((g) =>
        regionOf(state.src, g.start, g.end, g.splices),
      ),
    });
    if (!res.ok) {
      ed.status(
        "Could not save: the agent changed the page’s theme block",
        "warn",
      );
      return;
    }
    if (res.external || !ed.live.patchLive(prevA, res.placed.applied)) {
      await ed.reload.reloadKeeping(res.prev);
    }
    await refreshColors();
    ed.overlay.showToast(label, { undo: true });
    ed.status(
      `Saved ${label} · ${splices.length} token value${splices.length === 1 ? "" : "s"} in ${page.blocks.length === 2 ? "the theme block and its compiled copy" : "the theme block"} · ${Math.round(performance.now() - t0)} ms`,
    );
  }

  /** Re-read the page's resolved token colors once its styles have recompiled. */
  async function refreshColors() {
    await frames();
    await frames();
    state.colors = resolveColors(document, colorNames());
    if (state.panelMode === "style") {
      renderInspector();
    }
  }

  function setPreview(prop: null | string, value?: string) {
    if (!prop || value == null) {
      clearPreview();
      return;
    }
    const { sel } = state;
    if (!sel) {
      return;
    }
    if (state.preview?.el !== sel || state.preview.prop !== prop) {
      clearPreview();
      state.preview = {
        el: sel,
        priority: sel.style.getPropertyPriority(prop),
        prop,
        saved: sel.style.getPropertyValue(prop),
      };
    }
    sel.style.setProperty(prop, value, "important");
  }

  function clearPreview() {
    if (!state.preview) {
      return;
    }
    const { el, priority, prop, saved } = state.preview;
    state.preview = null;
    if (saved) {
      el.style.setProperty(prop, saved, priority);
    } else {
      el.style.removeProperty(prop);
    }
    if (el.getAttribute("style") === "") {
      el.removeAttribute("style");
    }
  }

  /**
   * Which properties a utility class cannot change on this element: a hidden
   * shallow copy next to it gets one probe class per property, and whatever
   * does not take the probe's value is decided by the page's own CSS
   * (unlayered rules beat Tailwind's layers) or by a screen-size variant.
   */
  function startProbe(el: HTMLElement) {
    const p: Probe = { blocked: null, el, promise: Promise.resolve() };
    state.probe = p;
    p.promise = (async () => {
      await frames();
      if (state.probe !== p || !el.isConnected) {
        return;
      }
      const probes = probeClasses(getComputedStyle(el));
      const clone = el.cloneNode(false);
      if (!(clone instanceof HTMLElement)) {
        return;
      }
      clone.removeAttribute("id");
      clone.removeAttribute("data-src-id");
      clone.setAttribute("data-editor-guest", "");
      clone.setAttribute("aria-hidden", "true");
      clone.style.setProperty("position", "absolute", "important");
      clone.style.setProperty("visibility", "hidden", "important");
      clone.style.setProperty("pointer-events", "none", "important");
      clone.setAttribute(
        "class",
        mergeClasses(
          classTokens(el),
          probes.map((x) => x[1]),
        ).join(" "),
      );
      ed.live.withAttributes(() => {
        el.after(clone);
      });
      const ccs = getComputedStyle(clone);
      const hit = ([prop, , want]: [string, string, string]) =>
        prop === "box-shadow"
          ? ccs.getPropertyValue(prop).includes(want)
          : ccs.getPropertyValue(prop) === want;
      const t0 = performance.now();
      while (performance.now() - t0 < 900 && !probes.some(hit)) {
        await frames();
      }
      await frames();
      const blocked = new Map<string, BlockedBy>();
      const s = staticEntry(state.A, el);
      const tokens = s.entry ? classAttr(state.A, s.entry).tokens : [];
      for (const pr of probes) {
        if (!hit(pr)) {
          blocked.set(pr[0], blockReason(tokens, pr[1]));
        }
      }
      clone.remove();
      ed.watch.flush();
      p.blocked = blocked;
      if (
        state.probe === p &&
        state.panelMode === "style" &&
        state.sel === el
      ) {
        renderInspector();
      }
    })();
  }

  function setLiveClass(el: Element, value: string) {
    ed.live.withAttributes(() => {
      if (value) {
        el.setAttribute("class", value);
      } else {
        el.removeAttribute("class");
      }
    });
  }

  async function styleOp(op: StyleOp) {
    const el = state.sel;
    if (!el || !state.info?.styleOk) {
      return;
    }
    const entry = staticEntry(state.A, el).entry;
    if (!entry) {
      return;
    }
    const { probe } = state;
    if (probe?.el === el) {
      await probe.promise;
    }
    const liveTokens = classTokens(el);
    const before = op.props.map((p) =>
      getComputedStyle(el).getPropertyValue(p),
    );
    setLiveClass(el, mergeOp(liveTokens, op).join(" "));
    const changed = await waitChange(el, op.props, before, 700);
    const probed =
      state.probe?.el === el
        ? op.props.map((p) => state.probe?.blocked?.get(p)).find(Boolean)
        : "page-css";
    if (!changed && probed) {
      setLiveClass(el, liveTokens.join(" "));
      ed.status(
        `${op.label}: no visible change, the page’s own CSS decides this`,
        "warn",
      );
      ed.asks.offerAsk(el, op.change, probed);
      return;
    }
    state.verdictCache.delete(el);
    const srcTokens = classAttr(state.A, entry).tokens;
    const nextSrc = mergeOp(srcTokens, op);
    const sp = classSplice(state.A, entry, nextSrc.join(" "));
    if (!sp) {
      return;
    }
    const tag = entry.loc.startTag;
    const regions = [regionOf(state.src, tag.startOffset, tag.endOffset, [sp])];
    const floor = floorRegion(nextSrc.filter((t) => !srcTokens.includes(t)));
    if (floor.region) {
      regions.push(floor.region);
    }
    const res = await ed.history.write({
      key: `style:${entry.loc.startOffset}:${op.key}`,
      label: op.label,
      merge: !floor.region,
      regions,
    });
    if (!res.ok) {
      setLiveClass(el, liveTokens.join(" "));
      ed.asks.toAgentChange(
        el,
        op.change,
        "the agent changed this part of the page",
      );
      return;
    }
    if (res.external) {
      await ed.reload.reloadKeeping(res.prev);
    } else if (state.sel) {
      state.info = ed.selection.inspect(state.sel);
      renderInspector();
      ed.toolbar.render();
      ed.overlay.layout();
    }
    const floorNote = floor.region
      ? " · thumbnail CSS updated"
      : floor.missing?.length
        ? " · thumbnail CSS could not be updated"
        : "";
    ed.overlay.showToast(op.label, { undo: true });
    ed.status(
      `Saved ${op.label} (1 class attribute${floor.region ? " + 1 line of the compiled stylesheet" : ""})${floorNote}`,
    );
  }

  /**
   * The page ships a compiled Tailwind "floor" (`<style data-tailwind="compiled">`)
   * for renderers that never run its scripts (thumbnails, Quick Look). A class
   * it does not contain is copied in from the rules the page's browser build
   * just generated, so the file renders the edit with scripts off too.
   */
  function floorRegion(added: string[]): {
    missing?: string[];
    region?: Region;
  } {
    const { A, src } = state;
    const floor = A.entries.find(
      (e) =>
        e.tag === "style" &&
        e.node.attrs.some(
          (a) => a.name === "data-tailwind" && a.value === "compiled",
        ),
    );
    const inner = floor ? innerRange(floor) : null;
    if (!floor || !inner || added.length === 0) {
      return {};
    }
    const text = src.slice(inner.start, inner.end);
    const missing = added.filter(
      (c) => !new RegExp(`\\.${escapeRegExp(CSS.escape(c))}\\s*\\{`).test(text),
    );
    if (missing.length === 0) {
      return {};
    }
    const rules: string[] = [];
    for (const c of missing) {
      const selector = `.${CSS.escape(c)}`;
      for (const sheet of document.styleSheets) {
        const owner = sheet.ownerNode;
        if (
          owner instanceof Element &&
          owner.matches('style[data-tailwind="compiled"]')
        ) {
          continue;
        }
        let hit = null;
        try {
          hit = findRule(sheet.cssRules, selector);
        } catch {
          // A cross-origin sheet's rules cannot be read.
        }
        if (hit) {
          rules.push(hit);
          break;
        }
      }
    }
    if (rules.length === 0) {
      return { missing };
    }
    const at = src.lastIndexOf("\n", inner.end - 1) + 1;
    const tail = src.slice(at, floor.loc.endOffset);
    return {
      missing,
      region: withContext(src, {
        after: `@layer utilities { ${rules.join(" ")} }\n${tail}`,
        at,
        before: tail,
      }),
    };
  }

  return { clearPreview, refreshColors, renderInspector, setPanel, startProbe };
}

function blockReason(tokens: string[], cls: string): BlockedBy {
  for (const t of tokens) {
    const m = /^(sm|md|lg|xl|2xl):(.+)$/.exec(t);
    const bp = m?.[1] === undefined ? undefined : BP[m[1]];
    const base = m?.[2];
    if (
      bp === undefined ||
      base === undefined ||
      !matchMedia(`(min-width: ${bp}rem)`).matches
    ) {
      continue;
    }
    if (!twMerge(`${base} ${cls}`).split(" ").includes(base)) {
      return "responsive";
    }
  }
  return "page-css";
}

/** The text of the rule for exactly `selector`, searching nested rules too. */
function findRule(list: CSSRuleList, selector: string): null | string {
  for (const r of list) {
    if (r instanceof CSSStyleRule && r.selectorText === selector) {
      return r.cssText;
    }
    if (r instanceof CSSGroupingRule || r instanceof CSSStyleRule) {
      const f = findRule(r.cssRules, selector);
      if (f) {
        return f;
      }
    }
  }
  return null;
}

async function waitChange(
  el: Element,
  props: string[],
  before: string[],
  ms: number,
) {
  const c = getComputedStyle(el);
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (props.some((p, i) => c.getPropertyValue(p) !== before[i])) {
      return true;
    }
    await frames();
  }
  return false;
}

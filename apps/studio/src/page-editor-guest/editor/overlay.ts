/**
 * The overlay drawn over the page: the hover and selection outlines, the
 * edit hint, the asks' pins, the flashes on what just changed, and the toast.
 * Everything is placed in viewport coordinates once a frame, whenever
 * anything asks for `layout()`.
 */
import { type Editor, type OverlayApi } from "./context";
import { find } from "./dom";
import { type Range } from "./source";

export function createOverlay(ed: Editor): OverlayApi {
  const { state, ui } = ed;
  let raf = 0;
  let toastTimer = 0;

  function layout() {
    if (raf) {
      return;
    }
    raf = requestAnimationFrame(() => {
      raf = 0;
      placeAll();
    });
  }

  function rectOf(el: Element | null) {
    if (!el?.isConnected || ed.uiHost.contains(el)) {
      return null;
    }
    const r = el.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }

  function placeAll() {
    const { editing, hoverEl, sel } = state;
    const hr = hoverEl && hoverEl !== sel ? rectOf(hoverEl) : null;
    ui.hoverBox.hidden = !hr;
    if (hr) {
      put(ui.hoverBox, hr, 2);
      ui.hoverBox.classList.toggle("below", hr.top < 28);
    }
    const target = editing?.el ?? sel;
    const sr = target ? rectOf(target) : null;
    ui.selBox.hidden = !sr || state.dragging;
    if (sr) {
      put(ui.selBox, sr, editing ? 4 : 2);
      ui.selBox.className = `box sel${editing ? " editing" : ""}${state.info?.blocked ? " blocked" : ""}`;
    }
    if (editing && sr) {
      const below = sr.bottom + 10;
      ui.hint.style.left = `${Math.max(8, sr.left - 4)}px`;
      ui.hint.style.top = `${below + 34 > innerHeight - 70 ? sr.top - 40 : below}px`;
    }
    ed.toolbar.place();
    ed.asks.placeAsk();
    state.gesture?.place();
    // Pins
    const stageW = innerWidth;
    ui.pins.innerHTML = "";
    for (const r of state.requests) {
      const rr = rectOf(r.el);
      if (!rr) {
        continue;
      }
      const ring = document.createElement("div");
      ring.className = `pin-ring ${r.kind}`;
      put(ring, rr, 2);
      const p = document.createElement("button");
      p.className = `pin ${r.kind} ${r.stale ? "stale" : ""}`;
      p.textContent = String(r.n);
      p.style.left = `${Math.min(rr.right, stageW - 14)}px`;
      p.style.top = `${Math.max(rr.top, 12)}px`;
      p.title = r.instruction;
      p.addEventListener("click", () => {
        ed.style.setPanel("requests");
        for (const li of ui.reqList.querySelectorAll<HTMLElement>("li")) {
          li.classList.toggle("focus", Number(li.dataset.n) === r.n);
        }
      });
      ui.pins.append(ring, p);
    }
    // Flashes
    const now = Date.now();
    state.flashes = state.flashes.filter(
      (f) => f.until > now && f.el.isConnected,
    );
    ui.flashes.innerHTML = "";
    for (const f of state.flashes) {
      const fr = rectOf(f.el);
      if (!fr) {
        continue;
      }
      const box = document.createElement("div");
      box.className = `flash${f.self ? " self" : ""}`;
      box.style.animationDelay = `${-(2200 - (f.until - now))}ms`;
      put(box, fr, 4);
      ui.flashes.append(box);
    }
  }

  function flash(el: Element, ms: number, self?: boolean) {
    state.flashes.push({ el, self, until: Date.now() + ms });
  }

  /** Highlight the elements whose source changed. */
  function flashRanges(ranges: Range[], self = false) {
    const { A } = state;
    const ids = new Set<number>();
    for (const r of ranges) {
      let deepest = null;
      for (const e of A.entries) {
        const { endOffset: b, startOffset: a } = e.loc;
        if (a <= r.start && r.end <= b) {
          deepest = e;
        } else if (a >= r.start && b <= r.end && r.end > r.start) {
          const parentNode = e.node.parentNode;
          const parent =
            parentNode && "tagName" in parentNode
              ? A.byNode.get(parentNode)
              : undefined;
          if (!parent || parent.loc.startOffset < r.start) {
            ids.add(e.id);
          }
        }
      }
      if (deepest) {
        ids.add(deepest.id);
      }
    }
    for (const id of ids) {
      const el = document.querySelector(`[data-src-id="${id}"]`);
      if (
        !el?.closest("body") ||
        ["BODY", "HEAD", "MAIN", "SCRIPT", "STYLE"].includes(el.tagName) ||
        el.getClientRects().length === 0
      ) {
        continue;
      }
      flash(el, 2200, self);
    }
    layout();
    setTimeout(layout, 2300);
  }

  function showToast(
    msg: string,
    { redo: withRedo = false, undo: withUndo = false } = {},
  ) {
    const { toast } = ui;
    find(toast, ".msg").textContent = msg;
    find(toast, ".undo").hidden = !withUndo;
    find(toast, ".redo").hidden = !withRedo;
    toast.hidden = false;
    toast.classList.remove("in");
    // Reading its layout restarts the entrance animation.
    toast.getBoundingClientRect();
    toast.classList.add("in");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 6000);
  }

  function init() {
    addEventListener("resize", layout);
    find(ui.toast, ".undo").addEventListener("click", () => {
      ui.toast.hidden = true;
      void ed.history.undo();
    });
    find(ui.toast, ".redo").addEventListener("click", () => {
      ui.toast.hidden = true;
      void ed.history.redo();
    });
  }

  return { flash, flashRanges, init, layout, rectOf, showToast };
}

/** Place `node` over `r`, grown by `pad` on every side. */
function put(node: HTMLElement, r: DOMRect, pad = 3) {
  node.style.left = `${r.left - pad}px`;
  node.style.top = `${r.top - pad}px`;
  node.style.width = `${r.width + pad * 2}px`;
  node.style.height = `${r.height + pad * 2}px`;
}

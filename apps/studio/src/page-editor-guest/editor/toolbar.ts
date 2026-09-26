/**
 * The floating toolbar over the selection: its name (a breadcrumb of the
 * selection's ancestors opens from it), then what can be done here, or the
 * lock and the reason with only Ask when the element is the agent's. Its
 * buttons' tooltips say why a disabled one is off.
 */
import { computePosition, flip, offset, shift } from "@floating-ui/dom";

import { kindName, REASONS } from "./classify";
import { type Editor, type ToolbarApi } from "./context";
import { closestIn, esc } from "./dom";
import { UI_ICONS as I } from "./icons";
import { noteFor, structWhy } from "./notes";

export function createToolbar(ed: Editor): ToolbarApi {
  const { state, ui } = ed;
  const { crumbs, tb, tip } = ui;
  let tipTimer = 0;
  let crumbTimer = 0;

  function render() {
    hideCrumbs();
    hideTip();
    const i = state.info;
    if (!state.sel || !i || state.editing || state.dragging) {
      tb.hidden = true;
      return;
    }
    let html = `<button type="button" class="tb-name" data-act="crumbs" data-tip="Select a parent · Esc or ⌘↑">${esc(i.name)}${I.chevron}</button>`;
    if (i.blocked) {
      html += `<span class="tb-reason">${I.lock}${esc(REASONS[i.blocked.reason])}</span>`;
      html += `<button type="button" class="tb-ask solo" data-act="ask" data-tip="${esc(noteFor(i.blocked))}">${I.ask}<span>Ask</span></button>`;
    } else {
      html += '<span class="tb-sep"></span>';
      if (i.kind === "text" && i.textOk) {
        html += `<button type="button" data-act="edit" data-tip="Edit text · double-click or ↵">${I.edit}<span>Edit</span></button>`;
      }
      if (i.kind === "image" && i.imageOk) {
        html += `<button type="button" data-act="replace" data-tip="Replace image">${I.image}<span>Replace</span></button>`;
      }
      html += `<button type="button" data-act="style" class="${state.panelMode === "style" ? "on" : ""}" data-tip="Style">${I.style}<span>Style</span></button>`;
      html += '<span class="tb-sep"></span>';
      const { struct } = i;
      const off = (act: "delete" | "duplicate") =>
        struct.ok
          ? ""
          : ` aria-disabled="true" data-off="${esc(structWhy(struct, act))}"`;
      html += `<button type="button" class="tb-icon" data-act="duplicate" data-tip="Duplicate · ⌘D"${off("duplicate")}>${I.dup}</button>`;
      html += `<button type="button" class="tb-icon" data-act="delete" data-tip="Delete · ⌫"${off("delete")}>${I.trash}</button>`;
      html += '<span class="tb-sep"></span>';
      html += `<button type="button" class="tb-ask" data-act="ask" data-tip="Ask about this">${I.ask}<span>Ask</span></button>`;
    }
    tb.innerHTML = html;
    tb.hidden = false;
    place();
  }

  /** A small label under a toolbar button; a disabled one says why it is off. */
  function showTip(b: HTMLElement, now = false) {
    clearTimeout(tipTimer);
    const why = b.dataset.off;
    const text = b.dataset.tip;
    if (!text && !why) {
      hideTip();
      return;
    }
    const run = () => {
      const [name = "", keys] = (text ?? "").split(" · ");
      tip.innerHTML = why
        ? `<b>Can’t ${esc(b.dataset.act ?? "")}</b><span>${esc(why)} Ask Instrument instead.</span>`
        : `<span class="t">${esc(name)}</span>${keys ? `<kbd>${esc(keys)}</kbd>` : ""}`;
      tip.className = why ? "why" : "";
      tip.hidden = false;
      void computePosition(b, tip, {
        middleware: [
          offset(7),
          flip({ padding: { bottom: 70, top: 6 } }),
          shift({ padding: 8 }),
        ],
        placement: tb.dataset.placement?.startsWith("bottom")
          ? "bottom"
          : "top",
        strategy: "fixed",
      }).then(({ x, y }) => {
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
      });
    };
    if (now || why || !tip.hidden) {
      run();
    } else {
      tipTimer = window.setTimeout(run, 450);
    }
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tip.hidden = true;
  }

  // The element's ancestors, outermost first, as a breadcrumb under its name.
  function showCrumbs() {
    clearTimeout(crumbTimer);
    const { info, sel } = state;
    if (!sel || !info || !crumbs.hidden) {
      return;
    }
    hideTip();
    const list = ed.selection.ancestors(sel).slice(0, 5).reverse();
    if (list.length === 0) {
      return;
    }
    crumbs.replaceChildren();
    crumbs.insertAdjacentHTML(
      "beforeend",
      '<span class="c-head">Select</span>',
    );
    for (const el of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = kindName(el);
      b.addEventListener("mouseenter", () => {
        const q = ed.selection.quick(el);
        ed.selection.setHover(el, q.blocked ? "refuse" : "edit", "");
      });
      b.addEventListener("mouseleave", () => {
        ed.selection.setHover(null);
      });
      b.addEventListener("click", () => {
        ed.selection.select(el);
      });
      const sep = document.createElement("span");
      sep.className = "c-sep";
      sep.textContent = "›";
      crumbs.append(b, sep);
    }
    crumbs.insertAdjacentHTML(
      "beforeend",
      `<span class="c-here">${esc(info.name)}</span>`,
    );
    crumbs.hidden = false;
    const name = tb.querySelector(".tb-name");
    if (!name) {
      return;
    }
    void computePosition(name, crumbs, {
      middleware: [
        offset(9),
        flip({ padding: { bottom: 70, top: 6 } }),
        shift({ padding: 8 }),
      ],
      placement: tb.dataset.placement?.startsWith("bottom")
        ? "bottom-start"
        : "top-start",
      strategy: "fixed",
    }).then(({ x, y }) => {
      crumbs.style.left = `${x}px`;
      crumbs.style.top = `${y}px`;
    });
  }
  function hideCrumbs() {
    clearTimeout(crumbTimer);
    if (crumbs.hidden) {
      return;
    }
    crumbs.hidden = true;
    ed.selection.setHover(null);
  }
  const crumbsLater = () => {
    clearTimeout(crumbTimer);
    crumbTimer = window.setTimeout(hideCrumbs, 220);
  };

  function place() {
    const { sel } = state;
    if (tb.hidden || !sel?.isConnected) {
      return;
    }
    const r = sel.getBoundingClientRect();
    const visible =
      r.bottom > 0 && r.top < innerHeight && r.width + r.height > 0;
    tb.style.visibility = visible ? "" : "hidden";
    void computePosition(
      { getBoundingClientRect: () => sel.getBoundingClientRect() },
      tb,
      {
        middleware: [
          offset(8),
          flip({
            fallbackPlacements: ["bottom-start", "top-end", "bottom-end"],
            padding: { bottom: 70, left: 8, right: 8, top: 8 },
          }),
          shift({
            crossAxis: true,
            padding: {
              bottom: 70,
              left: 8,
              right: state.panelMode ? 300 : 8,
              top: 8,
            },
          }),
        ],
        placement: "top-start",
        strategy: "fixed",
      },
    ).then(({ placement, x, y }) => {
      tb.style.left = `${x}px`;
      tb.style.top = `${y}px`;
      tb.dataset.placement = placement;
    });
  }

  function init() {
    tb.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    tb.addEventListener("click", (e) => {
      const b = closestIn(e, "[data-act]");
      const act = b?.dataset.act;
      const { sel } = state;
      if (!b || !act || !sel) {
        return;
      }
      if (b.getAttribute("aria-disabled") === "true") {
        showTip(b, true);
        return;
      }
      if (act === "crumbs") {
        if (crumbs.hidden) {
          showCrumbs();
        } else {
          hideCrumbs();
        }
        return;
      }
      switch (act) {
        case "ask": {
          ed.asks.openAskFor(sel);

          break;
        }
        case "delete":
        case "duplicate": {
          ed.structure.structureOp(act);

          break;
        }
        case "edit": {
          ed.text.startEdit(sel, "end");

          break;
        }
        case "replace": {
          ed.image.openImgPop();

          break;
        }
        case "style": {
          ed.style.setPanel(state.panelMode === "style" ? null : "style");

          break;
        }
        // No default
      }
    });
    tb.addEventListener("mouseover", (e) => {
      const b = closestIn(e, "[data-act]");
      if (!b || b.dataset.act === "crumbs") {
        hideTip();
        return;
      }
      showTip(b);
    });
    tb.addEventListener("mouseleave", hideTip);
    tb.addEventListener("mouseover", (e) => {
      if (closestIn(e, ".tb-name")) {
        clearTimeout(crumbTimer);
        crumbTimer = window.setTimeout(showCrumbs, 180);
      } else if (!crumbs.hidden) {
        crumbsLater();
      }
    });
    tb.addEventListener("mouseleave", crumbsLater);
    crumbs.addEventListener("mouseenter", () => {
      clearTimeout(crumbTimer);
    });
    crumbs.addEventListener("mouseleave", crumbsLater);
    crumbs.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
  }

  return {
    crumbsOpen: () => !crumbs.hidden,
    hideCrumbs,
    init,
    place,
    render,
  };
}

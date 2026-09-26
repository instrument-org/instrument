/**
 * Asks: what the person leaves for the agent about an element. The popover
 * where one is written, the request built for it and handed to the window
 * (which stages it beside the file's other asks), the pins that keep each on
 * its element as the page changes, and the dock's list of those still
 * waiting to go to a chat. An edit the editor cannot write becomes one too.
 */
import { computePosition, flip, offset, shift } from "@floating-ui/dom";

import {
  kindName,
  type Reason,
  REASONS,
  staticEntry,
  textBlockFor,
} from "./classify";
import {
  type AskRequest,
  type AsksApi,
  type Editor,
  type EditSession,
} from "./context";
import { closestIn, esc, find, findAs } from "./dom";
import { UI_ICONS as I } from "./icons";
import { noteFor } from "./notes";
import {
  type AskVerdict,
  buildRequest,
  clip,
  collapse,
  type TextEdit,
} from "./payload";
import { findNearest } from "./source";

export function createAsks(ed: Editor): AsksApi {
  const { state, ui } = ed;
  const { pop } = ui;
  const textarea = findAs(pop, "textarea", HTMLTextAreaElement);

  /**
   * The verdict an ask about an element starts from: why it is the agent's,
   * or what it is. The selection's is read from what the toolbar shows.
   */
  function verdictFor(el: Element, fresh = false): AskVerdict {
    const i =
      !fresh && el === state.sel && state.info
        ? state.info
        : ed.selection.inspect(el);
    return (
      i.blocked ?? {
        entry: i.entry,
        label: i.name,
        ok: true,
        status: i.kind === "text" ? "static" : "element",
      }
    );
  }

  function openAskFor(el: HTMLElement) {
    const verdict = verdictFor(el);
    openAsk(el, verdict, { note: verdict.ok ? "" : noteFor(verdict) });
  }

  function offerAsk(el: HTMLElement, change: string, reason: Reason) {
    const verdict: AskVerdict = {
      entry: staticEntry(state.A, el).entry,
      ok: false,
      reason,
    };
    openAsk(el, verdict, { change, note: noteFor(verdict), prefill: change });
  }

  function openAsk(
    el: HTMLElement,
    verdict: AskVerdict,
    {
      change = null,
      note = "",
      prefill = "",
    }: { change?: null | string; note?: string; prefill?: string },
  ) {
    closeAsk();
    ed.image.closeImgPop();
    state.asking = { change, el, verdict };
    const kind = find(pop, ".kind");
    kind.innerHTML = verdict.ok
      ? `${I.ask}<span>Ask</span>`
      : esc(REASONS[verdict.reason]);
    kind.className = `kind ${verdict.ok ? "" : "refuse"}`;
    find(pop, ".where").textContent = verdict.ok ? verdict.label : "";
    const noteEl = find(pop, ".note");
    noteEl.hidden = !note;
    noteEl.textContent = note;
    textarea.value = prefill;
    pop.hidden = false;
    placeAsk();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    ed.overlay.layout();
  }

  function placeAsk() {
    const { asking } = state;
    if (!asking || pop.hidden) {
      return;
    }
    void computePosition(
      { getBoundingClientRect: () => asking.el.getBoundingClientRect() },
      pop,
      {
        middleware: [
          offset(10),
          flip({
            fallbackPlacements: ["top-start", "right-start", "left-start"],
            padding: { bottom: 70, left: 10, right: 10, top: 8 },
          }),
          shift({
            padding: {
              bottom: 70,
              left: 10,
              right: state.panelMode === "style" ? 300 : 10,
              top: 8,
            },
          }),
        ],
        placement: "bottom-start",
        strategy: "fixed",
      },
    ).then(({ x, y }) => {
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    });
  }

  function closeAsk() {
    if (!state.asking) {
      return;
    }
    state.asking = null;
    pop.hidden = true;
    ed.reload.afterBusy();
    ed.overlay.layout();
  }

  function addRequest(
    el: Element,
    verdict: AskVerdict,
    instruction: string,
    edit: null | TextEdit,
    change: null | string,
  ) {
    const payload = buildRequest({
      A: state.A,
      change,
      edit,
      el,
      instruction,
      path: ed.path,
      verdict,
    });
    const r: AskRequest = {
      change,
      edit,
      el,
      id: crypto.randomUUID(),
      instruction,
      kind: edit ? "edit" : "ask",
      n: state.nextN++,
      payload,
      stale: false,
    };
    state.requests.push(r);
    renderPanel();
    ed.overlay.layout();
    sendAsk(r);
  }

  /**
   * Hands a request to the window, which stages it beside the file's other
   * asks until the person moves them into a chat: the element's source as
   * written, by its exact lines, what it is, and what the person asked. The
   * pin stays on the page for as long as the window holds the ask, so it can
   * be found again.
   */
  function sendAsk(r: AskRequest) {
    const p = r.payload;
    const quote = p.anchorSnippet ? clip(p.anchorSnippet, 1200) : p.displayText;
    // What the quote alone does not say: a script makes or feeds this, and where.
    const context = p.text
      .split("\n")
      .filter(
        (line) =>
          /^(?:Status:|Fed by|Also appears| {2}line )/.test(line) &&
          !/static (?:text|element) in the file$/.test(line),
      )
      .join("\n");
    ed.send({
      context,
      id: r.id,
      instruction: r.instruction,
      label: p.label || kindName(r.el ?? document.body),
      lines: p.line !== null && p.endLine !== null ? [p.line, p.endLine] : null,
      quote,
      type: "ask",
    });
    ed.overlay.showToast(
      r.instruction
        ? `Added · ${clip(r.instruction, 60)}`
        : "Added to your comments",
      {},
    );
  }

  /** After the file changes, find each request's element again from its source snippet. */
  function repin() {
    for (const r of state.requests) {
      const p = r.payload;
      let el: Element | null = null;
      if (p.anchorSnippet) {
        const at = findNearest(state.src, p.anchorSnippet, p.anchorStart);
        const entry = at >= 0 ? state.A.byStart.get(at) : undefined;
        if (entry) {
          p.anchorStart = at;
          const base = document.querySelector(`[data-src-id="${entry.id}"]`);
          el = base;
          if (p.generated && base) {
            const hit = [...base.querySelectorAll("*")].find(
              (n) => collapse(n.textContent) === p.liveText,
            );
            if (hit) {
              el = textBlockFor(hit) ?? hit;
            }
          }
        }
      } else {
        el =
          [...document.querySelectorAll(p.selector)].find(
            (n) => collapse(n.textContent) === p.liveText,
          ) ?? null;
      }
      r.el = el;
      r.stale = !el;
      if (el) {
        r.payload = buildRequest({
          A: state.A,
          change: r.change,
          edit: r.edit,
          el,
          instruction: r.instruction,
          path: ed.path,
          verdict: verdictFor(el, true),
        });
      }
    }
    renderPanel();
    ed.overlay.layout();
  }

  /**
   * The list of the comments still waiting on this page, opened above the
   * dock by its caret: those the window holds for the file and has not yet
   * moved into a chat, in the window's words and numbers, including any
   * staged before this Edit session. One the page still pins is brought into
   * view when pressed. Moved ones keep their pins until sent.
   */
  function renderPanel() {
    const list = ui.reqList;
    list.innerHTML = "";
    const waiting = state.staged.filter((a) => !a.moved);
    for (const a of waiting) {
      const r = state.requests.find((entry) => entry.id === a.id);
      const li = document.createElement("li");
      li.dataset.n = String(a.n);
      li.innerHTML = `<span class="pin num ${r?.kind ?? "ask"} ${r?.stale ? "stale" : ""}">${a.n}</span><div><div class="instr"></div><div class="what"></div></div><button class="x" title="Remove">${I.close}</button>`;
      find(li, ".instr").textContent =
        a.instruction || (r ? clip(r.payload.displayText, 60) : a.target);
      const what = find(li, ".what");
      what.textContent = r?.stale ? "" : a.target;
      if (r?.stale || r?.kind === "edit") {
        const badge = document.createElement("span");
        badge.className = `badge ${r.stale ? "stale" : ""} ${r.kind}`;
        badge.textContent = r.stale ? "moved or gone" : "Queued edit";
        what.prepend(badge);
      }
      li.addEventListener("click", (e) => {
        if (closestIn(e, ".x")) {
          if (r) {
            state.requests.splice(state.requests.indexOf(r), 1);
          }
          state.staged = state.staged.filter((entry) => entry.id !== a.id);
          ed.send({ id: a.id, type: "unstage" });
          renderPanel();
          ed.overlay.layout();
          return;
        }
        if (r?.el?.isConnected) {
          r.el.scrollIntoView({ behavior: "smooth", block: "center" });
          ed.overlay.flash(r.el, 2200);
          setTimeout(ed.overlay.layout, 400);
        }
      });
      list.append(li);
    }
    ui.dockAsks.hidden = waiting.length === 0;
    find(ui.moveBtn, "span").textContent = state.moveLabel;
    if (waiting.length === 0 && state.panelMode === "requests") {
      ed.style.setPanel(null);
    }
  }

  function toAgent(E: EditSession, newText: null | string, why: string) {
    addRequest(
      E.el,
      { entry: E.entry, label: "Static text", ok: true, status: "static" },
      `Change the text "${clip(collapse(E.oldText), 120)}" to "${clip(collapse(newText ?? ""), 200)}".`,
      { from: collapse(E.oldText), to: collapse(newText ?? "") },
      null,
    );
    ed.status(
      `Could not save directly: ${why}. Turned it into request ${state.nextN - 1} for the agent.`,
      "warn",
    );
    ed.overlay.showToast(`Added to your comments · ${why}`, {});
    void ed.serial(() => ed.reload.reloadKeeping(state.src));
    if (state.pendingExternal) {
      void ed.serial(ed.reload.applyExternal);
    }
  }

  function toAgentChange(el: HTMLElement, change: string, why: string) {
    addRequest(
      el,
      {
        entry: staticEntry(state.A, el).entry,
        label: kindName(el),
        ok: true,
        status: "element",
      },
      change,
      null,
      change,
    );
    ed.status(
      `Could not save directly: ${why}. Turned it into request ${state.nextN - 1} for the agent.`,
      "warn",
    );
    ed.overlay.showToast(`Added to your comments · ${why}`, {});
  }

  // Moves the waiting asks into the chat beside the file, or a new draft;
  // the window does it, and says so back with the next staged list.
  function move() {
    ed.style.setPanel(null);
    ed.send({ type: "move" });
  }

  function init() {
    pop.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!e.isTrusted) {
        return;
      }
      const text = textarea.value.trim();
      const { asking } = state;
      if (!asking) {
        return;
      }
      addRequest(asking.el, asking.verdict, text, null, asking.change);
      closeAsk();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        pop.requestSubmit();
      } else if (e.key === "Escape") {
        closeAsk();
      }
    });
    find(pop, "[data-cancel]").addEventListener("click", closeAsk);

    ui.moveBtn.addEventListener("click", move);
    ui.reqBtn.addEventListener("click", () => {
      ed.style.setPanel(state.panelMode === "requests" ? null : "requests");
    });
    ui.pageBtn.addEventListener("click", () => {
      const showing = state.panelMode === "style" && !state.sel;
      ed.selection.select(null);
      ed.style.setPanel(showing ? null : "style");
    });
    find(ui.inspector, "[data-close]").addEventListener("click", () => {
      ed.style.setPanel(null);
    });
  }

  return {
    addRequest,
    closeAsk,
    init,
    offerAsk,
    openAskFor,
    placeAsk,
    renderPanel,
    repin,
    toAgent,
    toAgentChange,
  };
}

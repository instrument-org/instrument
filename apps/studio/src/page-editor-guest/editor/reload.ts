/**
 * Reloads and the agent's changes. Every reload is the window's: the page is
 * loaded again from the file with ids stamped on it, and this world goes with
 * it. What must survive (the undo stack, the asks, the selection, the scroll)
 * is handed over first as a snapshot, and comes back in the next boot. A
 * change the agent writes while something is in hand waits until it is not.
 */
import { type Editor, type EditorSnapshot, type ReloadApi } from "./context";
import { type AppliedRegion, type Region } from "./regions";
import { analyze, changedRanges, mapOffset, type Range } from "./source";

const plainRegion = ({ after, at, before, post, pre }: Region): Region => ({
  after,
  at,
  before,
  post,
  pre,
});
const plainApplied = (r: AppliedRegion): AppliedRegion => ({
  ...plainRegion(r),
  atAfter: r.atAfter,
});

export function createReload(ed: Editor): ReloadApi {
  const { state, ui } = ed;

  function snapshot({
    agent,
    flash,
    flashSelf,
    sel,
  }: {
    agent: boolean;
    flash: null | Range[];
    flashSelf: boolean;
    sel: null | number;
  }): EditorSnapshot {
    return {
      agent,
      doc: { content: state.doc.content, version: state.doc.version },
      flash,
      flashSelf,
      nextN: state.nextN,
      panel:
        state.panelMode === "style" && !state.sel ? "page" : state.panelMode,
      placement: state.placement,
      // Without the live page's nodes, which only this load can use.
      redo: state.redoStack.map((op) => ({
        key: op.key,
        label: op.label,
        regions: op.regions.map(plainRegion),
        time: op.time,
      })),
      requests: state.requests.map((r) => ({
        change: r.change,
        edit: r.edit,
        id: r.id,
        instruction: r.instruction,
        kind: r.kind,
        n: r.n,
        payload: r.payload,
      })),
      scroll: { x: scrollX, y: scrollY },
      sel,
      undo: state.undoStack.map((op) => ({
        key: op.key,
        label: op.label,
        regions: op.regions.map(plainApplied),
        time: op.time,
      })),
    };
  }

  /** Ask the window to load the page again from the text in hand; this world ends with it. */
  function reloadWith({
    agent = false,
    flash = null,
    flashSelf = false,
    sel = null,
  }: {
    agent?: boolean;
    flash?: null | Range[];
    flashSelf?: boolean;
    sel?: null | number;
  }) {
    ed.send({
      state: snapshot({ agent, flash, flashSelf, sel }),
      text: state.src,
      type: "reload",
    });
    return new Promise<never>(() => {
      // Never settles: the page reloads, and this world with it.
    });
  }

  /** Reload the page from the text in hand, keeping scroll and re-finding the selection. */
  async function reloadKeeping(
    prev: string,
    selOff: null | number = ed.selection.selOffset(),
    flashSelf = false,
  ) {
    const mapped = selOff === null ? null : mapOffset(prev, state.src, selOff);
    await reloadWith({
      flash: flashSelf ? changedRanges(prev, state.src) : null,
      flashSelf,
      sel: mapped,
    });
  }

  function onExternalChange() {
    const { asking, dragging, editing } = state;
    if (editing || asking || dragging) {
      state.pendingExternal = true;
      ui.pill.hidden = false;
      ed.status(
        editing
          ? "Agent changed this page. Keep typing; your edit will be placed on top."
          : "Agent changed this page; it will reload when you finish.",
        "agent",
      );
      return;
    }
    void ed.serial(applyExternal);
  }

  async function applyExternal() {
    if (state.editing || state.asking || state.dragging) {
      return;
    }
    state.pendingExternal = false;
    ui.pill.hidden = true;
    const next = state.doc.content;
    if (next === state.src) {
      return;
    }
    const prev = state.src;
    const off = ed.selection.selOffset();
    state.src = next;
    state.A = analyze(state.src);
    await reloadWith({
      agent: true,
      flash: changedRanges(prev, state.src),
      sel: off === null ? null : mapOffset(prev, state.src, off),
    });
  }

  function afterBusy() {
    if (
      state.pendingExternal &&
      !state.editing &&
      !state.asking &&
      !state.dragging
    ) {
      void ed.serial(applyExternal);
    }
  }

  return {
    afterBusy,
    applyExternal,
    onExternalChange,
    reloadKeeping,
    reloadWith,
  };
}

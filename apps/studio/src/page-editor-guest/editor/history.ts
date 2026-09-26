/**
 * Writing the file, and undoing and redoing what was written. Every direct
 * edit is a set of regions saved on top of whatever is on disk now (merged
 * past the agent's own changes where they still fit), pushed on the undo
 * stack; undo writes the regions back the other way and brings the live page
 * along without a reload wherever it can.
 */
import {
  type Editor,
  type HistoryApi,
  type LiveStep,
  type NewRoot,
  type WriteResult,
} from "./context";
import { type AppliedRegion, place, type Region } from "./regions";
import { analyze, changedRanges, mapOffset } from "./source";
import { invertMap, type OffsetMap } from "./structure";

/** A structural undo or redo step: the children to put back, and how offsets moved. */
interface ReplayStep {
  kids: ChildNode[];
  live: LiveStep;
  map: OffsetMap;
  roots: () => NewRoot[];
}

/** The regions that write `applied` back the other way. */
const inverse = (applied: AppliedRegion[]): Region[] =>
  applied.map((r) => ({
    after: r.before,
    at: r.atAfter,
    before: r.after,
    post: r.post,
    pre: r.pre,
  }));

export function createHistory(ed: Editor): HistoryApi {
  const { state, ui } = ed;

  async function saveRegions(regions: Region[]): Promise<WriteResult> {
    const { doc } = state;
    let external = doc.content !== state.src;
    let placed = place(doc.content, regions);
    if (!placed) {
      return { ok: false };
    }
    let res = await doc.save(placed.text);
    if (!res.ok) {
      doc.content = res.content;
      doc.version = res.version;
      external = true;
      placed = place(doc.content, regions);
      if (!placed) {
        return { ok: false };
      }
      res = await doc.save(placed.text);
      if (!res.ok) {
        return { ok: false };
      }
    }
    const prev = state.src;
    state.src = placed.text;
    state.A = analyze(state.src);
    state.pendingExternal = false;
    ui.pill.hidden = true;
    return { external, ok: true, placed, prev };
  }

  async function write({
    key,
    label,
    merge = false,
    regions,
  }: {
    key: string;
    label: string;
    merge?: boolean;
    regions: Region[];
  }) {
    const res = await saveRegions(regions);
    if (!res.ok) {
      return res;
    }
    const last = state.undoStack.at(-1);
    const now = Date.now();
    const [r0] = res.placed.applied;
    const lastRegion = last?.regions[0];
    if (
      merge &&
      last &&
      lastRegion &&
      r0 &&
      last.key === key &&
      now - last.time < 1800 &&
      last.regions.length === 1 &&
      res.placed.applied.length === 1 &&
      lastRegion.atAfter === r0.at &&
      lastRegion.after === r0.before
    ) {
      last.regions[0] = { ...lastRegion, after: r0.after, atAfter: r0.atAfter };
      last.label = `${last.label.split(" → ")[0] ?? ""} → ${label.split(" → ").at(-1) ?? ""}`;
      last.time = now;
    } else {
      state.undoStack.push({
        key,
        label,
        regions: res.placed.applied,
        time: now,
      });
    }
    state.redoStack.length = 0;
    updateUndoButtons();
    ed.selection.verdictCacheReset();
    return res;
  }

  async function undo() {
    if (state.editing) {
      return;
    }
    const op = state.undoStack.pop();
    if (!op) {
      return;
    }
    await ed.serial(async () => {
      const t0 = performance.now();
      const res = await replay(
        inverse(op.regions),
        op.live && {
          kids: op.live.before,
          live: op.live,
          map: invertMap(op.live.map),
          roots: op.live.invRoots,
        },
      );
      if (!res.ok) {
        state.undoStack.push(op);
        ed.status(
          "Could not undo: that part of the page has changed since",
          "warn",
        );
        return;
      }
      state.redoStack.push({ ...op, regions: inverse(res.placed.applied) });
      ed.overlay.showToast(`Undid ${op.label}`, { redo: true });
      ed.status(
        `Undid ${op.label} · ${res.how} in ${Math.round(performance.now() - t0)} ms`,
      );
      updateUndoButtons();
    });
  }

  async function redo() {
    if (state.editing) {
      return;
    }
    const op = state.redoStack.pop();
    if (!op) {
      return;
    }
    await ed.serial(async () => {
      const t0 = performance.now();
      const res = await replay(
        op.regions,
        op.live && {
          kids: op.live.after,
          live: op.live,
          map: op.live.map,
          roots: op.live.fwdRoots,
        },
      );
      if (!res.ok) {
        state.redoStack.push(op);
        ed.status(
          "Could not redo: that part of the page has changed since",
          "warn",
        );
        return;
      }
      state.undoStack.push({ ...op, regions: res.placed.applied, time: 0 });
      ed.overlay.showToast(`Redid ${op.label}`, { undo: true });
      ed.status(
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
  async function replay(regions: Region[], step: ReplayStep | undefined) {
    const prevA = state.A;
    const off = ed.selection.selOffset();
    const res = await saveRegions(regions);
    if (!res.ok) {
      return res;
    }
    let ok = ed.live.exactlyPlaced(res, regions);
    let focus: Element | null = null;
    if (ok && step) {
      const { parent } = step.live;
      ed.live.quietly(parent, () => {
        ed.live.setChildren(parent, step.kids);
      });
      const roots = step.roots();
      ok = ed.live.restamp(prevA, step.map, roots);
      focus = roots[0]?.nodes[0] ?? null;
    } else ok &&= ed.live.patchLive(prevA, res.placed.applied);
    if (!ok || step?.live.reload) {
      await ed.reload.reloadKeeping(res.prev, off, true);
      return { ...res, how: "page reloaded" };
    }
    ed.selection.verdictCacheReset();
    const mapped = off === null ? null : mapOffset(res.prev, state.src, off);
    if (focus?.isConnected && focus instanceof HTMLElement) {
      ed.selection.select(focus);
    } else if (state.sel && !state.sel.isConnected) {
      ed.selection.select(null);
    } else if (mapped !== null) {
      ed.selection.reselectAt(mapped);
    }
    ed.asks.repin();
    ed.overlay.flashRanges(changedRanges(res.prev, state.src), true);
    if (state.panelMode === "style") {
      await ed.style.refreshColors();
    }
    return { ...res, how: "live" };
  }

  function updateUndoButtons() {
    const { redoStack, undoStack } = state;
    const lastUndo = undoStack.at(-1);
    const lastRedo = redoStack.at(-1);
    ui.undoBtn.disabled = !lastUndo;
    ui.redoBtn.disabled = !lastRedo;
    ui.undoBtn.title = lastUndo ? `Undo ${lastUndo.label} (⌘Z)` : "Undo (⌘Z)";
    ui.redoBtn.title = lastRedo ? `Redo ${lastRedo.label} (⇧⌘Z)` : "Redo (⇧⌘Z)";
  }

  function init() {
    ui.undoBtn.addEventListener("click", () => {
      void undo();
    });
    ui.redoBtn.addEventListener("click", () => {
      void redo();
    });
  }

  return { init, redo, saveRegions, undo, updateUndoButtons, write };
}

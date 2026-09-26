/**
 * Moving, duplicating and deleting the selection. The live page changes
 * first (each element with the whitespace before it, as the file will), then
 * the file follows as one splice, with the page's ids renumbered in place so
 * no reload is needed; the drag gesture previews a move among the siblings.
 */
import { kindName, staticEntry, structureVerdict } from "./classify";
import {
  type Editor,
  type LiveStep,
  type NewRoot,
  type StructureApi,
} from "./context";
import { UI_ICONS as I } from "./icons";
import { structWhy } from "./notes";
import { withContext } from "./regions";
import { type Analysis, type PageSourceEntry } from "./source";
import {
  deleteRegion,
  duplicateRegion,
  moveRegion,
  reorderGesture,
} from "./structure";

/** An element plus the whitespace-only text right before it: what the file moves as one chunk. */
function unitOf(el: Element): ChildNode[] {
  const p = el.previousSibling;
  return p instanceof Text && !/\S/.test(p.data) ? [p, el] : [el];
}

const INTERACTIVE = "button,input,select,textarea,details,form,[onclick]";

export function createStructure(ed: Editor): StructureApi {
  const { state, ui } = ed;

  function structureOp(kind: "delete" | "duplicate") {
    const el = state.sel;
    if (!el || state.editing) {
      return;
    }
    const v = structureVerdict(state.A, el);
    const name = kindName(el).toLowerCase();
    if (!v.ok) {
      const why = structWhy(v, kind);
      ed.overlay.showToast(
        `Can’t ${kind} this ${name}: ${why.replace(/\.$/, "")}`,
        {},
      );
      ed.status(
        `Can’t ${kind} this ${name}: ${why} Ask Instrument instead.`,
        "warn",
      );
      return;
    }
    const parent = el.parentElement;
    if (!parent) {
      return;
    }
    const t0 = performance.now();
    const label =
      kind === "duplicate" ? `Duplicated ${name}` : `Deleted ${name}`;
    const before = [...parent.childNodes];
    // The page changes now; the file follows.
    let clone: Element | null = null;
    let fwdRoots = noRoots;
    let invRoots = noRoots;
    let region;
    let map;
    if (kind === "duplicate") {
      const r = duplicateRegion(state.A, v.entry);
      ({ map, region } = r);
      const copy = el.cloneNode(true);
      if (!(copy instanceof Element)) {
        return;
      }
      clone = copy;
      ed.live.quietly(parent, () => {
        for (const n of [copy, ...copy.querySelectorAll("[id]")]) {
          n.removeAttribute("id");
        }
        const ws = state.src.slice(r.region.at, v.entry.loc.startOffset);
        el.after(...(ws ? [document.createTextNode(ws)] : []), copy);
      });
      fwdRoots = () => [
        {
          nodes: [copy, ...copy.querySelectorAll("[data-src-id]")],
          ...r.copyRange,
        },
      ];
    } else {
      const r = deleteRegion(state.A, v.entry);
      ({ map, region } = r);
      ed.live.quietly(parent, () => {
        for (const n of unitOf(el)) {
          n.remove();
        }
      });
      invRoots = () => [
        {
          nodes: [el, ...el.querySelectorAll("[data-src-id]")],
          ...r.removedRange,
        },
      ];
    }
    const after = [...parent.childNodes];
    if (kind === "delete") {
      ed.selection.select(null);
    }
    ed.overlay.layout();
    const live: LiveStep = {
      after,
      before,
      fwdRoots,
      invRoots,
      map,
      parent,
      reload: !!clone && scriptTouches(state.A, clone),
    };
    void ed.serial(async () => {
      const res = await ed.live.applyLive({
        key: `${kind}:${v.entry.loc.startOffset}`,
        label,
        live,
        regions: [withContext(state.src, region)],
      });
      if (!res.ok) {
        ed.live.quietly(parent, () => {
          ed.live.setChildren(parent, before);
        });
        ed.asks.toAgentChange(
          el,
          `${kind === "duplicate" ? "Duplicate" : "Delete"} this ${name}`,
          "the agent changed this part of the page",
        );
        return;
      }
      if (clone?.isConnected && clone instanceof HTMLElement) {
        ed.selection.select(clone);
        ed.overlay.flash(clone, 1400, true);
      }
      ed.overlay.showToast(label, { undo: true });
      ed.status(
        `${label} · ${res.how} in ${Math.round(performance.now() - t0)} ms`,
      );
      ed.overlay.layout();
    });
  }

  async function moveTo(
    from: number,
    to: number,
    items: Element[],
    before: ChildNode[] | null = null,
  ) {
    if (!ed.state.sel) {
      return;
    }
    const el = items[from];
    const parent = el?.parentElement;
    // Entries in source order; `from`/`to` index the same order.
    const entries: PageSourceEntry[] = [];
    for (const n of items) {
      const entry = staticEntry(state.A, n).entry;
      const prev = entries.at(-1);
      if (!entry || (prev && entry.loc.startOffset <= prev.loc.startOffset)) {
        await ed.reload.reloadKeeping(state.src);
        return;
      }
      entries.push(entry);
    }
    const moved = entries[from];
    if (!el || !parent || !moved) {
      return;
    }
    const t0 = performance.now();
    const name = kindName(el).toLowerCase();
    const kids = before ?? [...parent.childNodes];
    const { map, region } = moveRegion(state.src, entries, from, to);
    // Reorder the live nodes the way the file will be: each element with the whitespace before it.
    const order = items.map((_, i) => i);
    order.splice(order.indexOf(from), 1);
    order.splice(to, 0, from);
    ed.live.quietly(parent, () => {
      ed.live.setChildren(parent, kids);
      const units = items.map(unitOf);
      const end = items.at(-1)?.nextSibling ?? null;
      for (const i of order) {
        for (const n of units[i] ?? []) {
          if (end) {
            end.before(n);
          } else {
            parent.append(n);
          }
        }
      }
    });
    const after = [...parent.childNodes];
    ed.overlay.layout();
    const live: LiveStep = {
      after,
      before: kids,
      fwdRoots: noRoots,
      invRoots: noRoots,
      map,
      parent,
      reload: false,
    };
    const res = await ed.live.applyLive({
      key: `move:${moved.loc.startOffset}`,
      label: `Moved ${name}`,
      live,
      regions: [withContext(state.src, region)],
    });
    if (!res.ok) {
      ed.live.quietly(parent, () => {
        ed.live.setChildren(parent, kids);
      });
      await ed.reload.reloadKeeping(state.src);
      return;
    }
    if (el.isConnected && el instanceof HTMLElement) {
      ed.selection.select(el);
    }
    if (state.sel) {
      ed.overlay.flash(state.sel, 1400, true);
    }
    ed.overlay.showToast(`Moved ${name} to position ${to + 1}`, { undo: true });
    ed.status(
      `Moved ${name} ${from + 1} → ${to + 1} · ${res.how} in ${Math.round(performance.now() - t0)} ms`,
    );
    ed.overlay.layout();
  }

  function nudge(dir: number) {
    const { info, sel } = state;
    if (!sel || !info?.struct.ok) {
      return;
    }
    const items = info.struct.siblings;
    const i = items.indexOf(sel);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) {
      return;
    }
    void ed.serial(() => moveTo(i, j, items));
  }

  function setupGesture() {
    state.gesture?.destroy();
    state.gesture = null;
    const { info, sel } = state;
    if (!sel || state.editing || !info?.struct.ok) {
      return;
    }
    const items = info.struct.siblings;
    const [first, second] = items;
    const parent = sel.parentElement;
    if (!first || !second || !parent) {
      return;
    }
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const vertical = Math.abs(b.top - a.top) >= Math.abs(b.left - a.left);
    let marker: Comment | null = null;
    let kids: ChildNode[] | null = null;
    const end = () => {
      state.dragging = false;
      ui.root.classList.remove("dragging");
      marker?.remove();
      marker = null;
      ed.watch.editing = null;
    };
    state.gesture = reorderGesture({
      gripHtml: I.grip,
      host: ui.proxies,
      items,
      onCancel: () => {
        marker?.remove();
        marker = null;
        const was = kids;
        if (was) {
          ed.live.quietly(parent, () => {
            ed.live.setChildren(parent, was);
          });
        }
        end();
        ed.toolbar.render();
        ed.overlay.layout();
      },
      onDrop: (from, to) => {
        marker?.remove();
        marker = null;
        ed.watch.flush();
        end();
        // The preview order stays on screen; moveTo lays the nodes out exactly as the file will be.
        const was = kids;
        void ed.serial(() => moveTo(from, to, items, was));
      },
      onPreview: (order) => {
        marker?.after(...order.flatMap((i) => items[i] ?? []));
        ed.watch.flush();
      },
      onStart: () => {
        state.dragging = true;
        ui.root.classList.add("dragging");
        kids = [...parent.childNodes];
        ed.watch.editing = parent;
        marker = document.createComment("");
        first.before(marker);
        ed.toolbar.render();
        ed.selection.setHover(null);
        ed.overlay.layout();
      },
      rectOf: (el) => ed.overlay.rectOf(el),
      selectedIndex: items.indexOf(sel),
      vertical,
    });
  }

  return { nudge, setupGesture, structureOp };
}

/** A step that brings no new elements into the page. */
function noRoots(): NewRoot[] {
  return [];
}

/** Do the page's scripts name any class used in this subtree? Then a copy made here would be missing their wiring. */
function scriptTouches(A: Analysis, root: Element) {
  const classes = new Set<string>();
  for (const n of [root, ...root.querySelectorAll("[class]")]) {
    for (const c of n.classList) {
      classes.add(c);
    }
  }
  const scripts = A.scripts.filter((s) => s.type !== "application/json");
  const interactive =
    root.matches(INTERACTIVE) || root.querySelector(INTERACTIVE);
  if (interactive && scripts.length > 0) {
    return true;
  }
  return scripts.some((s) =>
    [...classes].some(
      (c) =>
        s.text.includes(`.${c}`) ||
        s.text.includes(`'${c}'`) ||
        s.text.includes(`"${c}"`),
    ),
  );
}

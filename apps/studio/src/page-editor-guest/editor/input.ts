/**
 * The person's input, and only theirs. Every listener that acts checks
 * `isTrusted`, and events a page script dispatches at the editor's UI or at
 * the text being edited are stopped before anything sees them. While
 * editing, a press on the page selects instead of reaching the page's own
 * handlers; keys drive undo, selection, editing and nudging.
 */
import { type Editor, type InputApi } from "./context";

/** Events a page script could dispatch to act on the editor or the text being edited. */
const GUARDED = [
  "auxclick",
  "beforeinput",
  "click",
  "compositionend",
  "compositionstart",
  "contextmenu",
  "copy",
  "cut",
  "dblclick",
  "dragstart",
  "drop",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "mousedown",
  "mouseup",
  "paste",
  "pointerdown",
  "pointerup",
  "submit",
];

/** Presses that would reach the page's own handlers; the editor keeps them. */
const PRESSES = [
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "contextmenu",
  "submit",
  "auxclick",
];

export function createInput(ed: Editor): InputApi {
  const { state, ui } = ed;

  const inEditor = (t: EventTarget | null) =>
    !!state.editing &&
    t instanceof Node &&
    (state.editing.el === t || state.editing.el.contains(t));

  /** Done: finish what is in hand, let the writes land, then ask the window for the page as it is. */
  function leave() {
    if (state.editing) {
      ed.text.commitEdit();
    }
    void ed.serial(() => {
      ed.send({ type: "leave" });
    });
  }

  function hostKeys(e: KeyboardEvent) {
    const t = e.composedPath()[0];
    const inField =
      t instanceof Element && t.closest("input,textarea,[contenteditable]");
    const mod = e.metaKey || e.ctrlKey;
    const { info, sel } = state;
    if (mod && !inField && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void (e.shiftKey ? ed.history.redo() : ed.history.undo());
      return;
    }
    if (inField) {
      return;
    }
    if (mod && e.key.toLowerCase() === "d" && sel) {
      e.preventDefault();
      ed.structure.structureOp("duplicate");
      return;
    }
    if (mod && e.key === "ArrowUp" && sel) {
      e.preventDefault();
      ed.selection.selectParent();
      return;
    }
    if (mod) {
      return;
    }
    const k = e.key;
    if (k === "Escape") {
      if (state.asking) {
        ed.asks.closeAsk();
      } else if (!ui.imgPop.hidden) {
        ed.image.closeImgPop();
      } else if (ed.toolbar.crumbsOpen()) {
        ed.toolbar.hideCrumbs();
      } else if (sel) {
        ed.selection.selectParent();
      } else if (state.panelMode) {
        ed.style.setPanel(null);
      } else {
        leave();
      }
      return;
    }
    if (!sel || !info) {
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        ed.selection.selectParent();
      } else if (info.kind === "text" && info.textOk) {
        ed.text.startEdit(sel, "end");
      } else if (info.kind === "image" && info.imageOk) {
        ed.image.openImgPop();
      }
      return;
    }
    if (k === "Backspace" || k === "Delete") {
      e.preventDefault();
      ed.structure.structureOp("delete");
      return;
    }
    if (
      e.altKey &&
      (k === "ArrowUp" ||
        k === "ArrowDown" ||
        k === "ArrowLeft" ||
        k === "ArrowRight")
    ) {
      e.preventDefault();
      ed.structure.nudge(k === "ArrowUp" || k === "ArrowLeft" ? -1 : 1);
    }
  }

  function wire() {
    const style = document.createElement("style");
    style.setAttribute("data-editor-guest", "");
    style.textContent = `
    html[data-editor-mode=edit] body *{cursor:default!important}
    html[data-editor-mode=edit] .editor-guest-pm, html[data-editor-mode=edit] .editor-guest-pm *, html[data-editor-mode=edit] [contenteditable]{cursor:text!important}
    .editor-guest-pm{outline:none;white-space:pre-wrap;word-wrap:break-word;flex-direction:inherit;flex-wrap:inherit;align-items:inherit;justify-content:inherit;gap:inherit;text-align:inherit;min-width:0}
    .editor-guest-pm ::selection, [contenteditable] ::selection{background:rgb(13 153 255 / .28)}
    [contenteditable]{outline:none}`;
    document.head.append(style);

    // A page script can dispatch any event it likes at the editor's UI or at
    // the text being edited; only the person's own reach them.
    for (const type of GUARDED) {
      document.addEventListener(
        type,
        (e) => {
          if (!e.isTrusted && (ed.isOurs(e) || inEditor(e.target))) {
            e.stopImmediatePropagation();
          }
        },
        true,
      );
    }
    document.addEventListener(
      "mousemove",
      (e) => {
        if (!e.isTrusted || state.dragging) {
          return;
        }
        if (ed.isOurs(e)) {
          ed.selection.setHover(null);
        } else {
          ed.selection.onHover(e.target);
        }
      },
      true,
    );
    document.documentElement.addEventListener("mouseleave", () => {
      ed.selection.setHover(null);
    });
    for (const type of PRESSES) {
      document.addEventListener(
        type,
        (e) => {
          if (ed.isOurs(e) || inEditor(e.target)) {
            return;
          }
          e.stopImmediatePropagation();
          e.preventDefault();
        },
        true,
      );
    }
    document.addEventListener(
      "click",
      (e) => {
        if (ed.isOurs(e) || inEditor(e.target)) {
          return;
        }
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.isTrusted) {
          ed.selection.onClick(e);
        }
      },
      true,
    );
    document.addEventListener(
      "dblclick",
      (e) => {
        if (ed.isOurs(e) || inEditor(e.target)) {
          return;
        }
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.isTrusted) {
          ed.selection.onDblClick(e);
        }
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (!e.isTrusted) {
          return;
        }
        const { editing } = state;
        if (editing && inEditor(e.target)) {
          if (!editing.rich) {
            e.stopImmediatePropagation();
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              ed.text.commitEdit();
            }
          }
          return;
        }
        // Keys in the editor's own UI are read inside its root, below, where
        // the field they were typed in is seen rather than the root's host.
        if (ed.isOurs(e)) {
          return;
        }
        e.stopImmediatePropagation();
        hostKeys(e);
      },
      true,
    );
    ed.shadow.addEventListener(
      "keydown",
      (e) => {
        if (e.isTrusted && e instanceof KeyboardEvent) {
          hostKeys(e);
        }
      },
      true,
    );
    // Clicking the editor's own UI ends a text edit, except inside the bubble
    // menu. Page clicks are the page listeners' to judge; this is for the
    // editor's own UI, heard inside its root, where the element clicked is seen.
    ed.shadow.addEventListener(
      "pointerdown",
      (e) => {
        if (!state.editing || !e.isTrusted) {
          return;
        }
        if (state.editing.rich?.containsHost(e.composedPath()[0])) {
          return;
        }
        ed.text.commitEdit();
      },
      true,
    );
    addEventListener("scroll", ed.overlay.layout, {
      capture: true,
      passive: true,
    });
    ed.selection.init();
    ui.doneBtn.addEventListener("click", (e) => {
      if (e.isTrusted) {
        leave();
      }
    });
  }

  return { leave, wire };
}

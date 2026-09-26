// One code or text file open in CodeMirror: the editor, and the disk I/O
// around it. The contract is the Markdown editor's: saves are debounced and
// flushed on demand; a write that finds the file changed underneath it merges
// the disk text and tries again; a change on disk (the agent writing the file)
// arrives as the smallest edits that make it, kept out of undo, and its lines
// flash. All disk I/O runs through one queue, so a merge never interleaves
// with a save in flight.
import { rpcClient } from "@/client/rpc/client";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  Text,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";

import { mark } from "../markdown-editor/icons";
import {
  changesBetween,
  detectIndent,
  fileText,
  rebase,
  type TextForm,
  textForm,
} from "./text-sync";
import { codeHighlighting, propertyColors, studioEditorTheme } from "./theme";

export interface CodeExternalChange {
  /** Where the first changed line starts, in the document as it now stands. */
  at: number;
  /** Whether the agent changed text the person had unsaved edits in. */
  overlapped: boolean;
}

export type CodeSession = ReturnType<typeof createCodeSession>;

export interface CodeSessionOptions {
  filename: string;
  hostPath: string;
  initial: { content: string; version: string };
  onAsk: (selection: { lines: [number, number]; quote: string }) => void;
  onExternalChange: (change: CodeExternalChange) => void;
  onStatus: (status: SaveStatus, detail?: string) => void;
  parent: HTMLElement;
  /** Whether the file is shown but not edited; it still follows the disk. */
  readOnly: boolean;
  /** Code wears line numbers; a text file reads as prose. */
  variant: "code" | "text";
  wrapLines: boolean;
}

export type SaveStatus = "error" | "saved" | "saving" | "unsaved";

interface DiskState {
  form: TextForm;
  /** The file's text exactly as it is on disk. */
  text: string;
  version: string;
}

/** How long typing rests before a save, and the longest a save waits under steady typing. */
const SAVE_DEBOUNCE_MS = 400;
const SAVE_MAX_WAIT_MS = 2000;
const FLASH_MS = 1800;
/** The most lines one agent write lights up; past it, only the first ones flash. */
const FLASH_MAX_LINES = 400;

/** Marks the transaction that brings a disk change in, so it is not taken for typing. */
const external = Annotation.define<boolean>();

const setFlash = StateEffect.define<{ from: number; to: number }[]>();
const clearFlash = StateEffect.define();
const flashLine = Decoration.line({ class: "cm-agent-flash" });

/** The lines an agent write touched, lit for a moment and moved along with edits. */
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  provide: (field) => EditorView.decorations.from(field),
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(clearFlash)) {
        next = Decoration.none;
      } else if (effect.is(setFlash)) {
        const starts: number[] = [];
        for (const { from, to } of effect.value) {
          let line = tr.state.doc.lineAt(from);
          const end = tr.state.doc.lineAt(Math.min(to, tr.state.doc.length));
          while (starts.length < FLASH_MAX_LINES) {
            starts.push(line.from);
            if (line.number >= end.number) {
              break;
            }
            line = tr.state.doc.line(line.number + 1);
          }
        }
        const unique = [...new Set(starts)].sort((a, b) => a - b);
        next = Decoration.set(unique.map((at) => flashLine.range(at)));
      }
    }
    return next;
  },
});

/** The search panel's labels in the app's sentence case. */
const searchPhrases = EditorState.phrases.of({
  all: "All",
  "by word": "By word",
  "match case": "Match case",
  next: "Next",
  previous: "Previous",
  regexp: "Regexp",
  replace: "Replace",
  "replace all": "Replace all",
});

export function createCodeSession(options: CodeSessionOptions) {
  const { hostPath, initial, parent } = options;
  const form = textForm(initial.content);
  let disk: DiskState = {
    form,
    text: initial.content,
    version: initial.version,
  };
  // The person's edits since the disk version, as changes over its text.
  let pending = ChangeSet.empty(
    Text.of(form.body.split(form.lineBreak)).length,
  );
  // The person's edits since the save in flight started, when there is one.
  let sinceSave: ChangeSet | null = null;
  let destroyed = false;

  // Up first, empty, so everything below can refer to it; its document and
  // extensions are set once they are all defined.
  const view = new EditorView({ parent });

  const language = new Compartment();
  const wrap = new Compartment();
  const lineSeparator = new Compartment();

  const bodyOf = (state: EditorState) =>
    state.doc.sliceString(0, state.doc.length, disk.form.lineBreak);
  const currentText = () => fileText(disk.form, bodyOf(view.state));

  // ---------------------------------------------------------------- disk queue

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: unknown) => {
      console.error("code editor:", error);
      options.onStatus(
        "error",
        error instanceof Error ? error.message : "Could not save",
      );
    });
    return queue;
  };

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueued = false;
  let pendingSince = 0;
  // Debounced, but never postponed past the max wait: a steady stream of
  // keystrokes or agent writes must not keep the person's edits off disk.
  const scheduleSave = (ms = SAVE_DEBOUNCE_MS) => {
    clearTimeout(saveTimer);
    pendingSince ||= Date.now();
    options.onStatus("unsaved");
    saveTimer = setTimeout(
      () => {
        saveTimer = undefined;
        pendingSince = 0;
        if (saveQueued) {
          return;
        }
        saveQueued = true;
        void enqueue(save);
      },
      Math.max(0, Math.min(ms, pendingSince + SAVE_MAX_WAIT_MS - Date.now())),
    );
  };

  const flush = () => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      pendingSince = 0;
      if (!saveQueued) {
        saveQueued = true;
        void enqueue(save);
      }
    }
    return queue;
  };

  async function save() {
    saveQueued = false;
    const text = currentText();
    if (text === disk.text) {
      options.onStatus("saved");
      return;
    }
    options.onStatus("saving");
    const base = disk;
    const unsavedAtStart = pending;
    sinceSave = ChangeSet.empty(view.state.doc.length);
    let r: Awaited<ReturnType<typeof rpcClient.files.write.call>>;
    try {
      r = await rpcClient.files.write.call({
        baseVersion: base.version,
        content: text,
        path: hostPath,
      });
    } catch (error) {
      pending = unsavedAtStart.compose(sinceSave);
      sinceSave = null;
      throw error;
    }
    // Typed while the write was in flight.
    const typed = sinceSave;
    sinceSave = null;
    if (r.ok) {
      disk = {
        form: { ...base.form, body: base.form.bom ? text.slice(1) : text },
        text,
        version: r.version,
      };
      pending = typed;
      options.onStatus("saved");
      if (!destroyed && currentText() !== disk.text) {
        scheduleSave();
      }
      return;
    }
    // The file changed after our last sync: everything on screen is still
    // unsaved against the old version. Merge the new one under it and save
    // again.
    pending = unsavedAtStart.compose(typed);
    mergeIn(r.content, r.version);
    scheduleSave(100);
  }

  let pullQueued = false;
  /** The file changed on disk (or may have): read it and merge what changed. */
  const pull = () => {
    if (pullQueued || destroyed) {
      return;
    }
    pullQueued = true;
    void enqueue(async () => {
      pullQueued = false;
      const r = await rpcClient.files.read.call({ path: hostPath });
      // Our own save's echo: the version we already hold.
      if (destroyed || r.version === disk.version || r.content === disk.text) {
        return;
      }
      mergeIn(r.content, r.version);
    });
  };

  function mergeIn(content: string, version: string) {
    const before = disk;
    const next = textForm(content);
    if (next.lineBreak !== before.form.lineBreak) {
      replaceForm(content, version, next);
      return;
    }
    const theirs = changesBetween(
      before.form.body,
      next.body,
      before.form.lineBreak,
    );
    const { overlaps, theirsOnScreen, unsaved } = rebase(theirs, pending);
    const flashes: { from: number; to: number }[] = [];
    theirsOnScreen.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      flashes.push({ from: fromB, to: toB });
    });
    disk = {
      form: { ...before.form, body: next.body, bom: next.bom },
      text: content,
      version,
    };
    pending = unsaved;
    view.dispatch({
      annotations: [
        external.of(true),
        Transaction.addToHistory.of(false),
        Transaction.remote.of(true),
      ],
      changes: theirsOnScreen,
      effects: flashes.length > 0 ? setFlash.of(flashes) : [],
    });
    const first = flashes[0];
    if (first) {
      options.onExternalChange({ at: first.from, overlapped: overlaps > 0 });
    }
    if (currentText() !== disk.text) {
      scheduleSave();
    }
  }

  /**
   * The file came back with other line breaks (CRLF to LF, or the reverse).
   * The document is re-read in them, keeping the caret's line and column,
   * when the person has nothing unsaved; with unsaved edits theirs stand and
   * are saved over it in the breaks they were typed in.
   */
  function replaceForm(content: string, version: string, next: TextForm) {
    if (!pending.empty) {
      const asOurs = Text.of(next.body.split(disk.form.lineBreak));
      disk = { form: disk.form, text: content, version };
      pending = ChangeSet.of(
        [{ from: 0, insert: view.state.doc, to: asOurs.length }],
        asOurs.length,
      );
      options.onExternalChange({ at: 0, overlapped: true });
      scheduleSave();
      return;
    }
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const column = head - line.from;
    const doc = Text.of(next.body.split(next.lineBreak));
    const targetLine = doc.line(Math.min(line.number, doc.lines));
    const at = Math.min(targetLine.from + column, targetLine.to);
    disk = { form: next, text: content, version };
    pending = ChangeSet.empty(doc.length);
    view.dispatch({
      annotations: [
        external.of(true),
        Transaction.addToHistory.of(false),
        Transaction.remote.of(true),
      ],
      changes: { from: 0, insert: doc, to: view.state.doc.length },
      effects: lineSeparator.reconfigure(
        EditorState.lineSeparator.of(next.lineBreak),
      ),
      selection: EditorSelection.cursor(at),
    });
    options.onExternalChange({ at: 0, overlapped: false });
  }

  // ---------------------------------------------------------------- editor

  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const ask = (state: EditorState) => {
    const { from, to } = state.selection.main;
    if (from === to) {
      return;
    }
    options.onAsk({
      lines: linesOf(state, from, to),
      quote: state.doc.sliceString(from, to, "\n"),
    });
  };

  const sessionListener = EditorView.updateListener.of((update) => {
    for (const tr of update.transactions) {
      if (tr.docChanged && !tr.annotation(external)) {
        pending = pending.compose(tr.changes);
        sinceSave &&= sinceSave.compose(tr.changes);
      }
      if (tr.effects.some((effect) => effect.is(setFlash))) {
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
          if (!destroyed) {
            view.dispatch({ effects: clearFlash.of(null) });
          }
        }, FLASH_MS);
      }
    }
    if (
      update.transactions.some(
        (tr) => tr.docChanged && !tr.annotation(external),
      )
    ) {
      scheduleSave();
    }
  });

  // Pasted or dropped text takes the file's own line breaks, so a CRLF file
  // stays CRLF whatever the clipboard held.
  const normalizeBreaks = EditorView.clipboardInputFilter.of((text) =>
    text.replaceAll(/\r\n?|\n/g, disk.form.lineBreak),
  );

  view.setState(
    EditorState.create({
      doc: Text.of(form.body.split(form.lineBreak)),
      extensions: [
        lineSeparator.of(EditorState.lineSeparator.of(form.lineBreak)),
        options.variant === "code"
          ? [lineNumbers(), highlightActiveLineGutter()]
          : [],
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        indentUnit.of(detectIndent(form.body)),
        EditorState.tabSize.of(4),
        EditorState.allowMultipleSelections.of(true),
        EditorState.readOnly.of(options.readOnly),
        search({ top: true }),
        searchPhrases,
        keymap.of([
          ...searchKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        codeHighlighting,
        language.of([]),
        wrap.of(options.wrapLines ? EditorView.lineWrapping : []),
        studioEditorTheme,
        flashField,
        options.readOnly ? [] : askTooltip(ask),
        sessionListener,
        normalizeBreaks,
        EditorView.contentAttributes.of({
          "aria-label": options.filename,
          spellcheck: "false",
        }),
      ],
    }),
  );

  // The language is read from the file's name and loaded on demand; the file
  // is on screen as plain text until it arrives.
  const description = LanguageDescription.matchFilename(
    languages,
    options.filename,
  );
  if (description && options.variant === "code") {
    void description.load().then(
      (support) => {
        if (destroyed) {
          return;
        }
        const properties = propertyColors(description.name);
        view.dispatch({
          effects: language.reconfigure([
            support,
            properties.length > 0
              ? syntaxHighlighting(
                  HighlightStyle.define(properties, {
                    scope: support.language,
                  }),
                )
              : [],
          ]),
        });
      },
      (error: unknown) => {
        console.warn("code editor: no language for", options.filename, error);
      },
    );
  }

  // Leaving the editor is a save: the caret going elsewhere, the window
  // hiding, the window closing.
  const onFocusOut = (e: FocusEvent) => {
    if (
      !(e.relatedTarget instanceof Node) ||
      !view.dom.contains(e.relatedTarget)
    ) {
      void flush();
    }
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      void flush();
    }
  };
  const onUnload = () => {
    void flush();
  };
  view.dom.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("beforeunload", onUnload);

  return {
    currentText,
    /** Saves what is unsaved, then tears the editor down. */
    destroy: async () => {
      if (destroyed) {
        return;
      }
      view.dom.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      await flush();
      destroyed = true;
      clearTimeout(flashTimer);
      clearTimeout(saveTimer);
      view.destroy();
    },
    disk: () => disk,
    flush,
    /** Whether nothing is waiting to be written. */
    idle: async () => {
      await queue;
      return (
        !saveQueued && saveTimer === undefined && currentText() === disk.text
      );
    },
    pull,
    setWrapLines: (on: boolean) => {
      view.dispatch({
        effects: wrap.reconfigure(on ? EditorView.lineWrapping : []),
      });
    },
    view,
  };
}

/** The Ask Instrument button over a selection, as a CodeMirror tooltip. */
function askTooltip(onAsk: (state: EditorState) => void): Extension {
  const tooltipsFor = (state: EditorState): readonly Tooltip[] => {
    const range = state.selection.main;
    if (range.empty || state.selection.ranges.length > 1) {
      return [];
    }
    return [
      {
        above: true,
        arrow: false,
        create: (view) => {
          const dom = document.createElement("div");
          dom.className = "cm-ask-tooltip";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "code-ask";
          button.innerHTML = `${mark(14)}<span>Ask Instrument</span>`;
          // Pressing it must not move the caret out of the selection it asks about.
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
          });
          button.addEventListener("click", () => {
            onAsk(view.state);
          });
          dom.append(button);
          return { dom };
        },
        pos: Math.min(range.head, range.anchor),
        strictSide: false,
      },
    ];
  };
  const field = StateField.define<readonly Tooltip[]>({
    create: tooltipsFor,
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
    update: (value, tr) =>
      tr.docChanged || tr.selection ? tooltipsFor(tr.state) : value,
  });
  return field;
}

/** The first line and the last a selection covers, 1-based; one ending at a line's start stops on the line before. */
function linesOf(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(to);
  const last =
    to > from && endLine.from === to && endLine.number > first
      ? endLine.number - 1
      : endLine.number;
  return [first, last] satisfies [number, number];
}

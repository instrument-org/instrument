import {
  AppMention,
  AppMenuRow,
  type ComposerApp,
} from "@/client/components/app-mention";
import {
  type ComposerAction,
  MenuGroupHeader,
} from "@/client/components/composer-add-menu";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { SkillMention } from "@/client/components/skill-mention";
import {
  type ComposerSkill,
  SkillMenuRow,
} from "@/client/components/skill-menu-row";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { useComposerMenuPlacement } from "@/client/hooks/use-composer-menu-placement";
import { type AppMention as AppMentionRef } from "@/client/lib/app-mention";
import { matchComposerActions } from "@/client/lib/composer-action-search";
import { matchSkills, type SkillMatch } from "@/client/lib/skill-search";
import { cn } from "@/client/lib/utils";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
// ProseMirror emits DOM hacks its own stylesheet neutralizes: a trailing <br>
// after a text block ending in an inline leaf, and separator <img>s around
// them. Without this the <br> is a real line break, so the caret after a skill
// token rendered on the next line.
import "prosemirror-view/style/prosemirror.css";
import { EditorView } from "prosemirror-view";
import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  appOfNode,
  deleteTokenBackward,
  deleteTokenForward,
  promptDocFromPastedText,
  promptDocFromText,
  promptSchema,
  promptTextFromDoc,
} from "./prompt-editor-model";

// `baseKeymap` deliberately leaves history out, so undo/redo only work once the
// keys are bound alongside the history plugin.
const editorAttributes = (placeholder?: string) => ({
  "aria-label": placeholder ?? "Prompt",
  class:
    "prompt-editor min-h-12 flex-1 whitespace-pre-wrap break-words text-sm outline-none",
  "data-placeholder": placeholder ?? "",
});

const editorPlugins = () => [
  history(),
  keymap({
    Backspace: deleteTokenBackward,
    Delete: deleteTokenForward,
    "Mod-y": redo,
    "Mod-z": undo,
    // A line in this document is a paragraph -- `promptTextFromDoc` joins them
    // with newlines -- so splitting the block is the soft break. `baseKeymap`
    // binds nothing to Shift-Enter, and the line break the browser would insert
    // on its own has no home in a schema without a hard-break node, so without
    // this the key does nothing at all.
    "Shift-Enter": splitBlock,
    "Shift-Mod-z": redo,
  }),
  keymap(baseKeymap),
];

/**
 * The way in from outside. ProseMirror owns the document, so a writer that is
 * not the user reaches it through this rather than by handing the component a
 * new `value` and hoping the two agree on which of them wrote it last.
 *
 * Every method that edits the document reports through `onChange`, so anything
 * mirroring the text stays accurate without a round trip back through props.
 */
export interface PromptEditorRef {
  clear: () => void;
  focus: () => void;
  getValue: () => string;
  /** Insert at the caret, spaced off from whatever it lands between. */
  insertText: (text: string) => void;
  moveCaretToEnd: () => void;
  /** Replace the whole document: an external reset or a prefill. */
  setValue: (text: string) => void;
}

// What a slash offers, in the order it offers it: the things the composer can
// be given first, then the apps that can be named, then the skills that can
// be run.
type MenuEntry =
  | { action: ComposerAction; labelRanges: null | number[]; type: "action" }
  | { app: ComposerApp; labelRanges: null | number[]; type: "app" }
  | { match: SkillMatch<ComposerSkill>; type: "skill" };

// A token in the document (a skill or an app), paired with the element
// ProseMirror gave its node view so React can render the token into it.
interface TokenChip {
  id: number;
  target: HTMLElement;
  token: { app: AppMentionRef; type: "app" } | { name: string; type: "skill" };
}

// Generous rather than tight: the list scrolls, so a long query that still
// matches broadly should let the user keep looking instead of silently cutting
// off the one they wanted.
const SKILL_MENU_LIMIT = 50;

const menuEntries = (
  actions: ComposerAction[],
  skills: ComposerSkill[],
  apps: ComposerApp[],
  query: string,
): MenuEntry[] => [
  ...matchComposerActions(actions, query).map((match) => ({
    ...match,
    type: "action" as const,
  })),
  // Matched by name the way an action is by its label: an app is named
  // rather than searched, and the two lists read alike under the caret.
  ...matchComposerActions(
    apps.map((app) => ({ app, label: app.name })),
    query,
  ).map((match) => ({
    app: match.action.app,
    labelRanges: match.labelRanges,
    type: "app" as const,
  })),
  ...matchSkills(skills, query, {
    limit: SKILL_MENU_LIMIT,
    scope: "name",
  }).map((match) => ({
    match,
    type: "skill" as const,
  })),
];

// Chooses an entry against the range the slash opened. A skill or an app
// becomes a token in the document; an action leaves nothing behind, because
// the slash was the way in rather than something the prompt was meant to keep.
const applyMenuEntry = (
  view: EditorView,
  range: { from: number; to: number },
  entry: MenuEntry,
) => {
  if (entry.type === "action") {
    view.dispatch(view.state.tr.delete(range.from, range.to));
    view.focus();
    entry.action.onSelect();
    return;
  }
  const node =
    entry.type === "app"
      ? promptSchema.nodes.app.create({
          name: entry.app.name,
          slug: entry.app.slug,
        })
      : promptSchema.nodes.skill.create({ name: entry.match.skill.id });
  const transaction = view.state.tr.replaceRangeWith(
    range.from,
    range.to,
    node,
  );
  transaction.insertText(" ", range.from + node.nodeSize);
  view.dispatch(transaction);
  view.focus();
};

const preventDefault = (event: Event) => {
  event.preventDefault();
};

export function PromptEditor({
  actions,
  apps,
  autoFocus,
  bounds,
  defaultValue,
  disabled,
  onChange,
  onPaste,
  onSubmit,
  placeholder,
  ref,
  skills,
}: {
  /** What the plus button offers, offered here too. */
  actions: ComposerAction[];
  /** The apps a slash can name, each becoming a chip in the words. */
  apps: ComposerApp[];
  autoFocus: boolean;
  /** The composer box a typed slash opens its menu against. */
  bounds: HTMLElement | null;
  /** Read once, when the document is built. Later changes are ignored. */
  defaultValue: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent) => boolean;
  onSubmit: (openInNewTab: boolean) => void;
  placeholder?: string;
  ref?: React.Ref<PromptEditorRef>;
  skills: ComposerSkill[];
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
  const actionsRef = useRef(actions);
  const appsRef = useRef(apps);
  const skillsRef = useRef(skills);
  const menuRef = useRef<null | { from: number; query: string; to: number }>(
    null,
  );
  const onChangeRef = useRef(onChange);
  const onPasteRef = useRef(onPaste);
  const onSubmitRef = useRef(onSubmit);
  const [menu, setMenu] = useState<null | {
    from: number;
    query: string;
    to: number;
  }>(null);
  const [chips, setChips] = useState<TokenChip[]>([]);
  const chipIdRef = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  // Only the keyboard drags the list to its selection. Doing it on hover too
  // would scroll a partly visible row under a stationary cursor, which lands the
  // cursor on the next row and scrolls again.
  const scrollToSelectionRef = useRef(false);
  const [overflowing, setOverflowing] = useState(false);
  const initialPropsRef = useRef({ autoFocus, placeholder });
  // Kept current rather than captured, because the view below is not built only
  // once: a hidden `<Activity>` runs every effect's cleanup, so the task page
  // showing its file list destroys this editor and builds it again on the way
  // back. It has to come back as the draft stands, which is what the mirrored
  // prop carries -- an "add to chat" while the composer was off screen included.
  // Declared above the effect that builds the view so it is already current
  // when that one runs, on a remount as much as on the first mount.
  const defaultValueRef = useRef(defaultValue);
  useLayoutEffect(() => {
    defaultValueRef.current = defaultValue;
  });

  useEffect(() => {
    actionsRef.current = actions;
    appsRef.current = apps;
    skillsRef.current = skills;
    onChangeRef.current = onChange;
    onPasteRef.current = onPaste;
    onSubmitRef.current = onSubmit;
    selectedIndexRef.current = selectedIndex;
  }, [actions, apps, onChange, onPaste, onSubmit, selectedIndex, skills]);
  const entries = menu ? menuEntries(actions, skills, apps, menu.query) : [];
  // Where the apps and the skills start, so the rule that names each is drawn
  // once and only when there is something above it to separate them from.
  const firstAppIndex = entries.findIndex((entry) => entry.type === "app");
  const firstSkillIndex = entries.findIndex((entry) => entry.type === "skill");
  const menuOpen = menu !== null && entries.length > 0;
  const { alignOffset, side, sideOffset, width } = useComposerMenuPlacement({
    anchorRef: columnRef,
    bounds,
    open: menuOpen,
  });

  const updateMenu = (view: EditorView) => {
    const { empty, from } = view.state.selection;
    if (!empty) {
      menuRef.current = null;
      setMenu(null);
      return;
    }
    const before = view.state.doc.textBetween(0, from, "\n", "\uFFFC");
    // The colon belongs to the name: a skill several sources ship is addressed
    // as `claude:pdf`, and stopping the query at the colon would close the menu
    // exactly when the user is disambiguating.
    const match = /(?:^|\s)\/([\w:-]*)$/.exec(before);
    const next = match
      ? {
          from: from - (match[1]?.length ?? 0) - 1,
          query: match[1] ?? "",
          to: from,
        }
      : null;
    menuRef.current = next;
    setMenu(next);
    setSelectedIndex(0);
    scrollToSelectionRef.current = true;
  };

  const selectEntry = (entry: MenuEntry) => {
    const view = viewRef.current;
    const activeMenu = menuRef.current;
    if (view && activeMenu) {
      applyMenuEntry(view, activeMenu, entry);
    }
  };

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const initialProps = initialPropsRef.current;
    const doc = promptDocFromText(defaultValueRef.current);
    const view = new EditorView(mount, {
      attributes: editorAttributes(initialProps.placeholder),
      clipboardTextParser: (text) =>
        Slice.maxOpen(promptDocFromPastedText(text, skillsRef.current).content),
      clipboardTextSerializer: (slice) =>
        promptTextFromDoc(promptSchema.nodes.doc.create(null, slice.content)),
      dispatchTransaction: (transaction) => {
        const nextState = view.state.apply(transaction);
        view.updateState(nextState);
        // Only an edit is a change worth reporting. Focus and caret movement
        // dispatch transactions too, and announcing the document on those means
        // the empty view a page load starts with reports itself as the draft --
        // overwriting the stored one before it has finished loading in.
        if (transaction.docChanged) {
          onChangeRef.current(promptTextFromDoc(nextState.doc));
        }
        updateMenu(view);
      },
      handleDOMEvents: {
        blur: () => {
          menuRef.current = null;
          setMenu(null);
          return false;
        },
        paste: (_view, event) => onPasteRef.current(event),
      },
      handleKeyDown: (_view, event) => {
        const activeMenu = menuRef.current;
        if (activeMenu) {
          const currentEntries = menuEntries(
            actionsRef.current,
            skillsRef.current,
            appsRef.current,
            activeMenu.query,
          );
          if (
            currentEntries.length > 0 &&
            (event.key === "ArrowDown" || event.key === "ArrowUp")
          ) {
            event.preventDefault();
            scrollToSelectionRef.current = true;
            setSelectedIndex((current) => {
              const direction = event.key === "ArrowDown" ? 1 : -1;
              return (
                (current + direction + currentEntries.length) %
                currentEntries.length
              );
            });
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            menuRef.current = null;
            setMenu(null);
            return true;
          }
          if (event.key === "Enter" && currentEntries.length > 0) {
            event.preventDefault();
            const entry = currentEntries[selectedIndexRef.current];
            if (entry) {
              applyMenuEntry(view, activeMenu, entry);
            }
            return true;
          }
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          onSubmitRef.current(event.metaKey || event.ctrlKey);
          return true;
        }
        return false;
      },
      handlePaste: (editorView, event) => {
        const clipboardData = event.clipboardData;
        const text =
          clipboardData?.getData("text/plain") ||
          clipboardData?.getData("Text");
        if (!text) {
          return false;
        }
        const slice = Slice.maxOpen(
          promptDocFromPastedText(text, skillsRef.current).content,
        );
        editorView.dispatch(
          editorView.state.tr
            .replaceSelection(slice)
            .scrollIntoView()
            .setMeta("paste", true)
            .setMeta("uiEvent", "paste"),
        );
        return true;
      },
      // A token in the draft is the same token the sent message will show, so
      // the chip is the transcript's component rendered through a portal rather
      // than a second lookalike built out of the schema's `toDOM`. ProseMirror
      // owns the element; React owns everything inside it.
      nodeViews: {
        app: (node) => {
          const app = appOfNode(node);
          const target = document.createElement("span");
          target.contentEditable = "false";
          target.dataset.app = app?.slug;
          const id = (chipIdRef.current += 1);
          if (app) {
            setChips((current) => [
              ...current,
              { id, target, token: { app, type: "app" } },
            ]);
          }
          return {
            destroy: () => {
              setChips((current) => current.filter((chip) => chip.id !== id));
            },
            dom: target,
            ignoreMutation: () => true,
            stopEvent: () => true,
          };
        },
        skill: (node) => {
          const name = String(node.attrs.name);
          const target = document.createElement("span");
          target.contentEditable = "false";
          target.dataset.skill = name;
          const id = (chipIdRef.current += 1);
          setChips((current) => [
            ...current,
            { id, target, token: { name, type: "skill" } },
          ]);
          return {
            destroy: () => {
              setChips((current) => current.filter((chip) => chip.id !== id));
            },
            dom: target,
            // React's writes below `target` are not document edits.
            ignoreMutation: () => true,
            // The chip is a link with a tooltip; its events are its own.
            stopEvent: () => true,
          };
        },
      },
      state: EditorState.create({
        doc,
        plugins: editorPlugins(),
        schema: promptSchema,
        // Behind the text rather than in front of it: this is a draft being
        // picked back up, so the caret belongs where typing would continue.
        selection: TextSelection.atEnd(doc),
      }),
    });
    viewRef.current = view;
    if (initialProps.autoFocus) {
      view.focus();
    }
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  // ProseMirror maps `editable: false` to `contentEditable="false"`, and the
  // browser blurs a contenteditable element the instant it stops being editable.
  // A native textarea keeps focus when it goes readonly; submitting disables this
  // editor for the in-flight window, so without re-asserting focus the composer
  // goes dead after every send. Remember whether the view held focus when it
  // locked and restore it once editing is allowed again.
  const refocusOnEditableRef = useRef(false);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const editable = !disabled;
    if (!editable) {
      refocusOnEditableRef.current = view.hasFocus();
    }
    view.setProps({ editable: () => editable });
    if (editable && refocusOnEditableRef.current) {
      refocusOnEditableRef.current = false;
      view.focus();
    }
  }, [disabled]);

  // Navigating between skills reuses this view, so the placeholder has to track
  // the prop rather than the value captured when the view was constructed.
  useEffect(() => {
    viewRef.current?.setProps({ attributes: editorAttributes(placeholder) });
  }, [placeholder]);

  // `scroll-fade-y` is only correct while there is something to scroll: Chromium
  // holds a scroll-driven animation at its last committed value once the
  // scroller stops being scrollable, so clearing a draft that was scrolled down
  // would leave the top fade painted over an empty composer. Carrying the
  // utility on and off is what actually retires the animation. Both boxes are
  // measured because they move independently -- the scroller stops growing at
  // its max height, and the editor inside it keeps going.
  useEffect(() => {
    const scroller = mountRef.current;
    if (!scroller) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setOverflowing(scroller.scrollHeight > scroller.clientHeight);
    });
    observer.observe(scroller);
    for (const child of scroller.children) {
      observer.observe(child);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  // Replace the content through a transaction rather than a fresh EditorState:
  // recreating the state drops the history stack, so an external write (the
  // skill prefill, a clear after submit) would silently make undo a no-op.
  const replaceDocument = (text: string) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      promptDocFromText(text).content,
    );
    tr.setSelection(TextSelection.atEnd(tr.doc));
    view.dispatch(tr);
  };

  // What arrives from outside is a discrete thing -- a file path, a folder name
  // -- rather than a continuation of the word the caret sits in, so it is spaced
  // off from whatever it lands between. Only the view knows what that is, which
  // is why the padding is decided here rather than by the caller.
  const insertText = (text: string) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const { $from, $to } = view.state.selection;
    const before = $from.nodeBefore;
    const after = $to.nodeAfter;
    const leading =
      before && !(before.isText && /\s$/.test(before.text ?? "")) ? " " : "";
    const trailing = after?.isText && /^\s/.test(after.text ?? "") ? "" : " ";
    // Parse the composer's serialized skill mentions so one handed in from
    // outside becomes a chip rather than its own markup.
    view.dispatch(
      view.state.tr.replaceSelection(
        Slice.maxOpen(promptDocFromText(leading + text + trailing).content),
      ),
    );
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      replaceDocument("");
    },
    focus: () => viewRef.current?.focus(),
    getValue: () => {
      const view = viewRef.current;
      return view ? promptTextFromDoc(view.state.doc) : "";
    },
    insertText,
    moveCaretToEnd: () => {
      const view = viewRef.current;
      if (!view) {
        return;
      }
      view.dispatch(
        view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
      );
    },
    setValue: replaceDocument,
  }));

  return (
    <Popover open={menuOpen}>
      {/* Fills the column it is placed in rather than carrying a height of its
          own: what there is room for is the composer's question to answer, and
          the scroller below takes whatever that turns out to be. */}
      <PopoverAnchor asChild>
        <div className="flex min-h-0 flex-1 flex-col" ref={columnRef}>
          {/* The fade masks the text only: the composer's background sits on
              the container around this, so the faded edge dissolves into it
              whichever theme is on. */}
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              overflowing && "scroll-fade-y",
            )}
            ref={mountRef}
          />
          {chips.map((chip) =>
            createPortal(
              chip.token.type === "app" ? (
                <AppMention app={chip.token.app} apps={apps} />
              ) : (
                <SkillMention
                  name={chip.token.name}
                  // An empty list means nothing to check against, not a skill
                  // that has gone: only claim a chip is stale once there is a
                  // list.
                  resolved={skills.length > 0}
                  summary={skills.find(
                    (skill) =>
                      chip.token.type === "skill" &&
                      (skill.aliases.includes(chip.token.name) ||
                        skill.qualifiedName === chip.token.name),
                  )}
                  // The composer's own controls stay the tab order; a draft
                  // with several tokens should not put a stop at each one.
                  tabIndex={-1}
                />
              ),
              chip.target,
              String(chip.id),
            ),
          )}
        </div>
      </PopoverAnchor>
      {/*
        The caret owns this menu, so the content must never take focus or claim
        the pointer: the editor keeps both, and closing is driven by where the
        caret ends up (`updateMenu`) or by the editor losing focus. Radix is here
        for the portal and the zoom correction, not for its dismissal behavior --
        and not for where it lands either, which the composer decides so that a
        typed slash and the plus button open the same menu in the same place.

        The corner is the composer's own rather than the popover radius, for the
        same reason the width is the composer's: this is read against the edge of
        the box it hangs off.
      */}
      <PopoverContent
        align="start"
        alignOffset={alignOffset}
        avoidCollisions={false}
        className="overflow-y-auto rounded-[20px] p-1 shadow-lg"
        maxHeight="18rem"
        onCloseAutoFocus={preventDefault}
        onFocusOutside={preventDefault}
        onInteractOutside={preventDefault}
        onOpenAutoFocus={preventDefault}
        side={side}
        sideOffset={sideOffset}
        style={{ width }}
      >
        {entries.map((entry, index) => (
          <Fragment
            key={
              entry.type === "skill"
                ? `skill:${entry.match.skill.id}`
                : entry.type === "app"
                  ? `app:${entry.app.slug}`
                  : `action:${entry.action.id}`
            }
          >
            {index === firstAppIndex && firstAppIndex > 0 && (
              <MenuGroupHeader label="Apps" />
            )}
            {index === firstSkillIndex && firstSkillIndex > 0 && (
              <MenuGroupHeader label="Skills" />
            )}
            <MenuEntryButton
              onHover={() => {
                scrollToSelectionRef.current = false;
                setSelectedIndex(index);
              }}
              onSelect={() => {
                selectEntry(entry);
              }}
              ref={(element) => {
                if (index === selectedIndex && scrollToSelectionRef.current) {
                  element?.scrollIntoView({ block: "nearest" });
                }
              }}
              selected={index === selectedIndex}
            >
              {entry.type === "skill" ? (
                <SkillMenuRow match={entry.match} />
              ) : entry.type === "app" ? (
                <AppMenuRow app={entry.app} ranges={entry.labelRanges} />
              ) : (
                <>
                  <entry.action.icon className="size-4 shrink-0" />
                  <FuzzyHighlight
                    ranges={entry.labelRanges}
                    text={entry.action.label}
                  />
                </>
              )}
            </MenuEntryButton>
          </Fragment>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// Wears the dropdown item's treatment without being one: this list is driven by
// the caret rather than by focus, so the row that would be focused is marked
// rather than actually focused.
function MenuEntryButton({
  children,
  onHover,
  onSelect,
  ref,
  selected,
}: {
  children: React.ReactNode;
  onHover: () => void;
  onSelect: () => void;
  ref: React.Ref<HTMLButtonElement>;
  selected: boolean;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-foreground/60",
        selected && "bg-accent text-foreground",
      )}
      data-highlighted={selected ? "" : undefined}
      // Mousedown rather than click, and defaulted out, so choosing a row never
      // blurs the editor the choice is about to run against.
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
      // Move rather than enter: the list can scroll out from under a cursor
      // that never moved, and that should not count as pointing at a row.
      onMouseMove={() => {
        if (!selected) {
          onHover();
        }
      }}
      ref={ref}
      type="button"
    >
      {children}
    </button>
  );
}

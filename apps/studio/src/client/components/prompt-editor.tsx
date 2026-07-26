import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { SkillMention } from "@/client/components/skill-mention";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { matchSkills, type SkillMatch } from "@/client/lib/skill-search";
import { skillSourceLabel } from "@/client/lib/skill-source";
import { SKILL_NAME_MATCH_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
// ProseMirror emits DOM hacks its own stylesheet neutralizes: a trailing <br>
// after a text block ending in an inline leaf, and separator <img>s around
// them. Without this the <br> is a real line break, so the caret after a skill
// token rendered on the next line.
import "prosemirror-view/style/prosemirror.css";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  deleteSkillBackward,
  deleteSkillForward,
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
    Backspace: deleteSkillBackward,
    Delete: deleteSkillForward,
    "Mod-y": redo,
    "Mod-z": undo,
    "Shift-Mod-z": redo,
  }),
  keymap(baseKeymap),
];

export interface PromptEditorRef {
  element: HTMLElement | null;
  focus: () => void;
  moveCaretToEnd: () => void;
}

type Skill = Pick<
  RPCOutput["workspace"]["skill"]["list"][number],
  "description" | "name" | "source" | "title"
>;

// A skill token in the document, paired with the element ProseMirror gave its
// node view so React can render the token into it.
interface SkillChip {
  id: number;
  name: string;
  target: HTMLElement;
}

// Generous rather than tight: the list scrolls, so a long query that still
// matches broadly should let the user keep looking instead of silently cutting
// off the one they wanted.
const SKILL_MENU_LIMIT = 50;

const preventDefault = (event: Event) => {
  event.preventDefault();
};

export function PromptEditor({
  autoFocus,
  className,
  disabled,
  maxHeight,
  onChange,
  onPaste,
  onSubmit,
  placeholder,
  ref,
  skills,
  value,
}: {
  autoFocus: boolean;
  className?: string;
  disabled: boolean;
  maxHeight: number;
  onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent) => boolean;
  onSubmit: (openInNewTab: boolean) => void;
  placeholder?: string;
  ref?: React.Ref<PromptEditorRef>;
  skills: Skill[];
  value: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
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
  const [chips, setChips] = useState<SkillChip[]>([]);
  const chipIdRef = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  // Only the keyboard drags the list to its selection. Doing it on hover too
  // would scroll a partly visible row under a stationary cursor, which lands the
  // cursor on the next row and scrolls again.
  const scrollToSelectionRef = useRef(false);
  const initialPropsRef = useRef({ autoFocus, placeholder, value });

  useEffect(() => {
    skillsRef.current = skills;
    onChangeRef.current = onChange;
    onPasteRef.current = onPaste;
    onSubmitRef.current = onSubmit;
    selectedIndexRef.current = selectedIndex;
  }, [onChange, onPaste, onSubmit, selectedIndex, skills]);
  const matches = menu ? matchSkills(skills, menu.query, SKILL_MENU_LIMIT) : [];

  const updateMenu = (view: EditorView) => {
    const { empty, from } = view.state.selection;
    if (!empty) {
      menuRef.current = null;
      setMenu(null);
      return;
    }
    const before = view.state.doc.textBetween(0, from, "\n", "\uFFFC");
    const match = /(?:^|\s)\/([\w-]*)$/.exec(before);
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

  const insertSkill = (skill: Skill) => {
    const view = viewRef.current;
    const activeMenu = menuRef.current;
    if (!view || !activeMenu) {
      return;
    }
    const node = promptSchema.nodes.skill.create({ name: skill.name });
    const transaction = view.state.tr.replaceRangeWith(
      activeMenu.from,
      activeMenu.to,
      node,
    );
    transaction.insertText(" ", activeMenu.from + node.nodeSize);
    view.dispatch(transaction);
    view.focus();
  };

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const initialProps = initialPropsRef.current;
    const view = new EditorView(mount, {
      attributes: editorAttributes(initialProps.placeholder),
      clipboardTextParser: (text) =>
        Slice.maxOpen(promptDocFromText(text).content),
      clipboardTextSerializer: (slice) =>
        promptTextFromDoc(promptSchema.nodes.doc.create(null, slice.content)),
      dispatchTransaction: (transaction) => {
        const nextState = view.state.apply(transaction);
        view.updateState(nextState);
        onChangeRef.current(promptTextFromDoc(nextState.doc));
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
          const currentMatches = matchSkills(
            skillsRef.current,
            activeMenu.query,
            SKILL_MENU_LIMIT,
          );
          if (
            currentMatches.length > 0 &&
            (event.key === "ArrowDown" || event.key === "ArrowUp")
          ) {
            event.preventDefault();
            scrollToSelectionRef.current = true;
            setSelectedIndex((current) => {
              const direction = event.key === "ArrowDown" ? 1 : -1;
              return (
                (current + direction + currentMatches.length) %
                currentMatches.length
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
          if (event.key === "Enter" && currentMatches.length > 0) {
            event.preventDefault();
            const match = currentMatches[selectedIndexRef.current];
            if (match) {
              insertSkill(match.skill);
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
      // A token in the draft is the same token the sent message will show, so
      // the chip is the transcript's component rendered through a portal rather
      // than a second lookalike built out of the schema's `toDOM`. ProseMirror
      // owns the element; React owns everything inside it.
      nodeViews: {
        skill: (node) => {
          const name = String(node.attrs.name);
          const target = document.createElement("span");
          target.contentEditable = "false";
          target.dataset.skill = name;
          const id = (chipIdRef.current += 1);
          setChips((current) => [...current, { id, name, target }]);
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
        doc: promptDocFromText(initialProps.value),
        plugins: editorPlugins(),
        schema: promptSchema,
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

  // Replace the content through a transaction rather than a fresh EditorState:
  // recreating the state drops the history stack, so an external value change
  // (the skill prefill, a clear after submit) would silently make undo a no-op.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || promptTextFromDoc(view.state.doc) === value) {
      return;
    }
    const doc = promptDocFromText(value);
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      doc.content,
    );
    tr.setSelection(TextSelection.atEnd(tr.doc));
    view.dispatch(tr);
  }, [value]);

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

  useImperativeHandle(ref, () => ({
    element: viewRef.current?.dom ?? null,
    focus: () => viewRef.current?.focus(),
    moveCaretToEnd: () => {
      const view = viewRef.current;
      if (!view) {
        return;
      }
      view.dispatch(
        view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
      );
    },
  }));

  return (
    <Popover open={menu !== null && matches.length > 0}>
      <PopoverAnchor asChild>
        <div className={className}>
          <div
            className="overflow-y-auto"
            ref={mountRef}
            style={{ maxHeight }}
          />
          {chips.map((chip) =>
            createPortal(
              <SkillMention
                name={chip.name}
                // An empty list means nothing to check against, not a skill that
                // has gone: only claim a chip is stale once there is a list.
                resolved={skills.length > 0}
                summary={skills.find((skill) => skill.name === chip.name)}
                // The composer's own controls stay the tab order; a draft with
                // several tokens should not put a stop at each one.
                tabIndex={-1}
              />,
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
        for the portal, the collision-aware placement and the zoom correction,
        not for its dismissal behavior.

        `--radix-popover-trigger-width` and `--radix-popover-content-available-
        height` are measured on screen, while the content re-applies zoom to its
        own layout units, so both are divided by `--content-zoom` to land back at
        the composer's width and inside the window.
      */}
      <PopoverContent
        align="start"
        className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-[calc(var(--radix-popover-trigger-width)/var(--content-zoom))] overflow-y-auto p-1 shadow-lg"
        onCloseAutoFocus={preventDefault}
        onFocusOutside={preventDefault}
        onInteractOutside={preventDefault}
        onOpenAutoFocus={preventDefault}
        side="top"
        sideOffset={8}
      >
        {matches.map((match, index) => (
          <SkillMenuItem
            key={match.skill.name}
            match={match}
            onHover={() => {
              scrollToSelectionRef.current = false;
              setSelectedIndex(index);
            }}
            onSelect={() => {
              insertSkill(match.skill);
            }}
            ref={(element) => {
              if (index === selectedIndex && scrollToSelectionRef.current) {
                element?.scrollIntoView({ block: "nearest" });
              }
            }}
            selected={index === selectedIndex}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function SkillMenuItem({
  match,
  onHover,
  onSelect,
  ref,
  selected,
}: {
  match: SkillMatch<Skill>;
  onHover: () => void;
  onSelect: () => void;
  ref: React.Ref<HTMLButtonElement>;
  selected: boolean;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
        selected && "bg-accent text-accent-foreground",
      )}
      data-highlighted={selected ? "" : undefined}
      key={match.skill.name}
      // Mousedown rather than click, and defaulted out, so choosing a skill
      // never blurs the editor the insertion is about to run against.
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
      <span className="shrink-0 font-mono text-sm font-medium">
        /
        <FuzzyHighlight
          matchClassName={SKILL_NAME_MATCH_CLASS_NAME}
          ranges={match.nameRanges}
          text={match.skill.name}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        <FuzzyHighlight
          ranges={match.descriptionRanges}
          text={match.skill.description}
        />
      </span>
      <span className="shrink-0 text-xs text-muted-foreground/70">
        {skillSourceLabel(match.skill.source)}
      </span>
    </button>
  );
}

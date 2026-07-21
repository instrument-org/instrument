import { cn } from "@/client/lib/utils";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  deleteSkillBackward,
  promptDocFromText,
  promptSchema,
  promptTextFromDoc,
} from "./prompt-editor-model";

// `baseKeymap` deliberately leaves history out, so undo/redo only work once the
// keys are bound alongside the history plugin.
const editorAttributes = (placeholder?: string) => ({
  "aria-label": placeholder ?? "Prompt",
  class:
    "prompt-editor max-h-full min-h-12 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm outline-none",
  "data-placeholder": placeholder ?? "",
});

const editorPlugins = () => [
  history(),
  keymap({
    Backspace: deleteSkillBackward,
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

interface Skill {
  description: string;
  name: string;
}

export function PromptEditor({
  autoFocus,
  className,
  disabled,
  maxHeight,
  onChange,
  onPaste,
  onSubmit,
  placeholder,
  readOnly,
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
  readOnly: boolean;
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const initialPropsRef = useRef({ autoFocus, placeholder, value });

  useEffect(() => {
    skillsRef.current = skills;
    onChangeRef.current = onChange;
    onPasteRef.current = onPaste;
    onSubmitRef.current = onSubmit;
    selectedIndexRef.current = selectedIndex;
  }, [onChange, onPaste, onSubmit, selectedIndex, skills]);
  const matches = menu
    ? skills
        .filter((skill) =>
          `${skill.name} ${skill.description}`
            .toLocaleLowerCase()
            .includes(menu.query.toLocaleLowerCase()),
        )
        .slice(0, 8)
    : [];

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
        paste: (_view, event) => onPasteRef.current(event),
      },
      handleKeyDown: (_view, event) => {
        const activeMenu = menuRef.current;
        if (activeMenu) {
          const currentMatches = skillsRef.current
            .filter((skill) =>
              `${skill.name} ${skill.description}`
                .toLocaleLowerCase()
                .includes(activeMenu.query.toLocaleLowerCase()),
            )
            .slice(0, 8);
          if (
            currentMatches.length > 0 &&
            (event.key === "ArrowDown" || event.key === "ArrowUp")
          ) {
            event.preventDefault();
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
            const skill = currentMatches[selectedIndexRef.current];
            if (skill) {
              insertSkill(skill);
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

  useEffect(() => {
    viewRef.current?.setProps({ editable: () => !disabled && !readOnly });
  }, [disabled, readOnly]);

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
    <div className={cn("relative", className)} style={{ maxHeight }}>
      <div className="max-h-full" ref={mountRef} />
      {menu && matches.length > 0 ? (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">
          {matches.map((skill, index) => (
            <button
              className={cn(
                "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left",
                index === selectedIndex && "bg-accent",
              )}
              key={skill.name}
              onMouseDown={(event) => {
                event.preventDefault();
                insertSkill(skill);
              }}
              type="button"
            >
              <span className="shrink-0 font-mono text-sm font-medium">
                /{skill.name}
              </span>
              <span className="line-clamp-1 text-sm text-muted-foreground">
                {skill.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

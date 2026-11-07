import "@milkdown/crepe/theme/common/style.css";

import "./markdown-editor.css";

import { cn } from "@/client/lib/utils";
import { toast } from "@/client/lib/toast";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { createValueSession, type ValueSession } from "./value-session";

/**
 * Markdown a form owns, in the editor Files edits a Markdown file in, with
 * headings and lists drawn as they are typed. It saves nothing: every edit
 * goes to `onChange`, and the form writes the value when the person saves.
 * A `value` from outside the editor, such as dictated words, replaces what
 * it holds.
 */
export function MarkdownValueEditor({
  className,
  label,
  onChange,
  placeholder,
  value,
}: {
  className?: string;
  /** The editor's accessible name, which a form's label would otherwise give a field. */
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<ValueSession | null>(null);
  const changed = useEffectEvent((next: string) => {
    onChange(next);
  });
  // Read once, at the start: after that the editor holds the value, and
  // `value` reaches it only through `setValue`.
  const initial = useRef(value);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    let live = true;
    const created = createValueSession({
      onChange: (next) => {
        changed(next);
      },
      placeholder,
      root,
      value: initial.current,
    });
    void created.then(
      (next) => {
        if (live) {
          setSession(next);
        } else {
          void next.destroy();
        }
      },
      (error: unknown) => {
        toast.error("Couldn't open the editor", { cause: error });
      },
    );
    return () => {
      live = false;
      void created.then((next) => next.destroy());
    };
    // The session is the value's for the component's life; a new value is
    // handed over below rather than starting the editor over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    session?.setValue(value);
  }, [session, value]);

  useEffect(() => {
    const editable = rootRef.current?.querySelector(".ProseMirror");
    editable?.setAttribute("aria-label", label);
  }, [session, label]);

  return <div className={cn("md-editor", className)} ref={rootRef} />;
}

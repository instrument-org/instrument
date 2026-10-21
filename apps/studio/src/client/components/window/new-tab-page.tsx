import { registerInPageCommandMenu } from "@/client/atoms/command-menu";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { useEffect, useId, useRef, useState } from "react";

import {
  COMMAND_MENU_PLACEHOLDER,
  CommandMenuField,
  CommandMenuList,
  useCommandMenuRows,
} from "./command-menu";
import { useWindow } from "./context";

/**
 * A new tab: the command menu laid into the page with the caret in it,
 * under a greeting, and the same rows Cmd+K shows. Whatever is picked sends
 * this tab there. The line under the menu names Cmd+K, so the tab teaches
 * the menu, and Cmd+K here puts the caret back in it.
 */
export function NewTabPage() {
  const { openPage, openScreen } = useWindow();
  const isActive = useIsActiveTab();
  const [words, setWords] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const {
    isBang,
    rows,
    selection,
    words: shown,
  } = useCommandMenuRows({
    active: isActive,
    done: (run) => run,
    openPage,
    openScreen,
    surface: "page",
    words: words.trim(),
  });

  // The caret is in the menu whenever the tab comes up, and Cmd+K finds it
  // there rather than opening a second menu over it.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    inputRef.current?.focus();
    return registerInPageCommandMenu(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isActive]);

  return (
    // Centered in the tab, the menu a fixed height that shows the first
    // handful of rows, and shorter in a short window, where the greeting and
    // the line under it stay in view. The list scrolls either way.
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-muted/20 px-4 py-10">
      <h1 className="mb-6 shrink-0 text-[22px] font-medium tracking-tight">
        <Greeting />
      </h1>
      <div className="flex h-100 min-h-40 w-full max-w-160 shrink flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex size-full flex-col overflow-hidden rounded-md bg-card text-popover-foreground">
          <CommandMenuField
            className="text-sm"
            containerClassName="h-12 shrink-0 border-b px-4"
            listId={listId}
            onValueChange={setWords}
            placeholder={COMMAND_MENU_PLACEHOLDER}
            ref={inputRef}
            rows={rows}
            selection={selection}
            value={words}
          />
          <CommandMenuList
            className="min-h-0 flex-1"
            isBang={isBang}
            itemClassName="py-1.5"
            listId={listId}
            rows={rows}
            selection={selection}
            words={shown}
          />
        </div>
      </div>
      <p className="mt-4 shrink-0 text-[13px] text-muted-foreground">
        Press{" "}
        <kbd className="rounded-md bg-foreground/5 px-1.5 py-0.5 font-sans text-[11px] font-medium ring-1 ring-foreground/10">
          {formatAcceleratorText(WINDOW_SHORTCUTS.commandMenu.accelerator)}
        </kbd>{" "}
        to search from anywhere.
      </p>
    </div>
  );
}

/** Good morning, afternoon or evening, by the person's first name once they are signed in. */
function Greeting() {
  const { data: user } = useLiveUser();
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = user?.name.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

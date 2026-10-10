import { registerInPageCommandMenu } from "@/client/atoms/command-menu";
import { Command, CommandInput } from "@/client/components/ui/command";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { useEffect, useRef, useState } from "react";

import {
  COMMAND_MENU_PLACEHOLDER,
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

  const {
    isBang,
    rows,
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
    // Centered in the tab, the menu as tall as most of it allows, and
    // shorter in a short window, where the greeting and the line under it
    // stay in view and the list scrolls.
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-muted/20 px-4 py-10">
      <h1 className="mb-6 shrink-0 text-[22px] font-medium tracking-tight">
        <Greeting />
      </h1>
      <div className="flex h-150 min-h-40 w-full max-w-160 shrink flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Command className="bg-card" loop shouldFilter={false}>
          <CommandInput
            className="text-sm"
            containerClassName="h-12 shrink-0 border-b px-4"
            onValueChange={setWords}
            placeholder={COMMAND_MENU_PLACEHOLDER}
            ref={inputRef}
            value={words}
          />
          <CommandMenuList
            className="max-h-none! min-h-0 flex-1 overflow-hidden!"
            isBang={isBang}
            rows={rows}
            words={shown}
          />
        </Command>
      </div>
      <p className="mt-4 shrink-0 text-[13px] text-muted-foreground">
        Press{" "}
        <kbd className="rounded-md bg-foreground/5 px-1.5 py-0.5 font-sans text-[11px] font-medium ring-1 ring-foreground/10">
          {formatAccelerator(WINDOW_SHORTCUTS.commandMenu.accelerator).join("")}
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

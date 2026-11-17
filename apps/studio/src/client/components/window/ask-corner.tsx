import { NEW_TAB_HREF } from "@/client/atoms/window";
import {
  DictationControls,
  DictationReadout,
  useCanDictate,
} from "@/client/components/dictation-controls";
import { ShortcutKeys } from "@/client/components/shortcut-keys";
import { makeNewChatDraftAtom } from "@/client/drafts/new-chat-box";
import { isDictating, useDictation } from "@/client/hooks/use-dictation";
import { onPagePress } from "@/client/lib/browser-pool";
import { cn, commandKeyHeld } from "@/client/lib/utils";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useAskCornerRequest } from "./ask-corner-state";
import { IdeaRows } from "./idea-rows";
import { useShell } from "./shell-context";
import { type GroupLayout, isChatTab, isNewChatTab } from "./tab-model";
import {
  ideaTabsOf,
  useIdeasAvailable,
  useIdeasConnection,
  useTabIdeas,
} from "./use-tab-ideas";
import { useWindowTabs } from "./window-tabs";

/** The corner's width at rest, whatever it shows, and open. */
const REST_WIDTH = "w-[280px]";
const OPEN_WIDTH = "w-[360px]";

const LABEL = "Ask about this page";

/**
 * The Ask corner, at the top right of a tab group with no chat in it: a
 * label until an idea for the group's tabs is ready, then that idea, rising
 * in, and never changing under the pointer; ⌘J beside it either way. A
 * click or ⌘J opens it into a field with the ideas as next-message rows
 * under it: ↓ and ↑ move through them and ↩ takes the one marked, ⌘↩ takes
 * the first, typing writes your own. The microphone talks into it in place,
 * without ideas. Sending makes a chat with the message sent, as the group's
 * right side, or as a new tab on that side when it already has one. It never
 * answers in place. Esc steps back from a marked idea, then closes; a click
 * anywhere else folds it back, keeping what was typed. A group with a
 * chat (or a new tab, which has ideas of its own) has no corner, and neither
 * does a connection with no fast model.
 */
export function AskCorner({
  group,
  layout,
}: {
  group: string;
  layout: GroupLayout;
}) {
  const hasConnection = useIdeasConnection();
  const hasChat = layout.sides.some((side) =>
    side.tabs.some(
      (tab) => isChatTab(tab) || (tab.id === side.up && isNewChatTab(tab)),
    ),
  );
  if (!hasConnection || hasChat) {
    return null;
  }
  return <Corner group={group} layout={layout} />;
}

function Corner({ group, layout }: { group: string; layout: GroupLayout }) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const makeDraft = useSetAtom(makeNewChatDraftAtom);
  const [isOpen, setIsOpen] = useState(false);
  const [words, setWords] = useState("");
  const [isDictated, setIsDictated] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  // The idea the arrow keys are on; none while the field itself is.
  const [highlighted, setHighlighted] = useState<number>();
  const inputRef = useRef<HTMLInputElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const ideasOn = useIdeasAvailable();
  const ideas = useTabIdeas({
    held: isOpen,
    isOn: ideasOn,
    tabs: ideaTabsOf(layout),
    trigger: "tabs",
  });
  // What the corner shows stays put under the pointer and while open.
  const [shown, setShown] = useState<readonly string[]>([]);
  if (
    !isHovered &&
    !isOpen &&
    !ideas.isWaiting &&
    shown.join("\n") !== ideas.lines.join("\n")
  ) {
    setShown(ideas.lines);
  }
  const canDictate = useCanDictate();
  const dictation = useDictation({
    onText: (text) => {
      setWords((current) => (current ? `${current} ${text}` : text));
      setIsDictated(true);
    },
    surface: "composer",
  });
  const talking = isDictating(dictation.phase);

  // The latest window, for a send that waits a frame for the tab it opened.
  const latest = useRef({ shell });
  useEffect(() => {
    latest.current = { shell };
  });

  const open = () => {
    // The field takes the keyboard before the next frame, when a press in
    // the group puts the keyboard it finds on nothing in the group's page
    // (`placeCaretAfterPress`).
    flushSync(() => {
      setIsOpen(true);
    });
    inputRef.current?.focus();
  };
  /** Back to rest, what was typed kept. */
  const collapse = () => {
    setIsOpen(false);
    setHighlighted(undefined);
  };
  const close = () => {
    collapse();
    setWords("");
    setIsDictated(false);
  };
  useAskCornerRequest(open);

  // A click anywhere else folds it back. A click into a page reaches its
  // guest, never this document, so main reports that one.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !cornerRef.current?.contains(event.target)
      ) {
        collapse();
      }
    };
    window.addEventListener("pointerdown", onDown, { capture: true });
    const stopPagePresses = onPagePress(collapse);
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true });
      stopPagePresses();
    };
  }, [isOpen]);

  const send = (prompt: string) => {
    const text = prompt.trim();
    if (!text) {
      return;
    }
    close();
    const right = layout.sides[1];
    const tabId = windowTabs.openScreen(NEW_TAB_HREF, {
      group,
      select: true,
      side: 1,
      ...(right?.up === undefined ? {} : { after: right.up }),
    });
    if (tabId === undefined) {
      return;
    }
    const draftId = makeDraft({ tabId, words: text });
    // Once the window has the tab, so the chat starts with the group as it
    // now stands.
    requestAnimationFrame(() => {
      const { shell: now } = latest.current;
      if (now.defaultModelURI !== undefined) {
        now.startChat(
          draftId,
          { modelURI: now.defaultModelURI, prompt: text },
          tabId,
        );
      }
    });
  };

  const idea = shown[0];
  const hasWords = words.trim() !== "";
  const rows = !isDictated && !talking ? shown : [];
  const marked = highlighted === undefined ? undefined : rows[highlighted];

  return (
    <div
      className={cn(
        "relative mr-1 h-8 shrink-0 [-webkit-app-region:no-drag]",
        REST_WIDTH,
      )}
      ref={cornerRef}
    >
      {isOpen ? (
        <div
          className={cn(
            "absolute top-0 right-0 z-30 flex flex-col rounded-2xl bg-popover text-popover-foreground shadow-float-lg ring-1 ring-foreground/8",
            OPEN_WIDTH,
          )}
        >
          <form
            className="flex h-8 items-center gap-0.5 pr-1 pl-2.5 text-[13px]"
            onSubmit={(event) => {
              event.preventDefault();
              send(marked ?? words);
            }}
          >
            <input
              aria-label={LABEL}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                setWords(event.target.value);
                setHighlighted(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (highlighted === undefined) {
                    close();
                  } else {
                    setHighlighted(undefined);
                  }
                } else if (event.key === "ArrowDown" && rows.length > 0) {
                  event.preventDefault();
                  setHighlighted(
                    Math.min((highlighted ?? -1) + 1, rows.length - 1),
                  );
                } else if (event.key === "ArrowUp" && rows.length > 0) {
                  event.preventDefault();
                  setHighlighted(
                    highlighted === undefined || highlighted === 0
                      ? undefined
                      : highlighted - 1,
                  );
                } else if (event.key === "Enter" && commandKeyHeld(event)) {
                  event.preventDefault();
                  send(marked ?? (hasWords ? words : (idea ?? "")));
                }
              }}
              placeholder={LABEL}
              ref={inputRef}
              value={words}
            />
            {canDictate && (
              <DictationControls dictation={dictation} size="sm" />
            )}
            <button
              aria-label="Send"
              className={cn(
                "grid size-[22px] shrink-0 place-items-center rounded-full",
                hasWords || marked
                  ? "bg-brand-600 text-white"
                  : "bg-foreground/10 text-background",
              )}
              disabled={!hasWords && !marked}
              type="submit"
            >
              <ArrowUpIcon size={13} weight="bold" />
            </button>
          </form>
          {rows.length > 0 && (
            <IdeaRows
              className="px-3 pt-0.5 pb-2"
              highlighted={highlighted}
              isBoxEmpty={!hasWords}
              lines={rows}
              onSend={send}
            />
          )}
        </div>
      ) : (
        <div
          className={cn(
            "absolute inset-0 flex items-center gap-0.5 rounded-xl pr-1 pl-2.5 text-[13px]",
            talking
              ? "bg-popover text-popover-foreground ring-1 ring-foreground/15"
              : isHovered
                ? "bg-foreground/8"
                : "bg-foreground/[0.045]",
          )}
          onPointerEnter={() => {
            setIsHovered(true);
          }}
          onPointerLeave={() => {
            setIsHovered(false);
          }}
        >
          {talking ? (
            <DictationReadout
              className="min-w-0 flex-1"
              dictation={dictation}
            />
          ) : (
            <button
              className="flex h-full min-w-0 flex-1 items-center overflow-hidden text-left"
              onClick={open}
              type="button"
            >
              {hasWords ? (
                <span className="truncate text-foreground">{words}</span>
              ) : idea ? (
                <span
                  className="animate-in truncate text-foreground/80 duration-200 fade-in-0 slide-in-from-bottom-2"
                  key={idea}
                >
                  {idea}
                </span>
              ) : (
                <span className="truncate text-muted-foreground">{LABEL}</span>
              )}
            </button>
          )}
          <span className="shrink-0 pr-1 pl-2 opacity-70">
            <ShortcutKeys
              accelerator={WINDOW_SHORTCUTS.askAboutPage.accelerator}
            />
          </span>
          {canDictate && <DictationControls dictation={dictation} size="sm" />}
          {hasWords && !talking && (
            <button
              aria-label="Send"
              className="grid size-[22px] shrink-0 place-items-center rounded-full bg-brand-600 text-white"
              onClick={() => {
                send(words);
              }}
              type="button"
            >
              <ArrowUpIcon size={13} weight="bold" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

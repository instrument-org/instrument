import { NEW_TAB_HREF } from "@/client/atoms/window";
import {
  DictationControls,
  DictationReadout,
  useCanDictate,
} from "@/client/components/dictation-controls";
import { ShortcutKeys } from "@/client/components/shortcut-keys";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { makeNewChatDraftAtom } from "@/client/drafts/new-chat-box";
import { createDraftAtom } from "@/client/drafts/store";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { isDictating, useDictation } from "@/client/hooks/use-dictation";
import { onPagePress } from "@/client/lib/browser-pool";
import { cn, commandKeyHeld } from "@/client/lib/utils";
import { type Draft } from "@/shared/drafts";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ulid } from "ulid";

import { useAskCornerRequest } from "./ask-corner-state";
import { IdeaRows } from "./idea-rows";
import { useShell } from "./shell-context";
import { type GroupLayout, isChatTab, isNewChatTab } from "./tab-model";
import {
  ideaTabsOf,
  noteIdeaTaken,
  useIdeasAvailable,
  useIdeasConnection,
  useIdeasPaceOnMoves,
  useTabIdeas,
} from "./use-tab-ideas";
import { newChatHref } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/** The corner's width at rest, whatever it shows, and open. */
const REST_WIDTH = "w-[280px]";
const OPEN_WIDTH = "w-[360px]";

const LABEL = "Ask about this page";

/**
 * The Ask corner, at the top right of a tab group with no chat in it: a
 * label with ⌘J until an idea for the group's tabs as they are now is
 * ready, then that idea, rising in, across the corner, ⌘J only under the
 * pointer; never changing under the pointer. A click or ⌘J asks for ideas
 * and opens it into a field with them as next-message rows under it: ↓ and
 * ↑ move through them and ↩ takes the one marked, ⌘↩ takes the first,
 * typing writes your own. The microphone talks into it in place, without
 * ideas. Sending makes a chat with the message sent, as the group's right
 * side, or as a new tab on that side when it already has one. It never
 * answers in place. ⇧↩ or the expand button opens that new tab's full box
 * instead, with the words or the marked idea in it and nothing sent, for a
 * message that wants files, another model or more room. Esc steps back from a marked idea, then closes; a click
 * anywhere else folds it back, keeping what was typed. A group with a chat
 * (or a new tab, which has ideas of its own) has no corner, and neither
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
  useIdeasPaceOnMoves(layout);
  if (!hasConnection || hasChat) {
    return null;
  }
  return <Corner group={group} layout={layout} />;
}

function Corner({ group, layout }: { group: string; layout: GroupLayout }) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const makeDraft = useSetAtom(makeNewChatDraftAtom);
  const createDraft = useSetAtom(createDraftAtom);
  const [isOpen, setIsOpen] = useState(false);
  const [words, setWords] = useState("");
  const [isDictated, setIsDictated] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  // The idea the arrow keys are on; none while the field itself is.
  const [highlighted, setHighlighted] = useState<number>();
  const inputRef = useRef<HTMLInputElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const isShown = useIsActiveTab();
  const ideasOn = useIdeasAvailable();
  const ideas = useTabIdeas({
    held: isOpen,
    isOn: ideasOn,
    tabs: ideaTabsOf(layout),
    trigger: "tabs",
  });
  // What the corner shows stays put under the pointer and while open, where
  // ideas may still rise in under an empty field.
  const [shown, setShown] = useState<readonly string[]>([]);
  if (
    ((!isHovered && !isOpen) || (isOpen && shown.length === 0)) &&
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
    ideas.ask();
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
  useAskCornerRequest(isShown ? open : null);

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
    // A press on the tab strip or the title bar would move the window
    // instead of reaching this document.
    document.documentElement.toggleAttribute("data-no-window-drag", true);
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true });
      stopPagePresses();
      document.documentElement.removeAttribute("data-no-window-drag");
    };
  }, [isOpen]);

  /** A new tab as the group's right side, or beside what that side shows. */
  const openOnRight = (href = NEW_TAB_HREF) => {
    const right = layout.sides[1];
    return windowTabs.openScreen(href, {
      group,
      select: true,
      side: 1,
      ...(right?.up === undefined ? {} : { after: right.up }),
    });
  };

  const send = (prompt: string) => {
    const text = prompt.trim();
    if (!text) {
      return;
    }
    close();
    const tabId = openOnRight();
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

  const take = (line: string) => {
    if (line.trim() === "") {
      return;
    }
    noteIdeaTaken();
    send(line);
  };

  const idea = shown[0];
  const hasWords = words.trim() !== "";
  const rows = !isDictated && !talking ? shown : [];
  const marked = highlighted === undefined ? undefined : rows[highlighted];

  /**
   * The new tab send would make, its box holding the words, unsent: a draft
   * with them, opened at its address, which puts them in the box.
   */
  const openInChat = () => {
    const text = (marked ?? words).trim();
    if (marked !== undefined) {
      noteIdeaTaken();
    }
    close();
    if (!text) {
      openOnRight();
      return;
    }
    const now = Date.now();
    const draft = {
      createdAt: now,
      id: ulid(),
      updatedAt: now,
      words: text,
    } satisfies Draft;
    createDraft(draft);
    openOnRight(newChatHref(draft.id));
  };

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
              if (marked === undefined) {
                send(words);
              } else {
                take(marked);
              }
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
                } else if (
                  event.key === "Enter" &&
                  event.shiftKey &&
                  !commandKeyHeld(event)
                ) {
                  event.preventDefault();
                  openInChat();
                } else if (event.key === "Enter" && commandKeyHeld(event)) {
                  event.preventDefault();
                  if (marked === undefined && hasWords) {
                    send(words);
                  } else {
                    take(marked ?? idea ?? "");
                  }
                }
              }}
              placeholder={LABEL}
              ref={inputRef}
              value={words}
            />
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  aria-label="Open in a chat"
                  className="grid size-[22px] shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                  onClick={openInChat}
                  type="button"
                >
                  <ArrowsOutSimpleIcon size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-2" side="bottom">
                Open in a chat
                <ShortcutKeys accelerator="Shift+Enter" />
              </TooltipContent>
            </Tooltip>
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
              onSend={take}
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
          {!talking && (isHovered || (!hasWords && !idea)) && (
            <span className="shrink-0 pr-1 pl-2 opacity-70">
              <ShortcutKeys
                accelerator={WINDOW_SHORTCUTS.askAboutPage.accelerator}
              />
            </span>
          )}
          {canDictate && (
            <DictationControls
              dictation={dictation}
              size="sm"
              waveClassName="h-4 w-10"
            />
          )}
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

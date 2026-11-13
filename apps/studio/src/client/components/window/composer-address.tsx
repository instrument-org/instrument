import { noteTypedPage } from "@/client/hooks/use-browser-history";
import { cn } from "@/client/lib/utils";
import { siteFromWords } from "@/client/lib/site-from-words";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useState,
} from "react";

import { type OmniRow, useOmnibarRows } from "./omnibar";

/** Past this many words, what is typed reads as a message, and nothing is offered. */
const WORDS_OFFERED = 4;
const LETTERS_OFFERED = 80;

/**
 * An address or a search typed at the start of a new chat, answered the way
 * the address field answers it but from the computer alone: the rows above
 * the composer, the site, the search and pages from bookmarks and history,
 * while the words are a single short line. An address opens on Enter; any
 * other row opens when the arrows pick it or it is pressed; and Enter on
 * plain words sends them to the chat as ever. Words past a few are a message,
 * so nothing is offered for them.
 *
 * The box is told through `boxProps`, laid on an element around the
 * composer: what is typed is read off the editor as it changes, and the keys
 * the rows take are caught before the editor sees them.
 */
export function useComposerAddress({
  onCleared,
  onOpen,
}: {
  /** Empties the composer once a row has opened what it names. */
  onCleared: () => void;
  /** Opens a page beside the chat. */
  onOpen: (url: string) => void;
}): {
  boxProps: {
    onInput: (event: FormEvent<HTMLElement>) => void;
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
  };
  rows: ReactNode;
} {
  const [typed, setTyped] = useState("");
  // The arrows' pick, or none; and words Escape put the rows away for.
  const [picked, setPicked] = useState<number>();
  const [dismissed, setDismissed] = useState<string>();
  const words = typed.trim();
  const isOffered =
    words !== "" &&
    !words.includes("\n") &&
    words.length <= LETTERS_OFFERED &&
    words.split(/\s+/).length <= WORDS_OFFERED &&
    dismissed !== words;

  const open = (url: string) => {
    noteTypedPage(url);
    onOpen(url);
    onCleared();
    setTyped("");
    setPicked(undefined);
  };
  // Words typed into a chat stay on the computer until they are sent, so
  // nothing goes to the engine for suggestions.
  const found = useOmnibarRows({
    asksEngine: false,
    canComplete: false,
    isEditing: isOffered,
    location: { kind: "newTab" },
    mode: "web",
    open: {
      openFolder: () => undefined,
      openPath: async () => {},
      openSite: open,
      visit: () => undefined,
    },
    typed: isOffered ? words : "",
  });
  // The web's rows alone: a path typed here is words for the chat.
  const rows = isOffered ? found.rows.filter((row) => row.id !== "path") : [];
  // An address is what Enter opens unless the arrows picked another row.
  const isAddress = siteFromWords(words) !== undefined;
  const current =
    picked !== undefined && picked < rows.length
      ? picked
      : isAddress && rows.length > 0
        ? 0
        : undefined;

  const run = (row: OmniRow | undefined) => {
    row?.run();
  };

  return {
    boxProps: {
      onInput: (event) => {
        const editor =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[contenteditable=true]")
            : null;
        if (editor) {
          setTyped(editor.innerText);
          setPicked(undefined);
        }
      },
      onKeyDownCapture: (event) => {
        if (rows.length === 0 || event.nativeEvent.isComposing) {
          return;
        }
        const take = () => {
          event.preventDefault();
          event.stopPropagation();
        };
        switch (event.key) {
          case "ArrowDown": {
            take();
            setPicked(Math.min(rows.length - 1, (current ?? -1) + 1));
            break;
          }
          case "ArrowUp": {
            take();
            setPicked(
              current === undefined || current === 0 ? undefined : current - 1,
            );
            break;
          }
          case "Enter": {
            if (event.shiftKey || current === undefined) {
              return;
            }
            take();
            run(rows[current]);
            break;
          }
          case "Escape": {
            take();
            setDismissed(words);
            setPicked(undefined);
            break;
          }
          // No default
        }
      },
    },
    rows:
      rows.length > 0 ? (
        // A press on a row must not take the caret from the composer first.
        <div
          className="absolute inset-x-3 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-float-lg"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          role="listbox"
        >
          {rows.map((row, index) => (
            <button
              aria-selected={index === current}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 px-3 text-left text-sm",
                index === current ? "bg-accent" : "hover:bg-accent/50",
              )}
              key={row.id}
              onClick={() => {
                run(row);
              }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {row.name}
                {row.detail ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {row.detail}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null,
  };
}

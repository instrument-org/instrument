import { FindRow } from "@/client/components/find-row";
import { Button } from "@/client/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { Toggle } from "@/client/components/ui/toggle";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { type EditorView } from "@codemirror/view";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ArrowsLeftRight";
import { useEffect, useRef } from "react";

import { type CodeFind, selectMatchFrom } from "./code-find";

/**
 * The code editor's find: the shared {@link FindRow} over CodeMirror's own
 * search, in the card the browser's find opens over a page, with what an
 * editor adds under it: a replace row, and whether the query matches case,
 * reads as a regexp or takes whole words only. CodeMirror holds the query and
 * paints the matches; this card is a view over its state (`find`) and
 * dispatches every change back into it. It is rendered into the search
 * panel CodeMirror mounts, which the editor's theme hangs at its top right.
 */
export function CodeFindCard({
  find,
  view,
}: {
  find: CodeFind;
  view: EditorView;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The field takes the keyboard as the card opens. CodeMirror's own Cmd+F,
  // pressed with the caret in the file while the card is up, focuses and
  // selects the panel's `main-field`; naming the field so keeps that press
  // doing what the window's does.
  useEffect(() => {
    const input = inputRef.current;
    input?.setAttribute("main-field", "true");
    const raf = requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

  const { query } = find;
  // A new query: set it, then stand on the first match from where the
  // selection is, so the readout and the lit match agree at once.
  const setQuery = (
    change: Partial<{
      caseSensitive: boolean;
      regexp: boolean;
      replace: string;
      search: string;
      wholeWord: boolean;
    }>,
  ) => {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          caseSensitive: query.caseSensitive,
          literal: query.literal,
          regexp: query.regexp,
          replace: query.replace,
          search: query.search,
          wholeWord: query.wholeWord,
          ...change,
        }),
      ),
    });
    if (change.replace === undefined) {
      selectMatchFrom(view, view.state.selection.main.from);
    }
  };
  const close = () => {
    closeSearchPanel(view);
  };

  return (
    <div className="w-90 rounded-xl bg-popover p-1.5 text-popover-foreground shadow-float-sm">
      <FindRow
        activeMatch={find.active}
        inputRef={inputRef}
        matchCount={find.matches}
        onClose={close}
        onNextMatch={() => {
          findNext(view);
        }}
        onPreviousMatch={() => {
          findPrevious(view);
        }}
        onQueryChange={(search) => {
          setQuery({ search });
        }}
        placeholder="Find in file"
        query={query.search}
      />
      {!find.readOnly && (
        <div className="mt-1 flex items-center gap-1">
          <InputGroup className="h-8 rounded-lg border border-input from-transparent to-transparent shadow-none dark:bg-transparent">
            <InputGroupAddon>
              <ArrowsLeftRightIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Replace with"
              className="h-full bg-none dark:border-0"
              onChange={(event) => {
                setQuery({ replace: event.target.value });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  replaceNext(view);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
              }}
              placeholder="Replace with"
              spellCheck={false}
              value={query.replace}
            />
          </InputGroup>
          <Button
            disabled={find.matches === 0}
            onClick={() => {
              replaceNext(view);
            }}
            size="sm"
            variant="ghost"
          >
            Replace
          </Button>
          <Button
            disabled={find.matches === 0}
            onClick={() => {
              replaceAll(view);
            }}
            size="sm"
            variant="ghost"
          >
            Replace all
          </Button>
        </div>
      )}
      <div className="mt-1 flex items-center gap-1">
        <Toggle
          className="h-6 min-w-0 rounded-lg px-2 text-xs font-normal"
          onPressedChange={(caseSensitive) => {
            setQuery({ caseSensitive });
          }}
          pressed={query.caseSensitive}
          size="sm"
        >
          Match case
        </Toggle>
        <Toggle
          className="h-6 min-w-0 rounded-lg px-2 text-xs font-normal"
          onPressedChange={(regexp) => {
            setQuery({ regexp });
          }}
          pressed={query.regexp}
          size="sm"
        >
          Regexp
        </Toggle>
        <Toggle
          className="h-6 min-w-0 rounded-lg px-2 text-xs font-normal"
          onPressedChange={(wholeWord) => {
            setQuery({ wholeWord });
          }}
          pressed={query.wholeWord}
          size="sm"
        >
          Whole word
        </Toggle>
      </div>
    </div>
  );
}

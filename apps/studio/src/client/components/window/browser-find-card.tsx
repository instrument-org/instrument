import { FindRow } from "@/client/components/find-row";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { type useBrowserFind } from "@/client/hooks/use-browser-find";

/**
 * The browser panel's find-in-page card: the shared {@link FindRow} in a
 * popover hanging at the top right of the page, so opening it moves nothing
 * and the page keeps its size. Drawn from inside the page's slot with the
 * slot's top edge as its anchor, and portalled out of the panel, so it stands
 * over the page in every host, a floating one that raises its page above
 * itself included. All state and the guest wiring live in
 * {@link useBrowserFind}.
 *
 * Only the row closes it (Escape in its field, the ×), besides the hook's own
 * reasons: a click or a key elsewhere leaves it up, as a browser's find does.
 * Closing returns the keyboard nowhere, since what held it when the card
 * opened may be a page or a menu long gone.
 */
export function BrowserFindCard({
  closeFind,
  findInputRef,
  findOpen,
  findQuery,
  findResult,
  runFind,
  setFindQuery,
}: Pick<
  ReturnType<typeof useBrowserFind>,
  | "closeFind"
  | "findInputRef"
  | "findOpen"
  | "findQuery"
  | "findResult"
  | "runFind"
  | "setFindQuery"
>) {
  return (
    <Popover open={findOpen}>
      <PopoverAnchor asChild>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-0"
        />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        alignOffset={-8}
        className="w-90 p-1.5"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        sideOffset={8}
      >
        <FindRow
          activeMatch={findResult?.active ?? 0}
          inputRef={findInputRef}
          matchCount={findResult?.matches ?? null}
          onClose={closeFind}
          onNextMatch={() => {
            runFind(findQuery, { forward: true });
          }}
          onPreviousMatch={() => {
            runFind(findQuery, { forward: false });
          }}
          onQueryChange={(query) => {
            setFindQuery(query);
            runFind(query);
          }}
          placeholder="Find in page"
          query={findQuery}
        />
      </PopoverContent>
    </Popover>
  );
}

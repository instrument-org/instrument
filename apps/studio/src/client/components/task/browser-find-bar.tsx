import { FindRow } from "@/client/components/find-row";
import { type useBrowserFind } from "@/client/hooks/use-browser-find";

/**
 * The browser panel's find-in-page bar. Presentational: all state and the guest
 * wiring live in {@link useBrowserFind}; this places the shared {@link FindRow}
 * as a bar above the page and points it at the guest's find results.
 */
export function BrowserFindBar({
  closeFind,
  findInputRef,
  findQuery,
  findResult,
  runFind,
  setFindQuery,
}: Pick<
  ReturnType<typeof useBrowserFind>,
  | "closeFind"
  | "findInputRef"
  | "findQuery"
  | "findResult"
  | "runFind"
  | "setFindQuery"
>) {
  return (
    <FindRow
      activeMatch={findResult?.active ?? 0}
      className="border-b px-1.5 py-1"
      inputRef={findInputRef}
      matchCount={findResult?.matches ?? 0}
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
  );
}

import { Button } from "@/client/components/ui/button";
import { type useBrowserFind } from "@/client/hooks/use-browser-find";
import {
  CaretDownIcon,
  CaretUpIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";

/**
 * The browser panel's find-in-page bar. Presentational: all state and the guest
 * wiring live in {@link useBrowserFind}; this renders the input, match count, and
 * next/prev/close controls.
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
    <div className="flex items-center gap-1 border-b px-1.5 py-1">
      <MagnifyingGlassIcon className="ml-1 size-4 shrink-0 text-muted-foreground" />
      <input
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        onChange={(event) => {
          setFindQuery(event.target.value);
          runFind(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            runFind(findQuery, { forward: !event.shiftKey });
          } else if (event.key === "Escape") {
            event.preventDefault();
            closeFind();
          }
        }}
        placeholder="Find in page"
        ref={findInputRef}
        spellCheck={false}
        value={findQuery}
      />
      <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">
        {findResult && findResult.matches > 0
          ? `${findResult.active}/${findResult.matches}`
          : findQuery
            ? "0/0"
            : ""}
      </span>
      <Button
        aria-label="Previous match"
        disabled={!findResult?.matches}
        onClick={() => {
          runFind(findQuery, { forward: false });
        }}
        size="icon-sm"
        variant="ghost"
      >
        <CaretUpIcon className="size-4" />
      </Button>
      <Button
        aria-label="Next match"
        disabled={!findResult?.matches}
        onClick={() => {
          runFind(findQuery, { forward: true });
        }}
        size="icon-sm"
        variant="ghost"
      >
        <CaretDownIcon className="size-4" />
      </Button>
      <Button
        aria-label="Close find"
        onClick={closeFind}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { Kbd } from "@/client/components/ui/kbd";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

import { type PageRow } from "./page-rows";

/**
 * A row of what typed words could open, under the address field and under a
 * new tab's box: its mark, its name, cut short first, and where it lives in
 * muted words, each with what the words matched in bold. The lit row is
 * marked with the key that opens it; the pointer only tints a row, so Return
 * never opens one it happens to be over.
 */
export function ResultRow({
  icon,
  id,
  isLit,
  name,
  nameRanges = null,
  onOpen,
  where,
  whereRanges = null,
}: {
  icon: ReactNode;
  id?: string;
  isLit: boolean;
  name: string;
  nameRanges?: null | number[];
  onOpen: () => void;
  where?: string | undefined;
  whereRanges?: null | number[];
}) {
  return (
    <button
      aria-selected={isLit}
      className={cn(
        "flex h-9 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm",
        isLit ? "bg-accent" : "hover:bg-accent/50",
      )}
      id={id}
      onClick={onOpen}
      // The caret stays where the words are typed as a row is pressed.
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      // The arrows move the lit row past the list's fold; the list follows,
      // so the row lit is the row seen.
      ref={(element) => {
        if (isLit) {
          element?.scrollIntoView({ block: "nearest" });
        }
      }}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate">
          <FuzzyHighlight ranges={nameRanges} text={name} />
        </span>
        {where ? (
          <span className="max-w-[55%] shrink-0 truncate text-xs text-muted-foreground">
            <FuzzyHighlight ranges={whereRanges} text={where} />
          </span>
        ) : null}
      </span>
      {isLit && <Kbd aria-hidden>↵</Kbd>}
    </button>
  );
}

/** A page's row in words: its title and its address, or its address alone. */
export function pageRowText(row: PageRow) {
  return row.title === ""
    ? { name: row.address, nameRanges: row.addressRanges }
    : {
        name: row.title,
        nameRanges: row.titleRanges,
        where: row.address,
        whereRanges: row.addressRanges,
      };
}

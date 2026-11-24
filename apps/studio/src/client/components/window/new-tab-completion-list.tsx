import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { PageFavicon } from "@/client/components/favicon";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { Kbd } from "@/client/components/ui/kbd";
import { shownTypedPath } from "@/client/lib/locate-typed-path";
import { typedFileName } from "@/client/lib/typed-path";
import { cn } from "@/client/lib/utils";

import { type BoxCompletion } from "./new-tab-completions";
import { bareAddress } from "./omnibar-match";
import { RowText } from "./row-text";
import { SearchThingMark } from "./search-thing-mark";
import { TypedAddressMark } from "./typed-address-row";

/**
 * The rows under a new tab's box (over it, for a box at the foot): what the
 * words open, the picked one marked with the key that opens it.
 */
export function NewTabCompletionList({
  className,
  nameOfAddress,
  onOpen,
  onPick,
  picked,
  rows,
}: {
  className?: string;
  /** How the row for the typed address names it: a page by its address, the app's own by what it opens. */
  nameOfAddress: (row: Extract<BoxCompletion, { kind: "address" }>) => string;
  onOpen: (row: BoxCompletion) => void;
  onPick: (index: number) => void;
  picked: number;
  rows: BoxCompletion[];
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl bg-card p-1 text-sm shadow-xs ring-1 ring-foreground/6",
        className,
      )}
      data-slot="new-tab-completions"
      role="listbox"
    >
      {rows.map((row, index) => (
        <button
          aria-selected={index === picked}
          className={cn(
            "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left",
            index === picked && "bg-accent",
          )}
          key={row.id}
          onClick={() => {
            onOpen(row);
          }}
          onPointerMove={() => {
            if (index !== picked) {
              onPick(index);
            }
          }}
          // The caret stays in the box as a row is pressed.
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          role="option"
          tabIndex={-1}
          type="button"
        >
          <span className="grid size-4 shrink-0 place-items-center">
            <CompletionMark row={row} />
          </span>
          {row.kind === "thing" ? (
            <RowText
              name={<FuzzyHighlight ranges={row.ranges} text={row.name} />}
              where={row.thing.where}
            />
          ) : row.kind === "site" ? (
            <RowText name={bareAddress(row.page.url)} where={undefined} />
          ) : (
            <span className="min-w-0 flex-1 truncate">
              {row.kind === "path" ? (
                shownTypedPath(row.path)
              ) : (
                <>
                  Go to{" "}
                  <span className="font-medium">{nameOfAddress(row)}</span>
                </>
              )}
            </span>
          )}
          {index === picked && <Kbd>↵</Kbd>}
        </button>
      ))}
    </div>
  );
}

function CompletionMark({ row }: { row: BoxCompletion }) {
  if (row.kind === "thing") {
    return <SearchThingMark thing={row.thing} />;
  }
  if (row.kind === "site") {
    return (
      <PageFavicon
        className="size-4"
        favicon={row.page.favicon}
        hasTooltip={false}
        url={row.page.url}
      />
    );
  }
  if (row.kind === "path") {
    const file = typedFileName(row.path);
    return file === undefined ? (
      <FileSystemFolderGlyph className="h-3 w-auto" />
    ) : (
      <FileTypeIcon className="size-4" fileName={file} />
    );
  }
  return (
    <TypedAddressMark
      address={row.address}
      className="size-4"
      isKnown={row.isKnown}
    />
  );
}

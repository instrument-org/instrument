import { cn } from "@/client/lib/utils";

import { MarkdownTable } from "../markdown-table";
import { type Alignment, completeLines, readBlockHeader } from "./parse-body";
import { optionName, type Options, parseOptions } from "./parse-options";
import { plainTextOf } from "./plain-text";
import { useReplyMarkdown } from "./reply-markdown-context";

/**
 * An options block: the things to choose between and what they share. A
 * table where the column is wide enough, one record per option where it is
 * not (the stacking is CSS on the table, by the block's own width), and the
 * pictures side by side when the options are pictures. The pick, when the
 * reply names one, is marked where it stands.
 */
export function OptionsBlock({
  code,
  isArriving,
}: {
  code: string;
  isArriving: boolean;
}) {
  const markdown = useReplyMarkdown();
  const { body, header } = readBlockHeader(
    completeLines(code, isArriving),
    "options",
  );
  const options = parseOptions(body, header);

  if (!options || options.table.rows.length === 0) {
    // Half a table is not yet a table; a finished one that is not one is
    // the Markdown it holds.
    return isArriving || body.trim() === "" ? null : (
      <>{markdown.block(body)}</>
    );
  }

  const { after, before } = options.table;
  return (
    <>
      {before && markdown.block(before)}
      {options.isPictures ? (
        <PictureOptions options={options} />
      ) : (
        <OptionsTable options={options} />
      )}
      {after && markdown.block(after)}
    </>
  );
}

const alignClass = (align: Alignment) =>
  align === "right" ? "text-right" : align === "center" ? "text-center" : "";

/** The small mark after the picked option's name. */
function PickTag() {
  return (
    <span className="reply-pick-tag" data-slot="pick-tag">
      Pick
    </span>
  );
}

function OptionsTable({ options }: { options: Options }) {
  const markdown = useReplyMarkdown();
  const { align, head, rows } = options.table;
  return (
    <MarkdownTable stack="options">
      <thead>
        <tr>
          {head.map((cell, column) => (
            <th className={alignClass(align[column])} key={column}>
              {markdown.inline(cell)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const picked = index === options.pick;
          return (
            <tr data-picked={picked || undefined} key={index}>
              {row.map((cell, column) => (
                <td
                  className={alignClass(align[column])}
                  data-label={plainTextOf(head[column] ?? "")}
                  key={column}
                >
                  {/* One element, so a value of several parts stays one
                      value beside its label in a record. */}
                  <span>{markdown.inline(cell)}</span>
                  {column === 0 && picked && <PickTag />}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </MarkdownTable>
  );
}

// Spelled out whole, so Tailwind finds each class.
const WIDE_COLUMNS: Record<number, string> = {
  1: "@[35rem]:grid-cols-1",
  2: "@[35rem]:grid-cols-2",
  3: "@[35rem]:grid-cols-3",
  4: "@[35rem]:grid-cols-4",
};

/**
 * Options named by pictures, side by side at one shape: two to a row in a
 * narrow column, up to four in a wide one, each with what it shares listed
 * under it.
 */
function PictureOptions({ options }: { options: Options }) {
  const markdown = useReplyMarkdown();
  const { head, rows } = options.table;
  const columns = Math.min(rows.length, 4);
  return (
    <div className="not-prose @container my-[1.25em] first:mt-0 last:mb-0">
      <div
        className={cn(
          "grid grid-cols-2 gap-x-4 gap-y-6",
          WIDE_COLUMNS[columns],
        )}
      >
        {rows.map((row, index) => {
          const picked = index === options.pick;
          const name = optionName(row[0] ?? "");
          return (
            <div
              className="@container/option flex min-w-0 flex-col"
              key={index}
            >
              <div className="reply-option-picture">
                {markdown.inline(
                  (row[0] ?? "").replace(
                    /^([^!]*)(!\[[^\]]*\]\([^)]*\)).*$/s,
                    "$2",
                  ),
                )}
              </div>
              <div className="mt-2 flex min-w-0 items-baseline gap-1.5 text-sm font-medium">
                <span className="min-w-0">{name}</span>
                {picked && <PickTag />}
              </div>
              <dl className="mt-0.5 grid grid-cols-1 text-sm @[16rem]/option:grid-cols-[minmax(0,auto)_minmax(0,1fr)] @[16rem]/option:gap-x-3 @[16rem]/option:gap-y-0.5">
                {row.slice(1).map((cell, column) =>
                  cell.trim() === "" ? null : (
                    <div className="contents" key={column}>
                      <dt className="mt-1.5 text-xs text-muted-foreground @[16rem]/option:mt-0 @[16rem]/option:text-sm">
                        {plainTextOf(head[column + 1] ?? "")}
                      </dt>
                      <dd className="min-w-0 tabular-nums">
                        {markdown.inline(cell)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

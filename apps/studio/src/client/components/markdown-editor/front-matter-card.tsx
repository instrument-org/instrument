import { cn } from "@/client/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { XIcon } from "@phosphor-icons/react/X";
import { useState } from "react";

const SPLIT =
  /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))$/;
const ROW = /^(\w[\w.-]*):(?:[ \t]+(.*))?$/;

interface Row {
  key: string;
  /** The line as written, kept byte for byte while its key and value are unchanged. */
  line: null | string;
  value: string;
}

/**
 * A document's front matter as an editable panel, closed by default as the
 * static renderer's is: one row per top-level `key: value`, or the raw YAML
 * when the block holds anything a row cannot show faithfully (nesting, block
 * scalars, comments, blank lines). Edits rewrite only the lines that changed.
 *
 * Keyed by the caller on the front matter it was opened with, so an agent's
 * edit to it redraws the rows, while the person's own typing does not.
 */
export function FrontMatterCard({
  fm,
  onChange,
}: {
  fm: string;
  onChange: (next: string) => void;
}) {
  const { close, inner, nl, open } = splitFences(fm);
  const [rows, setRows] = useState(() => parseRows(inner));
  const [yaml, setYaml] = useState(inner);
  const [asYaml, setAsYaml] = useState(rows === null);

  const emitRows = (next: Row[]) => {
    setRows(next);
    onChange(fmFromRows(next, open, close, nl));
  };
  const edit = (index: number, patch: Partial<Row>) => {
    if (!rows) {
      return;
    }
    emitRows(
      rows.map((r, i) => (i === index ? { ...r, ...patch, line: null } : r)),
    );
  };

  const title = rows?.find((r) => r.key === "title")?.value;
  const count = rows?.length ?? inner.split(/\r?\n/).length;

  return (
    <details className="group/props not-prose mb-6 rounded-lg border border-border text-sm">
      <summary className="flex cursor-default list-none items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
        <CaretRightIcon className="size-3 transition-transform group-open/props:rotate-90" />
        <span className="font-medium text-foreground">Properties</span>
        <span className="min-w-0 truncate">
          {title ? `${title} · ` : ""}
          {count} {count === 1 ? "field" : "fields"}
        </span>
        {rows !== null && (
          <button
            className="ml-auto rounded-sm px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              if (!asYaml) {
                setYaml(splitFences(fmFromRows(rows, open, close, nl)).inner);
              }
              setAsYaml(!asYaml);
            }}
            type="button"
          >
            {asYaml ? "Show as properties" : "Edit as YAML"}
          </button>
        )}
      </summary>
      <div className="border-t border-border px-3 py-2">
        {asYaml || rows === null ? (
          <textarea
            className="field-sizing-content min-h-16 w-full resize-none bg-transparent font-mono text-xs/relaxed text-foreground outline-none"
            onChange={(event) => {
              setYaml(event.target.value);
              onChange(open + event.target.value + close);
            }}
            spellCheck={false}
            value={yaml}
          />
        ) : (
          <div className="grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-center gap-x-2 gap-y-0.5">
            {rows.map((row, index) => (
              <Fields
                index={index}
                key={index}
                onDelete={() => {
                  emitRows(rows.filter((_, i) => i !== index));
                }}
                onEdit={edit}
                row={row}
              />
            ))}
            <button
              className="col-span-3 mt-1 justify-self-start rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setRows([...rows, { key: "", line: null, value: "" }]);
              }}
              type="button"
            >
              + Add property
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Sets one top-level `key: value` in front matter, rewriting only its line
 * (or adding one at the end); every other line keeps its bytes. A value YAML
 * would read as something else is written quoted.
 */
export function setFrontMatterField(fm: string, key: string, value: string) {
  const { close, inner, nl, open } = splitFences(fm || "---\n\n---\n");
  const lines = inner ? inner.split(/\r?\n/) : [];
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  // The line keeps the style it was written in: message fields are read as
  // their line's text, so an agent's unquoted `subject: Re: invoice` stays
  // unquoted. Only a value that would read as other YAML is quoted.
  const wasQuoted = /^[^:]*:\s*["']/.test(lines[at] ?? "");
  const needsQuotes = wasQuoted || /^["'[{|>&*!%@`#]|^\s|\s$/.test(value);
  const line = `${key}: ${needsQuotes ? JSON.stringify(value) : value}`;
  if (at === -1) {
    lines.push(line);
  } else {
    lines[at] = line;
  }
  return open + lines.join(nl) + close;
}

/** Front matter taken apart: its fences, and what is between them. */
export function splitFences(fm: string) {
  const parts = SPLIT.exec(fm);
  const inner = parts?.[2] ?? "";
  return {
    close: parts?.[3] ?? "\n---\n",
    inner,
    nl: inner.includes("\r\n") ? "\r\n" : "\n",
    open: parts?.[1] ?? "---\n",
  };
}

function fmFromRows(rows: Row[], open: string, close: string, nl: string) {
  return (
    open +
    rows
      .filter((r) => r.key)
      .map((r) => r.line ?? `${r.key}: ${r.value}`)
      .join(nl) +
    close
  );
}

/** Rows for simple front matter (`key: value` per line), or null when it needs the raw YAML. */
function parseRows(inner: string): null | Row[] {
  if (!inner.trim()) {
    return [];
  }
  const rows: Row[] = [];
  for (const line of inner.split(/\r?\n/)) {
    const m = ROW.exec(line);
    const value = m?.[2];
    if (!m?.[1] || !value || /^[|>&*!]/.test(value)) {
      return null;
    }
    rows.push({ key: m[1], line, value });
  }
  return rows;
}

const inputClassName =
  "min-w-0 rounded-sm bg-transparent px-1.5 py-1 text-foreground outline-none hover:bg-muted focus:bg-muted";

function Fields({
  index,
  onDelete,
  onEdit,
  row,
}: {
  index: number;
  onDelete: () => void;
  onEdit: (index: number, patch: Partial<Row>) => void;
  row: Row;
}) {
  return (
    <>
      <input
        aria-label="Property name"
        className={cn(inputClassName, "text-muted-foreground")}
        onChange={(event) => {
          onEdit(index, { key: event.target.value.trim() });
        }}
        spellCheck={false}
        value={row.key}
      />
      <input
        aria-label={`Value of ${row.key}`}
        className={inputClassName}
        onChange={(event) => {
          onEdit(index, { value: event.target.value });
        }}
        value={row.value}
      />
      <button
        aria-label="Remove property"
        className="rounded-sm p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100"
        onClick={onDelete}
        type="button"
      >
        <XIcon className="size-3" />
      </button>
    </>
  );
}

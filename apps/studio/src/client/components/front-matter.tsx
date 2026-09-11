import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { Fragment } from "react";
import { parse } from "yaml";

import { MarkdownCodeBlock } from "./code-block";

/** The keys whose value names a document, in the order files tend to use. */
const TITLE_KEYS = ["title", "name", "taskName", "sessionTitle"];

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const valueText = (value: unknown): string => {
  switch (typeof value) {
    case "bigint":
    case "boolean":
    case "number":
    case "string": {
      return String(value);
    }
    case "object": {
      if (value === null) {
        return "null";
      }
      return value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value);
    }
    default: {
      return "";
    }
  }
};

/**
 * A document's YAML front matter, drawn as a panel of its properties.
 *
 * Closed by default: a transcript carries two dozen of them, and a page that
 * opens with two dozen rows of metadata is a page whose first screen says
 * nothing. The summary line says what the file is where it can -- the value
 * under a `title`-shaped key -- and how much is folded under it, so the fold
 * costs one click and nothing is lost.
 *
 * A mapping is the only shape that is a panel. Anything else that parses (a
 * list, a scalar), and anything that does not, is kept as the YAML it is, in a
 * code block; an empty block draws nothing. Nested values print as JSON, one
 * row per top-level key, rather than unfolding into rows of their own.
 *
 * No heading inside: the file viewer's outline is read off the rendered DOM,
 * and a heading here would put the panel in it.
 */
export function FrontMatter({ source }: { source: string }) {
  if (source.trim() === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch {
    return <MarkdownCodeBlock code={source} language="yaml" />;
  }
  if (parsed === null || parsed === undefined) {
    return null;
  }
  if (!isMapping(parsed)) {
    return <MarkdownCodeBlock code={source} language="yaml" />;
  }

  const entries = Object.entries(parsed);
  const title = TITLE_KEYS.map((key) => parsed[key]).find(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "",
  );

  return (
    <details
      className="group/front-matter not-prose my-4 rounded-lg border border-border bg-muted/40 text-sm"
      data-slot="front-matter"
    >
      <summary className="flex min-w-0 list-none items-center gap-2 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
        <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/front-matter:rotate-90" />
        <span className="truncate font-medium">{title ?? "Properties"}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {entries.length === 1 ? "1 property" : `${entries.length} properties`}
        </span>
      </summary>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-border px-3 py-2">
        {entries.map(([key, value]) => (
          <Fragment key={key}>
            <dt className="font-mono text-xs leading-5 text-muted-foreground">
              {key}
            </dt>
            <dd className="min-w-0 leading-5 wrap-break-word">
              {valueText(value)}
            </dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

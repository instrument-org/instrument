import { type Action } from "@instrument-org/workspace/electron";

/**
 * The fields of the person's actions a CSV has a column for, by heading:
 * every field the action log writes but its time and kind.
 */
const ACTION_COLUMNS: [header: string, field: string][] = [
  ["Path", "path"],
  ["Paths", "paths"],
  ["From", "from"],
  ["To", "to"],
  ["Names", "names"],
  ["Selected", "selected"],
  ["App", "app"],
  ["Chat", "id"],
  ["Title", "title"],
  ["Address", "url"],
  ["Name", "name"],
  ["Did", "did"],
  ["Message", "message"],
  ["Where", "where"],
  ["Value", "value"],
];

function csvCell(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : Array.isArray(value)
          ? value
              .filter((each): each is string => typeof each === "string")
              .join("\n")
          : "";
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A CSV's records: a line each, except where a quoted cell runs over several. */
function recordsOf(csv: string): string[] {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "\n" && !quoted) {
      records.push(csv.slice(start, index));
      start = index + 1;
    }
  }
  if (start < csv.length) {
    records.push(csv.slice(start));
  }
  return records;
}

/** An action's cells after its time: its kind and each field's. */
function actionCells(action: Action): string[] {
  const fields: Record<string, unknown> = action;
  return [
    csvCell(action.kind),
    ...ACTION_COLUMNS.map(([, field]) => csvCell(fields[field])),
  ];
}

/**
 * The Activity screen's CSV: the AI requests as the workspace writes them,
 * the person's actions, or both in one file newest first. With both, each
 * row says which it is, and each has the other's columns empty.
 *
 * `requests` is the workspace's own CSV of the requests, whose first column
 * is when each started.
 */
export function activityExportCsv({
  actions,
  requests,
}: {
  /** Newest first. */
  actions?: readonly Action[];
  requests?: string;
}): string {
  if (actions === undefined) {
    return requests ?? "";
  }
  const actionHeaders = ["What", ...ACTION_COLUMNS.map(([header]) => header)];
  if (requests === undefined) {
    const lines = [
      ["Time", ...actionHeaders].map(csvCell).join(","),
      ...actions.map((action) =>
        [csvCell(action.at), ...actionCells(action)].join(","),
      ),
    ];
    return `${lines.join("\n")}\n`;
  }

  const [header = "", ...rows] = recordsOf(requests);
  const requestHeaders = header.split(",").slice(1);
  const noAction = actionHeaders.map(() => "").join(",");
  const noRequest = requestHeaders.map(() => "").join(",");
  const timed = [
    ...actions.map((action) => ({
      at: Date.parse(action.at),
      line: [
        csvCell(action.at),
        "Your activity",
        ...actionCells(action),
        noRequest,
      ].join(","),
    })),
    ...rows.map((row) => {
      const comma = row.indexOf(",");
      const started = comma === -1 ? row : row.slice(0, comma);
      const rest = comma === -1 ? "" : row.slice(comma + 1);
      return {
        at: Date.parse(started),
        line: [started, "AI request", noAction, rest].join(","),
      };
    }),
  ].toSorted((a, b) => b.at - a.at);
  const lines = [
    ["Time", "Source", ...actionHeaders].map(csvCell).join(",") +
      (requestHeaders.length > 0 ? `,${requestHeaders.join(",")}` : ""),
    ...timed.map(({ line }) => line),
  ];
  return `${lines.join("\n")}\n`;
}

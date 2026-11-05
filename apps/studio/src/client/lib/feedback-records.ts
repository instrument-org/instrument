/**
 * What a feedback report sends, as rows a person can scan: one row per
 * record of a chat's JSON Lines files, drawn the same way for every kind.
 * A row is a plain label, the record's first line, and how much of it the
 * outline sent only the length of; opened, it lists every field by name.
 * Only the labels know record kinds, and a kind they don't know shows its
 * own name, so a new kind of record shows up without code here.
 */

/** A field of a record, by its path in the record, and what goes for it. */
export type RecordField = {
  name: string;
  /** Whether the outline left it out: all of it when `value` is empty, else each REDACTION in `value`. */
  redacted?: boolean;
  value: string;
};

export type RecordRow = {
  at?: string;
  failed: boolean;
  fields: RecordField[];
  label: string;
  /** Whether `text` is a command, shown in the code face. */
  mono: boolean;
  text: string;
};

/**
 * A line of a group as the review lists it: something said, shown as it is,
 * or the steps between two of them folded into one line that opens onto them.
 */
export type GroupItem = { row: RecordRow } | { steps: RecordRow[] };

/** The rows of one session, or of the chat's settings, under its name. */
export type RecordGroup = {
  items: GroupItem[];
  /** Whether it starts open: the chat's own session does, its settings and tasks don't. */
  open: boolean;
  title: string;
};

type Fields = Record<string, unknown>;

const TEXT_MAX = 200;
const FIELDS_MAX = 80;
const FIELD_VALUE_MAX = 4000;

/** The outline's mark for text it sent only the length of. */
const SIZED = /<(\d+) chars>/g;
const ONLY_SIZED = /^<(\d+) chars>$/;
const SIZED_ANYWHERE = /<\d+ chars>/;

/** Words the gist looks under first, in order, for a record's first line. */
const GIST_KEYS = [
  "command",
  "explanation",
  "title",
  "name",
  "query",
  "url",
  "filePath",
  "slug",
  "status",
  "message",
  "text",
  "summary",
];

/** Labels for kinds whose own name reads badly. Anything else is its name in words. */
const LABELS: Record<string, string> = {
  "data-viewContext": "On screen",
  "source-url": "Source",
  "tool-bash": "Ran",
  "tool-connect_app": "Sign-in",
  answer: "Answer",
  set: "Setting",
  sites: "Sites",
};

/** Records and parts that say nothing a person reads: where a turn or session starts. */
const SKIPPED = new Set(["message", "session", "reasoning", "step-start"]);

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Where a field's text had a part left out, for the review to mark in place.
 * The object replacement character, which no record writes as text.
 */
export const REDACTION = "\uFFFC";

/** Text with what the outline left out read as "…". */
function unsized(value: string) {
  return value.replaceAll(SIZED, "…");
}

function oneLine(value: string) {
  return unsized(value).replaceAll(/\s+/g, " ").trim().slice(0, TEXT_MAX);
}

/** A kind's name in words: `tool-read_file` as "Read file", `data-taskEvent` as "Task event". */
export function kindLabel(kind: string): string {
  const known = LABELS[kind];
  if (known) {
    return known;
  }
  const words = kind
    .replace(/^(tool|data)-/, "")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Record";
}

/** The first written string under the gist's keys, breadth first. */
function gist(value: unknown): string {
  let level: unknown[] = [value];
  for (let depth = 0; depth < 4 && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const each of level) {
      if (!isFields(each)) {
        if (Array.isArray(each)) {
          next.push(...(each as unknown[])); // Array.isArray narrows to any[]
        }
        continue;
      }
      for (const key of GIST_KEYS) {
        const found = each[key];
        if (typeof found === "string" && found && !ONLY_SIZED.test(found)) {
          return found;
        }
      }
      next.push(...Object.values(each));
    }
    level = next;
  }
  return "";
}

/** Every leaf of `value` by its path, at most FIELDS_MAX of them. */
function flatten(value: unknown, at = "", out: RecordField[] = []) {
  if (out.length >= FIELDS_MAX) {
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ name: at, value: "none" });
    }
    value.forEach((each, index) => {
      flatten(each, `${at}[${index}]`, out);
    });
    return out;
  }
  if (isFields(value)) {
    for (const [key, each] of Object.entries(value)) {
      flatten(each, at ? `${at}.${key}` : key, out);
    }
    return out;
  }
  if (typeof value === "string") {
    const sized = ONLY_SIZED.exec(value);
    out.push(
      sized
        ? { name: at, redacted: true, value: "" }
        : {
            name: at,
            ...(SIZED_ANYWHERE.test(value) && { redacted: true }),
            value: value.replaceAll(SIZED, REDACTION).slice(0, FIELD_VALUE_MAX),
          },
    );
    return out;
  }
  out.push({ name: at, value: JSON.stringify(value) ?? String(value) });
  return out;
}

/** Whether a run in a command's `ran` list ended in failure, as a stage behind a pipe can in a call that exited 0. */
function runFailed(run: unknown) {
  return isFields(run) && typeof run.failed === "number" && run.failed > 0;
}

function exitedBadly(output: unknown) {
  return (
    isFields(output) &&
    ((typeof output.exitCode === "number" && output.exitCode !== 0) ||
      (Array.isArray(output.ran) && output.ran.some(runFailed)))
  );
}

function partRow(part: Fields, role: string): RecordRow | undefined {
  const type = typeof part.type === "string" ? part.type : "part";
  if (SKIPPED.has(type)) {
    return undefined;
  }
  const { type: _type, ...rest } = part;
  if (type === "text") {
    const text = typeof part.text === "string" ? part.text : "";
    return {
      failed: false,
      fields: flatten(rest),
      label: role === "user" ? "You" : "Instrument",
      mono: false,
      text: oneLine(text),
    };
  }
  const failed =
    part.state === "output-error" ||
    typeof part.errorText === "string" ||
    exitedBadly(part.output);
  const command =
    isFields(part.input) && typeof part.input.command === "string"
      ? part.input.command
      : "";
  return {
    failed,
    fields: flatten(rest),
    label: failed ? "Failed" : kindLabel(type),
    mono: command !== "",
    text: oneLine(command || gist(rest.input ?? rest.data ?? rest)),
  };
}

function recordRow(record: Fields): RecordRow | undefined {
  const kind = typeof record.t === "string" ? record.t : "record";
  if (SKIPPED.has(kind)) {
    return undefined;
  }
  const { at: _at, seq: _seq, t: _t, ...rest } = record;
  const text =
    kind === "set"
      ? `${String(record.field)}: ${typeof record.value === "string" ? record.value : gist(record.value) || JSON.stringify(record.value)}`
      : kind === "sites" && Array.isArray(record.visited)
        ? record.visited.join(", ")
        : gist(rest);
  return {
    failed: false,
    fields: flatten(rest),
    label: kindLabel(kind),
    mono: false,
    text: oneLine(text),
  };
}

/** Each record of a JSON Lines file as a row, the ones that say nothing left out. */
export function recordRows(content: string): RecordRow[] {
  const rows: RecordRow[] = [];
  let role = "";
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      rows.push({
        failed: true,
        fields: [],
        label: "Unreadable",
        mono: true,
        text: oneLine(line),
      });
      continue;
    }
    if (!isFields(record)) {
      continue;
    }
    if (record.t === "message" && isFields(record.message)) {
      role = typeof record.message.role === "string" ? record.message.role : "";
    }
    const row =
      record.t === "part" && isFields(record.part)
        ? partRow(record.part, role)
        : recordRow(record);
    if (row) {
      rows.push({
        ...row,
        ...(typeof record.at === "string" && { at: record.at }),
      });
    }
  }
  return rows;
}

/** The label main gives a chat's settings files. */
const SETTINGS_TITLE = "Chat settings";

/** The labels of what the person and the agent said, as opposed to the steps between. */
const SAID = new Set(["You", "Instrument"]);

/**
 * A chat's files as groups: its settings first, every device's in one, then
 * each session, a session's logs from every device merged in time order.
 */
export function chatGroups(
  files: readonly { content: string; label?: string; path: string }[],
): RecordGroup[] {
  const groups = new Map<string, RecordRow[]>();
  for (const file of files) {
    if (!file.path.endsWith(".jsonl")) {
      continue;
    }
    const title = file.label ?? file.path.split("/").pop() ?? file.path;
    // A record with no time of its own sorts where the one before it does.
    let at = "";
    const rows = recordRows(file.content).map((row) => {
      at = row.at ?? at;
      return { ...row, at };
    });
    groups.set(title, [...(groups.get(title) ?? []), ...rows]);
  }
  const sorted = [...groups.entries()]
    .map(([title, rows]) => {
      const inOrder = rows.toSorted((a, b) =>
        (a.at ?? "").localeCompare(b.at ?? ""),
      );
      // Every device writes its own settings; a change two of them made is one row.
      return title === SETTINGS_TITLE
        ? {
            items: [
              ...new Map(inOrder.map((row) => [row.text, row])).values(),
            ].map((row) => ({ row })),
            title,
          }
        : { items: foldSteps(inOrder), title };
    })
    .toSorted(
      (a, b) =>
        Number(b.title === SETTINGS_TITLE) - Number(a.title === SETTINGS_TITLE),
    );
  // Main lists the chat's own session before its tasks.
  const own = sorted.find((group) => group.title !== SETTINGS_TITLE);
  return sorted.map((group) => ({ ...group, open: group === own }));
}

/** What was said as rows, and each run of steps between as one item. */
function foldSteps(rows: readonly RecordRow[]): GroupItem[] {
  const items: GroupItem[] = [];
  for (const row of rows) {
    const last = items.at(-1);
    if (SAID.has(row.label)) {
      items.push({ row });
    } else if (last && "steps" in last) {
      last.steps.push(row);
    } else {
      items.push({ steps: [row] });
    }
  }
  return items;
}

/** What about.json's fields are called on the Diagnostics page; anything else goes by its path. */
const ABOUT_LABELS: Record<string, string> = {
  "app.packaged": "Installed build",
  "app.version": "Version",
  "chat.id": "Chat",
  "chat.startedWith": "Chat started on",
  locale: "Language",
  "os.arch": "Architecture",
  "os.platform": "System",
  "os.release": "Kernel",
  "os.version": "System version",
  "versions.chrome": "Chromium",
  "versions.electron": "Electron",
  "versions.node": "Node",
};

/** `process.platform` as a person names the system. */
const SYSTEM_NAMES: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

/** A JSON file's fields as named rows, for the Diagnostics page. */
export function aboutFields(content: string): RecordField[] {
  let about: unknown;
  try {
    about = JSON.parse(content);
  } catch {
    return [{ name: "about.json", value: content.slice(0, FIELD_VALUE_MAX) }];
  }
  return flatten(about).map((field) => ({
    ...field,
    name: ABOUT_LABELS[field.name] ?? field.name,
    value:
      field.name === "os.platform"
        ? (SYSTEM_NAMES[field.value] ?? field.value)
        : field.value === "true"
          ? "Yes"
          : field.value === "false"
            ? "No"
            : field.value,
  }));
}

/** An error's fields by name, for its row on the Diagnostics page to open onto. */
export function eventFields(event: unknown): RecordField[] {
  return flatten(event);
}

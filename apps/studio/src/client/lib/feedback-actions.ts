import { folderOf, nameOf } from "@/client/components/window/host-path";
import { APP_NAME } from "@instrument-org/shared";

/**
 * What the person did in the app, as feedback sends it (a JSON line per
 * action, its paths and words already redacted), turned into the sentences
 * its review page lists: what they did, and where, in time order. A line
 * that will not read is left out, and a kind this build does not know says
 * its own name, so a newer log still shows.
 */

/** What a row's mark is drawn as. */
export type ActionMark =
  | { file: string; kind: "file" }
  | { kind: "app" | "chat" | "error" | "folder" | "move" | "page" | "screen" };

export type ActionRow = {
  /** When, as the log stamped it. */
  at: string;
  mark: ActionMark;
  what: string;
  where?: string;
};

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

const texts = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((each): each is string => typeof each === "string")
    : [];

const quoted = (name: string) => `“${name}”`;

/** Names in quotes as a sentence lists them, the first few and how many more. */
function listOf(names: readonly string[]): string {
  const shown = names.length > 4 ? names.slice(0, 3) : names;
  const more = names.length - shown.length;
  const parts = [...shown.map(quoted), ...(more > 0 ? [`${more} more`] : [])];
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** A page's address without its scheme, as a person reads one. */
function shortAddress(url: string): string {
  const parsed = URL.parse(url);
  if (!parsed) {
    return url;
  }
  const rest = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
  return `${parsed.host}${rest}`;
}

/** The words of the system the rows are read on: where a deleted file waits. */
type Words = { trash: string };

function rowOf(fields: Fields, words: Words): Omit<ActionRow, "at"> {
  const path = text(fields.path);
  switch (fields.kind) {
    case "app": {
      const name = text(fields.name);
      return {
        mark: { kind: "app" },
        what:
          fields.did === "signed in"
            ? `Signed in to ${name}`
            : fields.did === "disconnected"
              ? `Disconnected ${name}`
              : `Couldn't sign in to ${name}`,
      };
    }
    case "permission": {
      const what =
        typeof fields.path === "string" ? nameOf(path) : text(fields.app);
      return {
        mark: { kind: "chat" },
        what: `${fields.did === "allowed" ? "Allowed" : "Didn't allow"} ${quoted(text(fields.title))} to use ${what}`,
      };
    }
    case "update": {
      return {
        mark: { kind: "screen" },
        what: `Updated ${APP_NAME} to ${text(fields.to)}`,
        where: `From ${text(fields.from)}`,
      };
    }
    case "capped": {
      return {
        mark: { kind: "error" },
        what:
          fields.of === "day"
            ? "Stopped writing down what you did for the rest of the day, because there was too much."
            : `Left out ${String(fields.dropped)} more like this, because there were too many in a minute.`,
      };
    }
    case "chat": {
      return {
        mark: { kind: "chat" },
        what: `Opened the chat ${quoted(text(fields.title))}`,
      };
    }
    case "copy":
    case "move": {
      return {
        mark: { kind: "move" },
        what: `${fields.kind === "copy" ? "Copied" : "Moved"} ${listOf(texts(fields.names))}`,
        where: `From ${text(fields.from)} to ${text(fields.to)}`,
      };
    }
    case "download": {
      return {
        mark: { file: nameOf(path), kind: "file" },
        what: `Downloaded ${quoted(nameOf(path))}`,
        where: folderOf(path),
      };
    }
    case "edit": {
      return {
        mark: { file: nameOf(path), kind: "file" },
        what: `Saved changes to ${quoted(nameOf(path))}`,
        where: folderOf(path),
      };
    }
    case "error": {
      return {
        mark: { kind: "error" },
        what: `Saw this error: ${text(fields.message)}`,
        ...(typeof fields.where === "string" ? { where: fields.where } : {}),
      };
    }
    case "file": {
      return {
        mark: { file: nameOf(path), kind: "file" },
        what: `Opened ${quoted(nameOf(path))}`,
        where: folderOf(path),
      };
    }
    case "folder": {
      const selected = texts(fields.selected).map((name) =>
        name.replace(/[/\\]$/, ""),
      );
      return {
        mark: { kind: "folder" },
        what: `Opened the folder ${quoted(nameOf(path))}${
          selected.length > 0 ? ` and selected ${listOf(selected)}` : ""
        }`,
        where: path,
      };
    }
    case "new-folder": {
      return {
        mark: { kind: "folder" },
        what: `Made a new folder, ${quoted(nameOf(path))}`,
        where: folderOf(path),
      };
    }
    case "open-with": {
      const app = text(fields.app);
      return {
        mark: { file: nameOf(path), kind: "file" },
        what: `Opened ${quoted(nameOf(path))} in ${app || "another app"}`,
        where: folderOf(path),
      };
    }
    case "page": {
      const title = text(fields.title);
      return {
        mark: { kind: "page" },
        what: `Visited ${shortAddress(text(fields.url))}`,
        ...(title ? { where: title } : {}),
      };
    }
    case "rename": {
      const from = text(fields.from);
      return {
        mark: { file: nameOf(text(fields.to)), kind: "file" },
        what: `Renamed ${quoted(nameOf(from))} to ${quoted(nameOf(text(fields.to)))}`,
        where: folderOf(from),
      };
    }
    case "screen": {
      return { mark: { kind: "screen" }, what: `Opened ${text(fields.name)}` };
    }
    case "setting": {
      return {
        mark: { kind: "screen" },
        what: `Changed ${quoted(text(fields.name))} to ${text(fields.value)}`,
      };
    }
    case "trash": {
      const paths = texts(fields.paths);
      return {
        mark: { kind: "move" },
        what: `Moved ${listOf(paths.map(nameOf))} to the ${words.trash}`,
        ...(paths[0] === undefined ? {} : { where: folderOf(paths[0]) }),
      };
    }
    default: {
      return { mark: { kind: "screen" }, what: text(fields.kind) };
    }
  }
}

/** Each line of what the person did as a row, oldest first. */
export function actionRows(content: string, words: Words): ActionRow[] {
  return content.split("\n").flatMap((line) => {
    if (!line.trim()) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return [];
    }
    if (
      !isFields(parsed) ||
      typeof parsed.at !== "string" ||
      typeof parsed.kind !== "string"
    ) {
      return [];
    }
    return [{ at: parsed.at, ...rowOf(parsed, words) }];
  });
}

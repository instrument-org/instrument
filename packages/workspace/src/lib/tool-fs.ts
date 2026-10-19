import { type IFileSystem } from "just-bash";
import { type Err, ok, type Result } from "neverthrow";
import path from "node:path";

import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { type ExecuteError, executeError } from "./execute-error";
import { formatBytes } from "./format-bytes";
import { normalizePath } from "./normalize-path";
import { relativeWithin } from "./path-containment";
import { sessionLayout } from "./session-layout";
import { SANDBOX_MAX_BYTES, shellFs } from "./shell-fs";
import {
  hostPathOf,
  shellPath,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

const NARROW_NO_BREAK_SPACE = "\u202F";

/**
 * What a file tool reads and writes through: the session's shell
 * filesystem, with the shell's working folder. A path the agent gives a
 * tool means what it means to `cat` and `>`: relative to the work folder,
 * `..` and `~` as the shell takes them, held to the same rules with the
 * same notes, and refused through a symlink where the shell refuses it.
 */
export interface ToolFs {
  /** The shell's filesystem, at paths in the shell's spelling. */
  fs: IFileSystem;
  /**
   * The path the shell opens for what the agent typed, absolute, in the
   * shell's spelling.
   */
  resolve: (typed: string) => Result<string, ExecuteError>;
  /**
   * How a tool names a path back: relative to the work folder inside it
   * (`./notes/a.md`), the shell's absolute path anywhere else.
   */
  shown: (resolved: string) => string;
  /** Whether a path is in the work folder. */
  inWorkFolder: (resolved: string) => boolean;
  /**
   * The path as given where something is there, or else the spelling of its
   * name that macOS gives a file a model often retypes another way.
   */
  existing: (resolved: string) => Promise<string>;
  /** A folder's entries, sorted, each folder marked with a trailing slash. */
  list: (
    resolved: string,
    limit: number,
  ) => Promise<{ entries: string[]; truncated: boolean }>;
  /** Names beside a missing path that look like the one asked for. */
  similar: (resolved: string) => Promise<string[]>;
  /**
   * Where a path the filesystem already let the agent read is on the disk,
   * for a native helper (`ffprobe`) that reads it by itself.
   */
  hostPath: (resolved: string) => Promise<string>;
  /**
   * The tool's error for an operation that failed: the rules' note where
   * they refused the path, once the card they ask with is up, or else what
   * the error means.
   */
  failure: (
    error: unknown,
    resolved: string,
  ) => Promise<Err<never, ExecuteError>>;
}

/** The {@link ToolFs} of a session, held to its chat's rules as they stand. */
export async function sessionToolFs(options: {
  chatId: ChatId;
  partId?: StoreId.Part;
  sessionId?: StoreId.Session;
}): Promise<ToolFs> {
  return toolFs(await sessionLayout(options));
}

export async function toolFs(layout: WorkspaceFsLayout): Promise<ToolFs> {
  const { fs, listings, refusals } = await shellFs(layout);
  const cwd = layout.chat.shellRoot;
  const home = shellPath(layout.rules.home);

  const inWorkFolder = (resolved: string) =>
    relativeWithin(cwd, resolved) !== null;
  const shown = (resolved: string) => {
    const inside = relativeWithin(cwd, resolved);
    return inside === null ? resolved : `.${inside}`;
  };

  return {
    existing: async (resolved) => {
      if (await fs.exists(resolved)) {
        return resolved;
      }
      for (const variant of nameVariants(resolved)) {
        if (await fs.exists(variant)) {
          return variant;
        }
      }
      return resolved;
    },
    failure: async (error, resolved) => {
      const notes = [...refusals].join("\n");
      refusals.clear();
      return executeError(notes || errnoMessage(error, shown(resolved)));
    },
    fs,
    hostPath: async (resolved) => hostPathOf(await fs.realpath(resolved)),
    inWorkFolder,
    list: async (resolved, limit) => {
      // The folder named, whose refusal says what to ask for where the rules
      // ask first.
      listings.count = 0;
      const names = (await fs.readdir(resolved)).toSorted((a, b) =>
        a.localeCompare(b),
      );
      const entries = await Promise.all(
        names.slice(0, limit).map(async (name) => {
          const stat = await fs
            .stat(path.posix.join(resolved, name))
            .catch(() => undefined);
          // A trailing slash is the only signal a caller has that an entry
          // is a directory, since the listing is otherwise bare names.
          return stat?.isDirectory ? `${name}/` : name;
        }),
      );
      return { entries, truncated: names.length > limit };
    },
    resolve: (typed) => {
      const trimmed = typed.trim();
      if (!trimmed) {
        return executeError("Path is required but was not provided");
      }
      // A Windows path (`C:\Users\sam`) in the shell's spelling
      // (`/c/Users/sam`), and `~` the home folder, as the shell expands it.
      const spelled = shellPath(trimmed).replace(/^~(?=$|\/)/, () => home);
      return ok(fs.resolvePath(cwd, spelled));
    },
    shown,
    similar: async (resolved) => {
      // A look beside a missing path, which asks the person for nothing.
      listings.count = 1;
      try {
        const dir = path.posix.dirname(resolved);
        const base = path.posix.basename(resolved).toLowerCase();
        const baseName = path.posix.parse(base).name;
        return (await fs.readdir(dir))
          .filter((entry) => {
            const lower = entry.toLowerCase();
            return (
              lower.includes(base) ||
              base.includes(lower) ||
              path.posix.parse(lower).name === baseName
            );
          })
          .slice(0, 3)
          .map((entry) => normalizePath(shown(path.posix.join(dir, entry))));
      } catch {
        return [];
      } finally {
        refusals.clear();
      }
    },
  };
}

/**
 * Spellings of a missing file's name that macOS gives files a model retypes
 * another way: a narrow no-break space before AM or PM in a screenshot's
 * name, names stored decomposed (NFD), and a curly apostrophe in a French
 * screenshot's name (`Capture d’écran`).
 *
 * Adapted from https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/path-utils.ts
 */
export function nameVariants(resolved: string): string[] {
  const amPm = resolved.replaceAll(
    / (AM|PM)\./g,
    `${NARROW_NO_BREAK_SPACE}$1.`,
  );
  const nfd = resolved.normalize("NFD");
  const curly = resolved.replaceAll("'", "\u2019");
  const nfdCurly = nfd.replaceAll("'", "\u2019");
  return [...new Set([amPm, nfd, curly, nfdCurly])].filter(
    (variant) => variant !== resolved,
  );
}

/** Whether an operation failed because nothing is at the path. */
export function isMissing(error: unknown): boolean {
  return errnoOf(error) === "ENOENT";
}

/**
 * The errno an error from the shell's filesystem carries: as its `code`
 * (the rules' refusals) or at the head of its message (just-bash's own).
 */
function errnoOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  return "code" in error && typeof error.code === "string"
    ? error.code
    : /^([A-Z][A-Z0-9]+):/.exec(error.message)?.[1];
}

/**
 * What a failed operation means, by its errno, as the shell's own commands
 * say it, for a failure the rules did not explain.
 */
function errnoMessage(error: unknown, shown: string): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (errnoOf(error)) {
    case "EACCES": {
      // `ReadWriteFs` follows no symlink inside a folder, wherever it leads.
      return /symlink|resolves outside/.test(message)
        ? `${shown}: Permission denied. It is reached through a symbolic link, which is not followed inside a folder; use the path the link leads to (\`readlink\` prints it).`
        : `${shown}: Permission denied.`;
    }
    case "EFBIG": {
      return `${shown} is too large to read whole: the limit is ${formatBytes(SANDBOX_MAX_BYTES)}. Search it with \`rg\`, or read the part you need with a script.`;
    }
    case "EISDIR": {
      return `Path is a directory, not a file: ${shown}`;
    }
    case "ENOENT": {
      return `${shown}: No such file or directory.`;
    }
    case "ENOTDIR": {
      return `${shown}: Not a directory. Part of the path is a file.`;
    }
    case "EROFS": {
      return `${shown} is on a read-only file system. Write in this conversation's folder, or a folder the person names.`;
    }
    default: {
      return `${shown}: ${message}`;
    }
  }
}

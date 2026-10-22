import { APP_PROTOCOL, isWindowsPath } from "@instrument-org/shared";
import {
  readRefusalOf,
  resolveThroughAliases,
  serveStaticFile,
} from "@instrument-org/workspace/electron";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { COMPUTER_FILE_REFUSAL_HEADER } from "@/shared/computer-file-refusal";

import { resolveAlias } from "./mac-native";
import {
  isRecordByName,
  isRefusedByName,
  isRefusedFile,
} from "./refused-files";
import {
  fileThumbnail,
  fileThumbnailDeps,
  THUMBNAIL_SIZES,
} from "./file-thumbnails";

/**
 * The channel the person's own viewers read a file on this computer through:
 * `instrument://computer-<token>/<host path>`, served as the app's user, so
 * whatever the file browser could list, a viewer can show.
 *
 * The path is the file's real path, not a path in an agent's sandbox, and
 * nothing here consults any agent's mounts. What keeps it the person's alone
 * is where it is reachable from and what it demands:
 *
 * - The scheme is registered on the default session, which is the app's own
 *   windows. Every browser guest runs in a partition of its own where the
 *   scheme does not exist, so a page the agent visits cannot name a host path
 *   at all, and no other process on the machine can speak the scheme.
 * - The host carries a token minted once per launch. An allow-list of origins
 *   could not tell the app from content it did not write: a sandboxed frame's
 *   origin is opaque, and an origin says where a frame came from rather than
 *   who wrote it. The token can: the renderer learns it over the RPC bridge,
 *   which only the top frame can open, and it is the renderer's own code
 *   that builds every URL on this host. Nothing the agent wrote is
 *   ever loaded from this channel as a document, since a document can read
 *   its own location: a page's file is shown in a browser guest at its
 *   `file://` address instead. The check is unconditional so development
 *   exercises the same path the packaged build does.
 * - A workspace's records are refused under a `.instrument` segment
 *   anywhere but in the folders there that hold the person's own files (what
 *   they attached to a chat, their drafts), the way every other road to a
 *   file refuses them, and so is the machine folder but the workspaces kept
 *   in it (`refused-files.ts`), since its keys and browser profiles carry no
 *   such segment. Only GET and HEAD are answered. A Finder alias on the path
 *   is followed, as a symbolic link is, and where either leads is held to
 *   the same refusal.
 */
const HOST_PREFIX = "computer-";

const token = randomBytes(16).toString("hex");

/** Blocks `.`/`..` segments and doubled separators where `/` alone separates. */
const UNSAFE_POSIX_PATH_REGEX = /(?:^|\/)\.{1,2}(?:$|\/)|\/{2,}/;

/**
 * Blocks the same where a backslash separates too, and any backslash at all:
 * the renderer spells a Windows path with the URL's own separators.
 */
const UNSAFE_WINDOWS_PATH_REGEX = /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/;

const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60;

/** The origin the renderer builds file URLs on; the token is the whole secret. */
export function computerFileBase() {
  return `${APP_PROTOCOL}://${HOST_PREFIX}${token}`;
}

/**
 * The host path a channel URL names, or nothing when the URL is not one this
 * launch answers: a wrong token, a path that is not absolute, a traversal, or
 * a workspace's records.
 *
 * The path travels percent-encoded per segment and is decoded once here. A
 * Windows path keeps its drive letter as the first segment (`/C:/Users/...`),
 * so the leading slash the URL form needs is dropped in front of one.
 */
export function hostPathOfComputerFileUrl(
  url: URL,
  expectedToken = token,
  hostPaths: path.PlatformPath = path,
): string | undefined {
  if (url.hostname !== `${HOST_PREFIX}${expectedToken}`) {
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return;
  }
  const hostPath = /^\/[A-Z]:\//i.test(decoded) ? decoded.slice(1) : decoded;
  // A backslash separates names in a Windows path, and in every path on
  // Windows. Anywhere else it is a character a name can hold, and the system
  // reads `..\` as a name of three characters rather than a step up.
  const unsafe =
    hostPaths.sep === "\\" || isWindowsPath(hostPath)
      ? UNSAFE_WINDOWS_PATH_REGEX
      : UNSAFE_POSIX_PATH_REGEX;
  if (unsafe.test(decoded)) {
    return;
  }
  if (isRecordByName(hostPath)) {
    return;
  }
  if (!hostPaths.isAbsolute(hostPath)) {
    return;
  }
  return hostPaths.resolve(hostPath);
}

/** Whether a request on the app scheme is for this channel, whatever its token. */
export function isComputerFileHost(hostname: string) {
  return hostname.startsWith(HOST_PREFIX);
}

const app = new Hono();

app.all("/*", async (c) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.notFound();
  }
  const asked = hostPathOfComputerFileUrl(new URL(c.req.url));
  if (asked === undefined) {
    return c.notFound();
  }
  const hostPath = await resolveThroughAliases(asked, resolveAlias);
  // The renderer's own origin is never this scheme, so every read is
  // cross-origin and `fetch()` needs the grant; the token is what gates the
  // channel, not the origin. The two range headers are what a partial reader
  // needs to see to know slices are answered and how long the whole is.
  c.header("Access-Control-Allow-Origin", "*");
  c.header(
    "Access-Control-Expose-Headers",
    `Accept-Ranges, Content-Range, ${COMPUTER_FILE_REFUSAL_HEADER}`,
  );
  // Forbidden rather than not found, and readable by the renderer, so the
  // file tab that asked can say the file is kept closed rather than gone.
  if (isRefusedByName(asked) || (await isRefusedFile(hostPath))) {
    return c.body(null, 403);
  }
  // `?thumbnail=<px>`: the file drawn small rather than the file itself (see
  // `file-thumbnails.ts`), for a grid or a row that would otherwise decode
  // the whole file to show an inch of it. A 404 is the system having no
  // picture of it, which the renderer answers with the file's type icon.
  const thumbnail = c.req.query("thumbnail");
  if (thumbnail !== undefined) {
    const size = THUMBNAIL_SIZES.find((entry) => String(entry) === thumbnail);
    if (size === undefined) {
      return c.notFound();
    }
    // `&theme=dark`: the app's theme, which a page or a document is drawn in.
    const theme = c.req.query("theme") === "dark" ? "dark" : "light";
    const drawn = await fileThumbnail(
      hostPath,
      size,
      fileThumbnailDeps(),
      theme,
    ).catch(() => null);
    if (!drawn) {
      return c.notFound();
    }
    // Drawn from the file as it is now, so only a caller naming the mtime it
    // listed is told to keep it. A page photographed before it finished
    // loading is kept by nobody, so the next ask draws it again.
    const stats = await fs.stat(hostPath).catch(() => null);
    const versionMatches =
      stats !== null && c.req.query("version") === String(stats.mtimeMs);
    let cacheControl = "no-store";
    if (drawn.complete) {
      cacheControl = versionMatches
        ? `public, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`
        : "no-cache";
    }
    c.header("Cache-Control", cacheControl);
    c.header("Content-Type", "image/png");
    return c.body(new Uint8Array(drawn.png));
  }
  // A file's stat answers where opening it is refused (macOS in a folder it
  // refuses the app, any system for a file the account can't read), so the
  // refusal only shows when the file is opened, which would be partway
  // through a 200. Opened first, it is a 403 that says whose refusal it is.
  const refused = await fs.open(hostPath, "r").then(
    async (handle) => {
      await handle.close();
      return undefined;
    },
    (error: unknown) => readRefusalOf(error),
  );
  if (refused !== undefined) {
    c.header(COMPUTER_FILE_REFUSAL_HEADER, refused);
    return c.body(null, 403);
  }
  const result = await serveStaticFile(c, {
    filePath: hostPath,
    onFound: ({ stats }) => {
      // A caller that learned the file's mtime and names it earns an immutable
      // answer; any other claim is unrecognized and not kept.
      const versionMatches = c.req.query("version") === String(stats.mtimeMs);
      c.header(
        "Cache-Control",
        versionMatches
          ? `public, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`
          : "no-store",
      );
    },
  });
  return result ?? c.notFound();
});

export function handleComputerFileRequest(request: Request) {
  return app.fetch(request);
}

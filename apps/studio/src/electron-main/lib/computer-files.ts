import { APP_PROTOCOL } from "@instrument-org/shared";
import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";
import { serveStaticFile } from "@instrument-org/workspace/electron";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import path from "node:path";

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
 * - The host carries a token minted once per launch. The artifact preview
 *   runs agent-authored HTML inside the app's session, in a sandboxed frame
 *   whose opaque origin serializes as `null`, and so does the packaged
 *   renderer's own `file://` origin, so an allow-list of origins could not
 *   tell the two apart. The token can: the renderer learns it over the RPC
 *   bridge, which only the top frame can open, and an opaque frame cannot read
 *   its parent's document to find it. Agent-authored HTML is never loaded from
 *   this channel as a document either, since a document can read its own
 *   location. The check is unconditional so development exercises the same
 *   path the packaged build does.
 * - The task's private directory is refused as a segment anywhere, the way the
 *   asset origin refuses it, and only GET and HEAD are answered.
 */
const HOST_PREFIX = "computer-";

const token = randomBytes(16).toString("hex");

/** Blocks `.`/`..` segments, doubled separators, and backslashes. */
const UNSAFE_PATH_SEGMENT_REGEX = /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/;

const PRIVATE_DIR_SEGMENT_REGEX = new RegExp(
  `(?:^|/)${TASK_FOLDER_NAMES.private.replace(".", "\\.")}(?:/|$)`,
  "i",
);

const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60;

/** The origin the renderer builds file URLs on; the token is the whole secret. */
export function computerFileBase() {
  return `${APP_PROTOCOL}://${HOST_PREFIX}${token}`;
}

/** Whether a request on the app scheme is for this channel, whatever its token. */
export function isComputerFileHost(hostname: string) {
  return hostname.startsWith(HOST_PREFIX);
}

/**
 * The host path a channel URL names, or nothing when the URL is not one this
 * launch answers: a wrong token, a path that is not absolute, a traversal, or
 * the private directory.
 *
 * The path travels percent-encoded per segment and is decoded once here. A
 * Windows path keeps its drive letter as the first segment (`/C:/Users/...`),
 * so the leading slash the URL form needs is dropped in front of one.
 */
export function hostPathOfComputerFileUrl(
  url: URL,
  expectedToken = token,
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
  if (UNSAFE_PATH_SEGMENT_REGEX.test(decoded)) {
    return;
  }
  if (PRIVATE_DIR_SEGMENT_REGEX.test(decoded)) {
    return;
  }
  const hostPath = /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  if (!path.isAbsolute(hostPath)) {
    return;
  }
  return path.resolve(hostPath);
}

const app = new Hono();

app.all("/*", async (c) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.notFound();
  }
  const hostPath = hostPathOfComputerFileUrl(new URL(c.req.url));
  if (hostPath === undefined) {
    return c.notFound();
  }
  // The renderer's own origin is never this scheme, so every read is
  // cross-origin and `fetch()` needs the grant; the token is what gates the
  // channel, not the origin. The two range headers are what a partial reader
  // needs to see to know slices are answered and how long the whole is.
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range");
  const result = await serveStaticFile(c, {
    filePath: hostPath,
    // Exactly the file asked for: a folder is not resolved to an index page
    // and nothing beside the file stands in for it.
    isPathAllowed: (filePath) => filePath === hostPath,
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

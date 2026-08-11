import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import { PROJECT_MOUNT_POINT, TASK_FOLDER_NAMES } from "../../../constants";
import { taskDir } from "../../../lib/task-dir-utils";
import { resolveTaskProjectFolder } from "../../../lib/task-project-folder";
import { getTaskState } from "../../../lib/task-record";
import {
  buildWorkspaceFsLayout,
  hostPathEscapesMount,
  resolveHostPath,
  TASK_MOUNT_POINT,
} from "../../../lib/workspace-fs-layout";
import { ATTACHED_FOLDERS_MOUNT_ROOT } from "../../../schemas/paths";
import { serveStaticFile } from "../serve-static";
import { type WorkspaceServerEnv } from "../types";
import { uriDetailsForHost } from "../uri-details-for-host";

// Blocks `.`/`..` segments, consecutive slashes, and backslashes (hono/node-server's traversal check).
const UNSAFE_PATH_SEGMENT_REGEX = /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/;

/** The private dir as a whole segment, anywhere in the path. */
const PRIVATE_DIR_SEGMENT_REGEX = new RegExp(
  `(?:^|/)${TASK_FOLDER_NAMES.private.replace(".", "\\.")}(?:/|$)`,
  "i",
);

const app = new Hono<WorkspaceServerEnv>();

// `cors()` and the handler below are typed against this app's env explicitly:
// the handler `app.use` infers carries `any` for its input, which does not
// typecheck as an argument to another middleware.
const corsMiddleware: MiddlewareHandler<WorkspaceServerEnv> = cors({
  // A response header is invisible to `fetch` across origins unless it is named
  // here, and the renderer is always a different origin from this server. Both
  // of these are what a reader of part of a file needs: `Accept-Ranges` to know
  // that partial reads are answered at all, and `Content-Range` to learn the
  // whole file's size from a response carrying only a slice of it.
  exposeHeaders: ["Accept-Ranges", "Content-Range"],
});

const corsOnAssetsOrigin: MiddlewareHandler<WorkspaceServerEnv> = async (
  c,
  next,
) => {
  const uriDetails = uriDetailsForHost(c.req.header("host") || "");
  if (uriDetails.isErr() || uriDetails.value.origin !== "assets") {
    await next();
    return;
  }
  return corsMiddleware(c, next);
};

app.use("/*", corsOnAssetsOrigin);

app.all("/*", async (c, next) => {
  const uriDetails = uriDetailsForHost(c.req.header("host") || "");

  if (uriDetails.isErr() || uriDetails.value.origin !== "assets") {
    await next();
    return;
  }

  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.notFound();
  }

  const { id } = uriDetails.value;

  // Hono decodes the path with `decodeURI`, which by definition leaves the
  // reserved set (`,` `#` `&` `+` `?` `=` `@` `:` `;` `$`) escaped -- so a file
  // whose name carries one resolved to a `%2C` that is not on disk and 404'd.
  // Ordinary names in a folder the user picked look like `Smith, John.pdf`, so
  // finish the decode here. The traversal check below then reads the decoded
  // path, which is what it always needed: `..` spelled `%2E%2E` used to sail
  // past it and only failed later for want of a directory literally named that.
  let assetPath: string;
  try {
    assetPath = decodeURIComponent(c.req.path);
  } catch {
    return c.notFound();
  }

  if (UNSAFE_PATH_SEGMENT_REGEX.test(assetPath)) {
    return c.notFound();
  }

  // The task mount root holds private per-task metadata under `.instrument/`
  // (task.db, state.json), and the project mount holds the settings naming the
  // project's folders and the access granted to each; never serve either over
  // the asset origin. Matched as a segment anywhere in the path rather than only
  // at the root, because more than one mount has such a directory now, and
  // case-insensitively, because the app runs on case-insensitive filesystems
  // (macOS, Windows) where `/.INSTRUMENT/...` names the same private file.
  //
  // This route resolves host paths itself rather than going through the virtual
  // filesystem, so `maskPrivateDirFs` does not cover it and this is the only
  // thing standing in front of those files here.
  if (PRIVATE_DIR_SEGMENT_REGEX.test(assetPath)) {
    return c.notFound();
  }

  const taskHostRoot = taskDir(id);
  const taskState = await getTaskState(taskHostRoot);
  const layout = buildWorkspaceFsLayout({
    attachedFolders: taskState.attachedFolders,
    projectFolderName: await resolveTaskProjectFolder(id),
    taskHostRoot,
  });
  // A path under a mount root is already a virtual path; anything else is
  // relative to the task and gets the task mount prefixed. Both mounts outside
  // the task have to be listed, or an agent-authored page linking to one gets
  // the path resolved inside the task folder and a 404 that looks like a missing
  // file rather than an unserved mount.
  const virtualPath = [ATTACHED_FOLDERS_MOUNT_ROOT, PROJECT_MOUNT_POINT].some(
    (root) => assetPath === root || assetPath.startsWith(`${root}/`),
  )
    ? assetPath
    : `${TASK_MOUNT_POINT}${assetPath}`;
  const resolved = resolveHostPath(layout, virtualPath);

  if (resolved === null) {
    return c.notFound();
  }

  const isMountedFile = resolved.mount !== layout.task;

  const result = await serveStaticFile(c, {
    filePath: resolved.hostPath,
    isPathAllowed: (filePath) =>
      !hostPathEscapesMount(filePath, resolved.mount.hostRoot),
    onFound: ({ stats }) => {
      const versionMatches = c.req.query("version") === String(stats.mtimeMs);
      c.header(
        "Cache-Control",
        !isMountedFile && versionMatches
          ? "public, max-age=31536000, immutable"
          : "no-store",
      );
    },
  });

  if (!result) {
    return c.notFound();
  }

  return result;
});

export const assetsRoute = app;

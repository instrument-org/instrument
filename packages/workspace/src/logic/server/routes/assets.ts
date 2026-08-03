import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import { taskDir } from "../../../lib/task-dir-utils";
import { getTaskState } from "../../../lib/task-state-store";
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
  const assetPath = c.req.path;

  if (UNSAFE_PATH_SEGMENT_REGEX.test(assetPath)) {
    return c.notFound();
  }

  // The task mount root also holds private per-task metadata under
  // `.instrument/` (task.db, state.json); never serve it over the asset origin.
  // Matched case-insensitively: the app runs on case-insensitive filesystems
  // (macOS, Windows) where `/.INSTRUMENT/...` resolves to the same private file.
  const lowerAssetPath = assetPath.toLowerCase();
  if (
    lowerAssetPath === "/.instrument" ||
    lowerAssetPath.startsWith("/.instrument/")
  ) {
    return c.notFound();
  }

  const taskHostRoot = taskDir(id);
  const taskState = await getTaskState(taskHostRoot);
  const layout = buildWorkspaceFsLayout({
    attachedFolders: taskState.attachedFolders,
    taskHostRoot,
  });
  const virtualPath =
    assetPath === ATTACHED_FOLDERS_MOUNT_ROOT ||
    assetPath.startsWith(`${ATTACHED_FOLDERS_MOUNT_ROOT}/`)
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

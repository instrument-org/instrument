import { buildAssetBaseUrl } from "@instrument-org/shared";

import { getWorkspaceServerURL } from "../../logic/server/url";
import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { normalizePath } from "../normalize-path";
import { parseAgentBrowserArgs } from "./agent-browser-args";

/**
 * Subcommands whose first positional is a URL to load. Deliberately narrow:
 * the other path-taking subcommands (`screenshot`, `pdf`, `download`) name an
 * output file that must stay a sandbox path, not become an http origin, and
 * `pushstate` takes a same-origin route that a cross-origin URL would break.
 */
const NAVIGATION_SUBCOMMANDS = new Set(["goto", "navigate", "open", "read"]);

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Point the browser at files the agent itself produced. Applies to external
 * targets too: the asset origin is a `*.localhost` name any local browser
 * resolves, and the sandbox path would be just as meaningless to them.
 *
 * The browser's `file://` root is the host filesystem, where the sandbox's
 * `/task` does not exist, and the target runs with web security on and no file
 * access, so even a resolvable `file://` page could not load its own scripts or
 * stylesheets. The workspace already serves every task file over a per-task
 * static origin, so a navigation argument naming a sandbox path is rewritten
 * onto that origin. This keeps the origin an implementation detail: the agent
 * asks for `output/report.html`, `/task/output/report.html`, or
 * `file:///task/output/report.html` and gets a real page it can inspect.
 */
export async function rewriteNavigationArgToAssetUrl(
  args: string[],
  taskId: TaskId,
  ctx: {
    cwd: string;
    fs: {
      exists(path: string): Promise<boolean>;
      resolvePath(cwd: string, path: string): string;
    };
  },
): Promise<string[]> {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand === undefined || !NAVIGATION_SUBCOMMANDS.has(subcommand)) {
    return args;
  }

  // `--` rather than `-`, matching how the CLI itself picks the URL out of a
  // navigation command's remaining args, so the rewrite lands on exactly the
  // argument the browser will be told to load.
  const target = subArgs.slice(1).find(({ value }) => !value.startsWith("--"));
  if (target === undefined) {
    return args;
  }

  const assetUrl = await assetUrlForSandboxPath(target.value, taskId, ctx);
  if (assetUrl === undefined) {
    return args;
  }

  return args.map((arg, index) => (index === target.index ? assetUrl : arg));
}

/**
 * Path the asset origin serves a virtual path at, or undefined when no mount
 * owns it. Task files are served from the origin root; attached folders keep
 * their `/mnt/...` path, matching the assets route.
 */
function assetPathForVirtualPath(virtualPath: string): string | undefined {
  if (virtualPath === MOUNT.task) {
    return "/";
  }
  if (virtualPath.startsWith(`${MOUNT.task}/`)) {
    return virtualPath.slice(MOUNT.task.length);
  }
  if (
    virtualPath === MOUNT.attachedFolders ||
    virtualPath.startsWith(`${MOUNT.attachedFolders}/`)
  ) {
    return virtualPath;
  }
  return undefined;
}

async function assetUrlForSandboxPath(
  arg: string,
  taskId: TaskId,
  ctx: {
    cwd: string;
    fs: {
      exists(path: string): Promise<boolean>;
      resolvePath(cwd: string, path: string): string;
    };
  },
): Promise<string | undefined> {
  const target = parseSandboxTarget(arg, ctx);
  if (target === undefined) {
    return undefined;
  }

  if (target.requireExists && !(await ctx.fs.exists(target.virtualPath))) {
    return undefined;
  }

  const assetPath = assetPathForVirtualPath(target.virtualPath);
  if (assetPath === undefined) {
    return undefined;
  }

  const encoded = assetPath.split("/").map(encodeURIComponent).join("/");
  const base = buildAssetBaseUrl(getWorkspaceServerURL(), taskId);
  return `${base}${encoded}${target.suffix}`;
}

function parseSandboxTarget(
  arg: string,
  ctx: {
    cwd: string;
    fs: { resolvePath(cwd: string, path: string): string };
  },
): undefined | { requireExists: boolean; suffix: string; virtualPath: string } {
  if (arg.toLowerCase().startsWith("file:")) {
    let url: URL;
    try {
      url = new URL(arg);
    } catch {
      return undefined;
    }
    // `file://host/path` addresses another machine; only the local forms
    // (`file:///path`, `file://localhost/path`) name a sandbox path.
    if (url.host !== "" && url.host !== "localhost") {
      return undefined;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return undefined;
    }
    return {
      requireExists: false,
      suffix: `${url.search}${url.hash}`,
      virtualPath: normalizePath(pathname),
    };
  }

  if (SCHEME_PATTERN.test(arg) || arg.startsWith("//")) {
    return undefined;
  }

  if (arg.startsWith("/")) {
    return {
      requireExists: false,
      suffix: "",
      virtualPath: normalizePath(arg),
    };
  }

  // A bare relative path is indistinguishable from a bare hostname the CLI
  // would normalize to https (`example.com/pricing`), so it only becomes an
  // asset URL when the sandbox actually holds that file.
  return {
    requireExists: true,
    suffix: "",
    virtualPath: normalizePath(ctx.fs.resolvePath(ctx.cwd, arg)),
  };
}

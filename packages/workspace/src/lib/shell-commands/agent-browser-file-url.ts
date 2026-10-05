import { MOUNT } from "../../mount-points";
import { fileUrlOfHostPath } from "../local-page-address";
import { normalizePath } from "../normalize-path";
import {
  classifyHostPath,
  resolveHostPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { parseAgentBrowserArgs } from "./agent-browser-args";

/**
 * Subcommands whose first positional is a URL to load. Deliberately narrow:
 * the other path-taking subcommands (`screenshot`, `pdf`, `download`) name an
 * output file that must stay a sandbox path, not become an address, and
 * `pushstate` takes a same-document route that a new address would break.
 */
const NAVIGATION_SUBCOMMANDS = new Set(["goto", "navigate", "open", "read"]);

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Point the browser at a file the agent can reach, by the address the person
 * would see it at: its `file://` URL on this computer. The agent asks for
 * `work/report.html`, `/task/work/report.html`, `/mnt/Docs/page.html`, or
 * `file:///task/work/report.html` and the page loads where the person's own
 * tab would load it, with the same folder rules, so what the agent checks is
 * what the person sees. The browser's output is spelled back in the agent's
 * paths ({@link agentSpellingOfFileUrls}).
 *
 * A `file:` argument that names nothing the agent can read is refused here
 * rather than passed on: the browser's `file://` root is the whole computer.
 */
export async function rewriteNavigationArgToFileUrl(
  args: string[],
  layout: WorkspaceFsLayout,
  ctx: {
    cwd: string;
    fs: {
      exists(path: string): Promise<boolean>;
      resolvePath(cwd: string, path: string): string;
    };
  },
): Promise<{ args: string[] } | { error: string }> {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand === undefined || !NAVIGATION_SUBCOMMANDS.has(subcommand)) {
    return { args };
  }

  // `--` rather than `-`, matching how the CLI itself picks the URL out of a
  // navigation command's remaining args, so the rewrite lands on exactly the
  // argument the browser will be told to load.
  const target = subArgs.slice(1).find(({ value }) => !value.startsWith("--"));
  if (target === undefined) {
    return { args };
  }

  const parsed = await parseSandboxTarget(target.value, ctx);
  if (parsed === undefined) {
    return /^file:/i.test(target.value)
      ? { error: unreachableFileMessage(target.value) }
      : { args };
  }

  // A path the agent named that no mount holds is refused whatever its
  // spelling: passed on, the CLI would read `/Users/...` as a host name.
  const resolved = resolveHostPath(layout, parsed.virtualPath);
  if (
    resolved === null ||
    classifyHostPath(layout, resolved.hostPath, resolved.mount)?.masked !==
      undefined
  ) {
    return { error: unreachableFileMessage(target.value) };
  }

  const fileUrl = `${fileUrlOfHostPath(resolved.hostPath)}${parsed.suffix}`;
  return {
    args: args.map((arg, index) => (index === target.index ? fileUrl : arg)),
  };
}

async function parseSandboxTarget(
  arg: string,
  ctx: {
    cwd: string;
    fs: {
      exists(path: string): Promise<boolean>;
      resolvePath(cwd: string, path: string): string;
    };
  },
): Promise<
  undefined | { isFileUrl: boolean; suffix: string; virtualPath: string }
> {
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
      isFileUrl: true,
      suffix: `${url.search}${url.hash}`,
      virtualPath: normalizePath(pathname),
    };
  }

  if (SCHEME_PATTERN.test(arg) || arg.startsWith("//")) {
    return undefined;
  }

  if (arg.startsWith("/")) {
    return { isFileUrl: false, suffix: "", virtualPath: normalizePath(arg) };
  }

  // A bare relative path is indistinguishable from a bare hostname the CLI
  // would normalize to https (`example.com/pricing`), so it only becomes a
  // file address when the sandbox actually holds that file.
  const virtualPath = normalizePath(ctx.fs.resolvePath(ctx.cwd, arg));
  return (await ctx.fs.exists(virtualPath))
    ? { isFileUrl: false, suffix: "", virtualPath }
    : undefined;
}

function unreachableFileMessage(arg: string) {
  return `${arg} is not a file you can open. Open a file by the path you reach it at (agent-browser open work/page.html, or ${MOUNT.attachedFolders}/<folder>/page.html).`;
}

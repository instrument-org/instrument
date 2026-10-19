// Shared with the renderer through the message schema, so nothing here
// reaches for `node:path`: both directions work on either platform's
// spelling whatever the host is, which is also what lets a record written on
// a Mac be read on Windows.
import {
  IN_WORKSPACE_PREFIX,
  type InWorkspacePath,
  InWorkspacePathSchema,
} from "../schemas/paths";

const WINDOWS_ROOT = /^(?:[a-z]:[/\\]|\\\\)/i;

/**
 * How a file at `hostPath` is kept in a record: by its path from the
 * workspace's top level when it is in the workspace, undefined when it is
 * not. Both paths are absolute and already resolved.
 */
export function inWorkspacePath(
  hostPath: string,
  workspaceRoot: string,
): InWorkspacePath | undefined {
  const root = withoutTrailingSlash(forwardSlashes(workspaceRoot));
  const file = forwardSlashes(hostPath);
  const caseless = WINDOWS_ROOT.test(workspaceRoot);
  const head = file.slice(0, root.length + 1);
  const rootWithSlash = `${root}/`;
  const inside = caseless
    ? head.toLowerCase() === rootWithSlash.toLowerCase()
    : head === rootWithSlash;
  const rest = file.slice(root.length + 1);
  if (!inside || segmentsOf(rest) === undefined) {
    return undefined;
  }
  return InWorkspacePathSchema.parse(`${IN_WORKSPACE_PREFIX}${rest}`);
}

/** Whether a stored path is kept by its place in the workspace. */
export function isInWorkspacePath(stored: string): boolean {
  return stored.startsWith(IN_WORKSPACE_PREFIX);
}

/**
 * Where a path kept by its place in the workspace is under the workspace's
 * root on this computer, spelled the way the root is. Null when it would
 * leave the root or names nothing in it.
 */
export function workspaceHostPath(
  stored: string,
  workspaceRoot: string,
): null | string {
  if (!isInWorkspacePath(stored)) {
    return null;
  }
  const segments = segmentsOf(stored.slice(IN_WORKSPACE_PREFIX.length));
  if (segments === undefined) {
    return null;
  }
  const separator = WINDOWS_ROOT.test(workspaceRoot) ? "\\" : "/";
  const root = workspaceRoot.replace(/[/\\]+$/, "");
  return [root, ...segments].join(separator);
}

function forwardSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function withoutTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

/** The names along a path below the root, or undefined for one that climbs out or is empty. */
function segmentsOf(rest: string): string[] | undefined {
  const segments = rest.split(/[/\\]/).filter((s) => s !== "" && s !== ".");
  return segments.length === 0 || segments.includes("..")
    ? undefined
    : segments;
}

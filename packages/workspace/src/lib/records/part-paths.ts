import { type SessionMessagePart } from "../../schemas/session/message-part";
import {
  inWorkspacePath,
  isInWorkspacePath,
  workspaceHostPath,
} from "../workspace-relative-path";

/**
 * The paths a part names, as a log keeps them. A file or folder in the
 * workspace is kept by its place there (`workspace:/Chats/Plan/plan.md`),
 * which names the same file on every computer the workspace syncs to and on
 * one that only views it; one outside the workspace keeps its own absolute
 * path, which means something only where it was written. Everything that
 * reads a chat through its fold sees this computer's host paths again.
 *
 * Only the paths the app itself put in a part change: the folders a chat
 * was granted, what was on screen or chosen when a message was sent, the
 * file a question was about, the files a task named. A file the person
 * attached already keeps its own form (`attachments.files`), and the
 * agent's words and tool calls are kept as it wrote them.
 */

type MapPath = (path: string) => string;

/** The part with every path the app put in it kept by its place in the workspace, where it is in it. */
export function portablePart(
  part: SessionMessagePart.Type,
  workspaceRoot: string,
): SessionMessagePart.Type {
  return withPaths(
    part,
    (path) => inWorkspacePath(path, workspaceRoot) ?? path,
  );
}

/** The part with every path kept by its place in the workspace read as this computer's host path. */
export function localPart(
  part: SessionMessagePart.Type,
  workspaceRoot: string,
): SessionMessagePart.Type {
  return withPaths(part, (path) =>
    isInWorkspacePath(path)
      ? (workspaceHostPath(path, workspaceRoot) ?? path)
      : path,
  );
}

/** The part with `map` applied to each of its paths; the part itself when no path changes. */
function withPaths(
  part: SessionMessagePart.Type,
  change: MapPath,
): SessionMessagePart.Type {
  let changed = false;
  const map: MapPath = (path) => {
    const mapped = change(path);
    changed ||= mapped !== path;
    return mapped;
  };
  const mapped = mapPaths(part, map);
  return changed ? mapped : part;
}

function mapPaths(
  part: SessionMessagePart.Type,
  map: MapPath,
): SessionMessagePart.Type {
  const optional = (path: string | undefined) =>
    path === undefined ? undefined : map(path);
  switch (part.type) {
    case "data-asks":
      return {
        ...part,
        data: {
          ...part.data,
          asks: part.data.asks.map((ask) => ({
            ...ask,
            file: {
              ...ask.file,
              mount: optional(ask.file.mount),
              path: map(ask.file.path),
            },
          })),
        },
      };
    case "data-attachments":
      return part.data.folders === undefined
        ? part
        : {
            ...part,
            data: {
              ...part.data,
              folders: part.data.folders.map((folder) => ({
                ...folder,
                path: map(folder.path),
              })),
            },
          };
    case "data-folderChanges":
      return {
        ...part,
        data: {
          added: part.data.added.map((folder) => ({
            ...folder,
            path: map(folder.path),
          })),
          removed: part.data.removed.map((folder) => ({
            ...folder,
            path: map(folder.path),
          })),
        },
      };
    case "data-permissionAnswer":
      return part.data.kind === "folder"
        ? { ...part, data: { ...part.data, target: map(part.data.target) } }
        : part;
    case "data-taskEvent":
      return {
        ...part,
        data: {
          ...part.data,
          events: part.data.events.map((event) =>
            event.files === undefined
              ? event
              : { ...event, files: event.files.map(map) },
          ),
        },
      };
    case "data-topic":
      return part.data.topic?.folders === undefined
        ? part
        : {
            ...part,
            data: {
              ...part.data,
              topic: {
                ...part.data.topic,
                folders: part.data.topic.folders.map(map),
              },
            },
          };
    case "data-viewContext": {
      const { attached, chosen, file, folder } = part.data;
      return {
        ...part,
        data: {
          ...part.data,
          attached: attached?.map((chip) =>
            chip.kind === "paths"
              ? {
                  ...chip,
                  items: chip.items.map((item) => ({
                    ...item,
                    path: map(item.path),
                  })),
                }
              : chip,
          ),
          chosen: chosen?.map((each) => ({
            ...each,
            mount: optional(each.mount),
            path: map(each.path),
          })),
          file: file && {
            ...file,
            mount: optional(file.mount),
            path: map(file.path),
          },
          folder: folder && { ...folder, mount: optional(folder.mount) },
        },
      };
    }
    default:
      return part;
  }
}

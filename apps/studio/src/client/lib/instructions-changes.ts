import {
  type SessionMessage,
  type SessionMessageDataPart,
  type StoreId,
  type TranscriptMessage,
} from "@instrument-org/workspace/client";

type Project = NonNullable<SessionMessageDataPart.ProjectDataPart["project"]>;

/** One change to the standing instructions the agent reads, as a message carried it. */
export type InstructionsChange =
  /** The chat was filed under a project, or moved from one to another. */
  | { kind: "filed"; project: Project }
  /** The chat was taken out of its project. */
  | { kind: "unfiled"; project: Project }
  /** The project it stays under changed its instructions or folders. */
  | {
      foldersAdded: number;
      foldersRemoved: number;
      instructions?: "cleared" | "updated";
      kind: "project";
      project: Project;
    }
  /** The workspace's own `AGENTS.md` changed. */
  | { instructions: "cleared" | "updated"; kind: "workspace" };

type Message = SessionMessage.WithParts | TranscriptMessage;

/**
 * What changed in the project and workspace instructions each message the
 * person sent carried, keyed by that message.
 *
 * Both parts are a whole picture on every message (`state` cadence), so a
 * change is read against the picture before it. The first picture is the
 * baseline and says nothing, since the chat head already names the project,
 * unless a message before it went without one: an empty picture is left off
 * until a session has had something in it, so a first picture after other
 * messages is the chat being filed, or instructions being written, after it
 * started.
 */
export function instructionsChanges(
  messages: readonly Message[],
): Map<StoreId.Message, InstructionsChange[]> {
  const changes = new Map<StoreId.Message, InstructionsChange[]>();
  let project: Project | null | undefined;
  let workspace: string | undefined;
  let sawWorkspace = false;
  let sawEarlier = false;

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const found: InstructionsChange[] = [];
    for (const part of message.parts) {
      if (part.type === "data-project") {
        const next = part.data.project;
        found.push(
          ...(project === undefined
            ? sawEarlier && next
              ? [{ kind: "filed" as const, project: next }]
              : []
            : projectChanges(project, next)),
        );
        project = next;
      } else if (part.type === "data-workspaceInstructions") {
        const next = part.data.instructions || undefined;
        if ((sawWorkspace || sawEarlier) && next !== workspace) {
          found.push({
            instructions: next ? "updated" : "cleared",
            kind: "workspace",
          });
        }
        workspace = next;
        sawWorkspace = true;
      }
    }
    if (found.length > 0) {
      changes.set(message.id, found);
    }
    sawEarlier = true;
  }
  return changes;
}

function projectChanges(
  before: Project | null,
  after: Project | null,
): InstructionsChange[] {
  if (after === null) {
    return before ? [{ kind: "unfiled", project: before }] : [];
  }
  if (before === null || !isSameProject(before, after)) {
    return [{ kind: "filed", project: after }];
  }
  const was = new Set(before.folders);
  const is = new Set(after.folders);
  const foldersAdded = [...is].filter((folder) => !was.has(folder)).length;
  const foldersRemoved = [...was].filter((folder) => !is.has(folder)).length;
  const instructionsChanged =
    (before.instructions ?? "") !== (after.instructions ?? "");
  if (!instructionsChanged && foldersAdded === 0 && foldersRemoved === 0) {
    return [];
  }
  return [
    {
      foldersAdded,
      foldersRemoved,
      ...(instructionsChanged && {
        instructions: after.instructions ? "updated" : "cleared",
      }),
      kind: "project",
      project: after,
    },
  ];
}

/**
 * By id, which a rename keeps; by name for a part stored before the id was,
 * where a rename reads as a move.
 */
function isSameProject(before: Project, after: Project): boolean {
  return before.id !== undefined && after.id !== undefined
    ? before.id === after.id
    : before.name === after.name;
}

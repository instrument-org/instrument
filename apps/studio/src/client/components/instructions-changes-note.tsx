import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { type InstructionsChange } from "@/client/lib/instructions-changes";
import { rpcClient } from "@/client/rpc/client";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { useQuery } from "@tanstack/react-query";

import { ProjectPill } from "./window/chat-row";

type Project = NonNullable<SessionMessageDataPart.ProjectDataPart["project"]>;

/**
 * What changed in the instructions the agent reads, under the message that
 * brought the change to it, a line each, in the folder note's voice. A change
 * made in a project or in `AGENTS.md` reaches a chat only with its next
 * message, and this is where the person sees that it did.
 */
export function InstructionsChangesNote({
  changes,
}: {
  changes: readonly InstructionsChange[];
}) {
  return (
    <div className="flex flex-col items-end">
      {changes.map((change) => (
        <p
          className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70"
          key={change.kind}
        >
          {change.kind === "workspace" ? (
            <>
              <FileTextIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {change.instructions === "updated" ? "Updated" : "Cleared"}{" "}
                workspace instructions
              </span>
            </>
          ) : (
            <>
              <span className="truncate">{projectSentence(change)}</span>
              <ProjectName project={change.project} />
            </>
          )}
        </p>
      ))}
    </div>
  );
}

function projectSentence(
  change: Exclude<InstructionsChange, { kind: "workspace" }>,
): string {
  switch (change.kind) {
    case "filed": {
      return "Moved to";
    }
    case "unfiled": {
      return "Removed from";
    }
    case "project": {
      const parts = [
        ...(change.instructions ? [`${change.instructions} instructions`] : []),
        ...(change.foldersAdded > 0
          ? [`added ${folders(change.foldersAdded)}`]
          : []),
        ...(change.foldersRemoved > 0
          ? [`removed ${folders(change.foldersRemoved)}`]
          : []),
      ];
      const summary = parts.join(", ");
      return `${summary.charAt(0).toUpperCase()}${summary.slice(1)} from`;
    }
  }
}

function folders(count: number): string {
  return count === 1 ? "1 folder" : `${count} folders`;
}

/** The project's pill, opening its details while the project is still there. */
function ProjectName({ project }: { project: Project }) {
  const { data: projects = [] } = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const known = projects.find(
    (each) =>
      !each.retired &&
      (project.id === undefined
        ? each.name === project.name
        : each.id === project.id),
  );
  if (!known) {
    return (
      <span className="shrink-0 font-medium">
        {project.emoji ? `${project.emoji} ` : ""}
        {project.name}
      </span>
    );
  }
  return (
    <button
      className="inline-flex shrink-0 align-middle"
      onClick={() => {
        openProjectDetails(known.id);
      }}
      type="button"
    >
      <ProjectPill project={known} />
    </button>
  );
}

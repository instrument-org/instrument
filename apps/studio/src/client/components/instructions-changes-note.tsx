import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { type InstructionsChange } from "@/client/lib/instructions-changes";
import { rpcClient } from "@/client/rpc/client";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { useQuery } from "@tanstack/react-query";

import { ChangeCard, ChangeRow, RowGlyph } from "./change-card";
import { ProjectMark } from "./window/project-mark";

/**
 * What changed in the instructions the agent reads, as a card over the
 * message that brought the change to it, a row per place. A change made in
 * a project or in `AGENTS.md` reaches a chat only with its next message,
 * and this is where the person sees that it did. There is no Undo: the
 * change was the person's own.
 */
export function InstructionsChangesNote({
  changes,
}: {
  changes: readonly InstructionsChange[];
}) {
  const { data: projects = [] } = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const count = changes.length;
  return (
    <div className="flex flex-col items-end">
      <ChangeCard
        heading={
          count === 1
            ? "Changed instructions"
            : `Changed ${count.toString()} instructions`
        }
        icon={FileTextIcon}
        slot="instructions-changes"
      >
        {changes.map((change) => {
          if (change.kind === "workspace") {
            return (
              <ChangeRow
                key="workspace"
                lead={<RowGlyph icon={FileTextIcon} />}
                lines={[
                  {
                    key: "said",
                    words:
                      change.instructions === "updated" ? "Updated" : "Cleared",
                  },
                ]}
                name="Workspace instructions"
              />
            );
          }
          const known = projects.find(
            (each) =>
              !each.retired &&
              (change.project.id === undefined
                ? each.name === change.project.name
                : each.id === change.project.id),
          );
          return (
            <ChangeRow
              key={`${change.kind}:${change.project.name}`}
              lead={
                <ProjectMark
                  className="size-5 rounded-md"
                  project={known ?? change.project}
                />
              }
              lines={projectLines(change).map((words) => ({
                key: words,
                words,
              }))}
              name={known?.name ?? change.project.name}
              {...(known && {
                onOpen: () => {
                  openProjectDetails(known.id);
                },
              })}
            />
          );
        })}
      </ChangeCard>
    </div>
  );
}

/** What changed for one project, a line each: "Instructions updated", "1 folder added". */
function projectLines(
  change: Exclude<InstructionsChange, { kind: "workspace" }>,
): string[] {
  switch (change.kind) {
    case "filed": {
      return ["This chat moved here"];
    }
    case "unfiled": {
      return ["This chat moved out"];
    }
    case "project": {
      return [
        ...(change.instructions
          ? [
              change.instructions === "updated"
                ? "Instructions updated"
                : "Instructions cleared",
            ]
          : []),
        ...(change.foldersAdded > 0
          ? [`${folders(change.foldersAdded)} added`]
          : []),
        ...(change.foldersRemoved > 0
          ? [`${folders(change.foldersRemoved)} removed`]
          : []),
      ];
    }
  }
}

function folders(count: number): string {
  return count === 1 ? "1 folder" : `${count.toString()} folders`;
}

import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";

export function ProjectChangesNote({
  data,
}: {
  data: SessionMessageDataPart.ProjectChangesDataPart;
}) {
  const changes: string[] = [];
  if (data.instructionsChanged) {
    changes.push(
      data.instructions ? "updated instructions" : "cleared instructions",
    );
  }
  if (data.foldersAdded.length > 0) {
    changes.push(
      `added ${data.foldersAdded.length} folder${data.foldersAdded.length === 1 ? "" : "s"}`,
    );
  }
  if (data.foldersRemoved.length > 0) {
    changes.push(
      `removed ${data.foldersRemoved.length} folder${data.foldersRemoved.length === 1 ? "" : "s"}`,
    );
  }

  if (changes.length === 0) {
    return null;
  }

  const summary = changes.join(", ");

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70">
        <CardsThreeIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          {summary.charAt(0).toUpperCase() + summary.slice(1)} from
        </span>
        <span className="shrink-0 font-medium">{data.projectName}</span>
      </div>
    </div>
  );
}

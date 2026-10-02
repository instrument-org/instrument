import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";

export function ProjectContextNote({
  data,
  folders,
}: {
  data: SessionMessageDataPart.ProjectContextDataPart;
  folders: SessionMessageDataPart.FolderAttachmentDataPart[];
}) {
  const added: string[] = [];
  if (data.instructions?.trim()) {
    added.push("instructions");
  }
  if (folders.length > 0) {
    added.push(`${folders.length} folder${folders.length === 1 ? "" : "s"}`);
  }

  if (added.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70">
        <CardsThreeIcon className="size-3.5 shrink-0" />
        <span className="truncate">Included {added.join(" and ")} from</span>
        <span className="shrink-0 font-medium">{data.projectName}</span>
      </div>
    </div>
  );
}

import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { FileIcon } from "@phosphor-icons/react/File";

import { IdeaSketch } from "./idea-sketch";
import { useIdeas } from "./use-ideas";

/**
 * What went with the ask, on the record under it: the page type the user
 * picked for the response, as its own pictogram and name, at the right
 * where the user's own words sit. Nothing about it is live; it says what
 * was asked for.
 */
export function OutputFormatNote({
  data,
}: {
  data: SessionMessageDataPart.OutputFormatDataPart;
}) {
  const ideas = useIdeas();
  const idea = ideas.data?.find((entry) => entry.name === data.name);
  return (
    <div className="flex justify-end">
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {idea ? (
          <IdeaSketch
            className="h-3.5 w-auto shrink-0"
            rows={idea.sketch ?? []}
          />
        ) : (
          <FileIcon className="size-3.5 shrink-0" />
        )}
        {data.title}
      </span>
    </div>
  );
}

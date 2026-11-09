import { rpcClient } from "@/client/rpc/client";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import { useQuery } from "@tanstack/react-query";

import { type Project } from "./chats";
import { ProjectMark } from "./project-mark";

/**
 * The top of the list while it is one project, in the tint the column wears
 * then: the project's mark on a white tile, its name in its ink, and the
 * start of the instructions every chat under it follows, so what Instrument
 * knows about the project is in view without opening it. Under them, Edit
 * for its details, and Open in Files for its folder, where the agent's work
 * for it is kept.
 */
export function ProjectBanner({
  onDetails,
  onOpenInFiles,
  project,
}: {
  onDetails: (project: Project) => void;
  onOpenInFiles: (project: Project) => void;
  project: Project;
}) {
  // The list names projects without their instructions, which are read
  // here for the one project shown.
  const { data: whole } = useQuery(
    rpcClient.workspace.projects.get.queryOptions({
      input: { projectId: project.id },
    }),
  );
  const instructions = stripMarkdown(whole?.instructions ?? "").trim();
  return (
    <div className="flex shrink-0 flex-col items-start px-4 pt-1 pb-4">
      <span className="grid size-11 place-items-center rounded-xl bg-background shadow-xs dark:bg-background/80">
        <ProjectMark
          className="size-7 text-[22px]"
          plain
          project={project}
          size="lg"
        />
      </span>
      <h2 className="mt-3 max-w-full truncate text-xl font-semibold text-(--project-tint-ink)">
        {project.name}
      </h2>
      {instructions && (
        <p className="mt-1 line-clamp-3 max-w-full text-[13px] leading-5 wrap-break-word text-foreground/65">
          {instructions}
        </p>
      )}
      <div className="mt-3 flex gap-1.5">
        <button
          className={BANNER_BUTTON}
          onClick={() => {
            onDetails(project);
          }}
          type="button"
        >
          Edit
        </button>
        <button
          className={BANNER_BUTTON}
          onClick={() => {
            onOpenInFiles(project);
          }}
          type="button"
        >
          Open in Files
        </button>
      </div>
    </div>
  );
}

/** A quiet button on the project's wash. */
const BANNER_BUTTON =
  "h-7 rounded-md bg-foreground/6 px-2.5 text-[13px] text-foreground/80 hover:bg-foreground/10 hover:text-foreground";

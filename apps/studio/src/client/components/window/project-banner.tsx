import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { type Project } from "./chats";

/**
 * The second line of the list's head while the list is one project, in the
 * tint the head wears then: the start of the instructions every chat under
 * it follows, so what Instrument knows about the project is in view without
 * opening it, with Edit project for its details quietly under them. The project's
 * mark and name are the picker's, just above, so they are not said again,
 * and the picker is the way back to the chats. A project with no
 * instructions shows Edit project alone.
 */
export function ProjectBanner({
  onDetails,
  project,
}: {
  onDetails: (project: Project) => void;
  project: Project;
}) {
  const instructions = stripMarkdown(project.instructions ?? "").trim();
  return (
    <div className="flex shrink-0 flex-col items-start gap-1 px-4 pb-3 text-sm leading-5">
      {instructions && (
        <p className="line-clamp-2 text-foreground/75">{instructions}</p>
      )}
      <button
        className="text-[13px] text-foreground/45 hover:text-foreground/75"
        onClick={() => {
          onDetails(project);
        }}
        type="button"
      >
        Edit project
      </button>
    </div>
  );
}

import { projectColor } from "@/client/components/window/project-colors";
import { projectTint } from "@/client/components/window/project-tint";
import { cn } from "@/client/lib/utils";

/** What a project is marked with, whatever the user has and has not chosen. */
export interface ProjectMarkSpec {
  color?: string;
  emoji?: string;
  name?: string;
}

/**
 * The mark that stands for a project wherever one is named: its emoji on a tile
 * of its color, never a word. Sized for where it sits, from a row's header
 * line up to the dialog that chooses it.
 */
export function ProjectMark({
  className,
  plain = false,
  size = "md",
  project,
}: {
  className?: string;
  /** The face alone, with no tile of the project's tint under it. */
  plain?: boolean;
  size?: "lg" | "md" | "sm";
  project: ProjectMarkSpec;
}) {
  const box =
    size === "lg"
      ? "size-11 rounded-xl text-[22px]"
      : size === "sm"
        ? "size-3.5 rounded-sm text-[9px]"
        : "size-4 rounded text-[10px]";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center leading-none project-tint select-none",
        box,
        className,
      )}
      style={{
        // A tint rather than a fill: the emoji has to stay legible on it, and a
        // row of solid squares would read as a toolbar.
        ...(plain
          ? {}
          : { background: "var(--project-tint-surface, var(--card))" }),
        ...projectTint(projectColor(project)),
      }}
      title={project.name}
    >
      <ProjectFace project={project} />
    </span>
  );
}

/**
 * What stands for a project with no tile under it: its emoji if it has one, and
 * otherwise the first letter of its name, so a project whose emoji the user never
 * chose still has to be told apart from its neighbors at a glance.
 */
function ProjectFace({ project }: { project: ProjectMarkSpec }) {
  if (project.emoji) {
    return <span>{project.emoji}</span>;
  }
  // By grapheme, so a name that starts with an emoji or an accented letter
  // gives one character rather than half of one.
  const [first] = new Intl.Segmenter().segment(project.name ?? "?");
  return (
    <span
      className="font-semibold uppercase"
      // The tint's ink rather than the color itself: a pale pick's own hex
      // would vanish on its own tile.
      style={{ color: "var(--project-tint-ink, currentColor)" }}
    >
      {first?.segment ?? "?"}
    </span>
  );
}

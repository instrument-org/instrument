import { projectColor } from "@/client/components/window/project-colors";
import { projectIcon } from "@/client/components/window/project-icons";
import { projectTint } from "@/client/components/window/project-tint";
import { cn } from "@/client/lib/utils";

/** What a project is marked with, whatever the user has and has not chosen. */
export interface ProjectMarkSpec {
  color?: string;
  emoji?: string;
  /** A Phosphor icon's name, drawn in the project's ink; a name outside this build's set is passed over. */
  icon?: string;
  name?: string;
}

/**
 * The mark that stands for a project wherever one is named: its icon or its
 * emoji on a tile of its color, never a word. Sized for where it sits, from a
 * row's header line up to the dialog that chooses it. `plain` leaves the tile
 * out, for a mark set on a surface of its own.
 */
export function ProjectMark({
  className,
  plain = false,
  size = "md",
  project,
}: {
  className?: string;
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
      <ProjectFace plain={plain} project={project} />
    </span>
  );
}

/**
 * What stands for a project on its tile: its icon or its emoji if it has one,
 * and otherwise the first letter of its name, so a project whose mark the user
 * never chose still has to be told apart from its neighbors at a glance.
 */
function ProjectFace({
  plain,
  project,
}: {
  plain: boolean;
  project: ProjectMarkSpec;
}) {
  // The tint's ink rather than the color itself: a pale pick's own hex
  // would vanish on its own tile.
  const ink = { color: "var(--project-tint-ink, currentColor)" };
  const icon = projectIcon(project.icon);
  if (icon) {
    // A share of the box rather than of the type, so the glyph sits in the
    // tile with a margin, and fills the box where there is no tile.
    return (
      <icon.Icon size={plain ? "100%" : "62%"} style={ink} weight="fill" />
    );
  }
  if (project.emoji) {
    return <span>{project.emoji}</span>;
  }
  // By grapheme, so a name that starts with an emoji or an accented letter
  // gives one character rather than half of one.
  const [first] = new Intl.Segmenter().segment(project.name ?? "?");
  return (
    <span className="font-semibold uppercase" style={ink}>
      {first?.segment ?? "?"}
    </span>
  );
}

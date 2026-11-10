import { type SessionMessageDataPart } from "../schemas/session/message-data-part";

type ProjectFieldChange = SessionMessageDataPart.ProjectFieldChange;

/**
 * One project a turn changed by command: its name now, each field it set,
 * and how it looked before and after, where that was recorded.
 */
export interface ChangedProject {
  fields: readonly ProjectFieldChange[];
  name: string;
  project?: SessionMessageDataPart.ChangedProjectLooks;
}

/** What a project's change comes to, as the person sees it: its mark, its color, its name, whether it is in use. */
type ChangeKind = "back" | "color" | "deleted" | "mark" | "renamed";

function kindOf(field: ProjectFieldChange): ChangeKind | undefined {
  switch (field.field) {
    case "icon":
    case "emoji": {
      return "mark";
    }
    case "color": {
      return "color";
    }
    case "name": {
      return "renamed";
    }
    case "retired": {
      return field.after ? "deleted" : "back";
    }
    // Its line about what goes in it shows nowhere in the app.
    case "about": {
      return undefined;
    }
  }
}

function kindsOf(project: ChangedProject): Set<ChangeKind> {
  return new Set(
    project.fields.flatMap((field) => {
      const kind = kindOf(field);
      return kind ? [kind] : [];
    }),
  );
}

/**
 * The card's heading, from what the turn did and to how many: what changed
 * when every project had the same kind of change ("Changed the icons and
 * colors of 10 projects", "Renamed 2 projects"), else how many changed. A
 * change to one project's mark or color names the project.
 */
export function projectChangesHeading(
  projects: readonly ChangedProject[],
): string {
  const [only] = projects;
  const count = projects.length;
  const kinds = new Set(projects.flatMap((project) => [...kindsOf(project)]));
  const marksOnly = [...kinds].every(
    (kind) => kind === "mark" || kind === "color",
  );
  if (kinds.size > 0 && marksOnly) {
    const one = count === 1;
    const what =
      kinds.size === 2
        ? one
          ? "icon and color"
          : "icons and colors"
        : kinds.has("mark")
          ? one
            ? "icon"
            : "icons"
          : one
            ? "color"
            : "colors";
    return `Changed the ${what} of ${one && only ? only.name : `${count.toString()} projects`}`;
  }
  const projectsWord =
    count === 1 ? "a project" : `${count.toString()} projects`;
  if (kinds.size === 1) {
    const [kind] = kinds;
    const verb =
      kind === "renamed"
        ? "Renamed"
        : kind === "deleted"
          ? "Deleted"
          : kind === "back"
            ? "Brought back"
            : undefined;
    if (verb) {
      return `${verb} ${projectsWord}`;
    }
  }
  return `Changed ${projectsWord}`;
}

/**
 * The lines under one project in the card: one for its look ("Icon and
 * color updated"), which the row's mark already shows as it is now, then one
 * each for a rename and for being deleted or brought back.
 */
export function projectChangeLines(
  project: ChangedProject,
): (
  | { kind: "look"; words: string }
  | { after: string; before: string; kind: "renamed" }
  | { kind: "deleted" | "back"; words: string }
)[] {
  const kinds = kindsOf(project);
  const lines: ReturnType<typeof projectChangeLines> = [];
  if (kinds.has("mark") || kinds.has("color")) {
    const mark = project.fields.some(
      (field) => field.field === "emoji" && field.after !== null,
    )
      ? "emoji"
      : "icon";
    lines.push({
      kind: "look",
      words: kinds.has("mark")
        ? kinds.has("color")
          ? `${mark === "emoji" ? "Emoji" : "Icon"} and color updated`
          : `${mark === "emoji" ? "Emoji" : "Icon"} updated`
        : "Color updated",
    });
  }
  const renamed = project.fields.find((field) => field.field === "name");
  if (renamed) {
    lines.push({
      after: renamed.after,
      before: renamed.before,
      kind: "renamed",
    });
  }
  if (kinds.has("deleted")) {
    lines.push({ kind: "deleted", words: "Deleted" });
  }
  if (kinds.has("back")) {
    lines.push({ kind: "back", words: "Brought back" });
  }
  return lines;
}

/**
 * What a project's mark is drawn from. With no icon or emoji it shows its
 * name's first letter, and with no color one its name picks.
 */
export interface ProjectLook {
  color?: string;
  emoji?: string;
  icon?: string;
  name?: string;
}

/**
 * How a project looked before the turn and as the turn left it, for the
 * card to draw side by side: as recorded when the command ran, or, for a
 * change recorded before that, worked back from `now`, how the project
 * looks at the moment.
 */
export function projectLooks(
  change: ChangedProject,
  now: ProjectLook,
): { after: ProjectLook; before: ProjectLook } {
  if (change.project) {
    const { after, before } = change.project;
    return { after, before: before ?? after };
  }
  const after = { ...now, name: change.name };
  return { after, before: projectLookBefore(after, change.fields) };
}

/**
 * A project's mark, color and name before the turn, from what it is now and
 * what the turn set: each field the turn changed goes back to its value
 * from before, so the card can draw the old mark beside the new one.
 */
export function projectLookBefore(
  now: ProjectLook,
  fields: readonly ProjectFieldChange[],
): ProjectLook {
  const look: ProjectLook = {
    ...(now.color === undefined ? {} : { color: now.color }),
    ...(now.emoji === undefined ? {} : { emoji: now.emoji }),
    ...(now.icon === undefined ? {} : { icon: now.icon }),
    ...(now.name === undefined ? {} : { name: now.name }),
  };
  for (const field of fields) {
    if (field.field === "name") {
      look.name = field.before;
    }
    if (
      field.field === "color" ||
      field.field === "emoji" ||
      field.field === "icon"
    ) {
      if (field.before === null) {
        delete look[field.field];
      } else {
        look[field.field] = field.before;
      }
    }
  }
  return look;
}

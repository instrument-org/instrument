import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type ChangedProject } from "../project-change-words";
import {
  listProjects,
  type Project,
  type ProjectChange,
  ProjectNameError,
  updateProject,
} from "./projects";

type ProjectFieldChange = SessionMessageDataPart.ProjectFieldChange;

/** Whether a project still has what the change set, as its file has it now. */
function stillStands(project: Project, field: ProjectFieldChange): boolean {
  switch (field.field) {
    case "name": {
      return project.name === field.after;
    }
    case "retired": {
      return Boolean(project.retired) === field.after;
    }
    default: {
      return (project[field.field] ?? null) === field.after;
    }
  }
}

/** The change that puts one field back as it was before the turn. */
function putBack(field: ProjectFieldChange): ProjectChange {
  switch (field.field) {
    case "name": {
      return { name: field.before };
    }
    case "retired": {
      return { retired: field.before };
    }
    // Empty takes the field away, which is how it was when it had none.
    case "about": {
      return { about: field.before ?? "" };
    }
    case "color": {
      return { color: field.before ?? "" };
    }
    case "emoji": {
      return { emoji: field.before ?? "" };
    }
    case "icon": {
      return { icon: field.before ?? "" };
    }
  }
}

/**
 * Puts back what a turn's commands changed about each project, field by
 * field, where the project still has what the turn set: one the person has
 * changed since is theirs, and stays. A project is found by the name the
 * turn left it with. Answers how many fields went back and how many stayed.
 */
export async function undoProjectChanges(
  changes: readonly ChangedProject[],
): Promise<{ skipped: number; undone: number }> {
  const projects = await listProjects();
  let undone = 0;
  let skipped = 0;
  for (const { fields, name } of changes) {
    const project = projects.find((each) => each.name === name);
    const standing = project
      ? fields.filter((field) => stillStands(project, field))
      : [];
    skipped += fields.length - standing.length;
    if (!project || standing.length === 0) {
      continue;
    }
    const change = standing.reduce<ProjectChange>(
      (sum, field) => ({ ...sum, ...putBack(field) }),
      {},
    );
    try {
      await updateProject(project.id, change);
      undone += standing.length;
    } catch (error) {
      // A project made since under the old name keeps it, and the rest of
      // this project's fields go back without the rename.
      if (!(error instanceof ProjectNameError) || change.name === undefined) {
        throw error;
      }
      const { name: _name, ...rest } = change;
      await updateProject(project.id, rest);
      undone += standing.length - 1;
      skipped += 1;
    }
  }
  return { skipped, undone };
}

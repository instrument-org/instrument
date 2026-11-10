import {
  isProjectIconName,
  PROJECT_COLOR_HEXES,
  PROJECT_COLOR_NAMES,
  PROJECT_ICON_GROUPS,
  PROJECT_ICONS,
  projectColorName,
  suggestProjectIcons,
} from "@instrument-org/shared/project-marks";
import { z } from "zod";

import {
  PROJECTS_ARE_THE_CHATS,
  PROJECTS_COMMAND,
} from "../../model-text/commands/projects-command";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import {
  createProject,
  listProjects,
  type Project,
  type ProjectChange,
  projectName,
  updateProject,
} from "../chat/projects";
import { recordProjectChange } from "../setup-changes";
import { defineCapability } from "./define";

const NAME = PROJECTS_COMMAND.name;

/** Changing the person's projects is the chat's, from what a task reports. */
const PROJECTS = {
  roleRefusal: PROJECTS_ARE_THE_CHATS,
  roles: ["chat"],
} as const;

const ListedProject = z.object({
  about: z.string().optional(),
  /** By its palette name, or as written where it is not one of the palette. */
  color: z.string().optional(),
  emoji: z.string().optional(),
  icon: z.string().optional(),
  id: z.string(),
  name: z.string(),
  retired: z.boolean().optional(),
});

/** The projects in use, which a chat can be filed under. */
export async function projectsInUse(): Promise<Project[]> {
  return (await listProjects()).filter((project) => project.retired !== true);
}

/** A project's color as the person picks it: its palette name, or the value its file has. */
function colorWord(color: string | undefined): string | undefined {
  return color === undefined ? undefined : (projectColorName(color) ?? color);
}

export const projectsList = defineCapability({
  input: z.object({
    retired: z
      .boolean()
      .default(false)
      .describe("the retired projects too, marked (retired)"),
  }),
  name: "projects.list",
  output: z.array(ListedProject),
  async run({ retired }) {
    return (await listProjects())
      .filter((project) => retired || project.retired !== true)
      .map((project) => {
        const color = colorWord(project.color);
        return {
          ...(project.about ? { about: project.about } : {}),
          ...(color ? { color } : {}),
          ...(project.emoji ? { emoji: project.emoji } : {}),
          ...(project.icon ? { icon: project.icon } : {}),
          id: project.id,
          name: project.name,
          ...(project.retired ? { retired: true } : {}),
        };
      });
  },
  summary:
    "The projects in use, each by its name and id, with its icon or emoji and its color.",
  surfaces: {
    cli: { help: "", words: ["projects", "list"] },
    script: {},
  },
  text: (projects) =>
    projects.length === 0
      ? "There are no projects yet."
      : projects
          .map((project) =>
            [
              `  ${project.name}  ${project.id}`,
              project.icon && `icon ${project.icon}`,
              project.emoji && `emoji ${project.emoji}`,
              project.color && `color ${project.color}`,
              project.retired && "(retired)",
            ]
              .filter(Boolean)
              .join("  "),
          )
          .join("\n"),
});

/** The project a word names, by its name whatever its case, or by its id. */
function projectNamed(projects: readonly Project[], word: string) {
  const lowered = word.toLowerCase();
  return projects.find(
    (project) => project.id === word || project.name.toLowerCase() === lowered,
  );
}

const projectArg = z.string({
  error: `which project? ${NAME} list names them.`,
});

/** The project named, or an error that names the ones there are. */
async function findProject(word: string): Promise<Project> {
  const projects = await listProjects();
  const found = projectNamed(projects, word);
  if (!found) {
    throw new Error(
      `no project named "${word}". ${NAME} list names them, and ${NAME} list --retired the retired ones too.`,
    );
  }
  return found;
}

type ProjectFieldChange = SessionMessageDataPart.ProjectFieldChange;

/**
 * Writes the change, records it for the note under the reply, and says what
 * was done, field by field. A field set to what it already was is said and
 * left alone.
 */
async function changeProject(
  project: Project,
  change: ProjectChange,
): Promise<string> {
  await updateProject(project.id, change);
  const after = (await listProjects()).find((each) => each.id === project.id);
  if (!after) {
    throw new Error(`${project.name} could not be changed.`);
  }
  return recordedChange(project, after);
}

/** Records what changed between a project before and after, field by field, and says it. */
function recordedChange(project: Project, after: Project): string {
  const fields: ProjectFieldChange[] = [];
  if (after.name !== project.name) {
    fields.push({ after: after.name, before: project.name, field: "name" });
  }
  for (const field of ["about", "color", "emoji", "icon"] as const) {
    const before = project[field] ?? null;
    const now = after[field] ?? null;
    if (before !== now) {
      fields.push({ after: now, before, field });
    }
  }
  if (Boolean(after.retired) !== Boolean(project.retired)) {
    fields.push({
      after: Boolean(after.retired),
      before: Boolean(project.retired),
      field: "retired",
    });
  }
  if (fields.length === 0) {
    return `${after.name} already was that; nothing changed.`;
  }
  recordProjectChange(
    { after: lookOf(after), before: lookOf(project), id: after.id },
    fields,
  );
  return `Changed ${after.name}: ${fields.map(saidChange).join(", ")}.`;
}

/** What a project's mark is drawn from, as the changes card draws it. */
function lookOf(project: Project): SessionMessageDataPart.ProjectLook {
  return {
    ...(project.color ? { color: project.color } : {}),
    ...(project.emoji ? { emoji: project.emoji } : {}),
    ...(project.icon ? { icon: project.icon } : {}),
    name: project.name,
  };
}

function saidChange(change: ProjectFieldChange): string {
  switch (change.field) {
    case "name": {
      return `renamed from ${change.before}`;
    }
    case "retired": {
      return change.after ? "retired" : "back in use";
    }
    case "color": {
      return `color ${colorWord(change.before ?? undefined) ?? "none"} → ${colorWord(change.after ?? undefined) ?? "none"}`;
    }
    default: {
      return `${change.field} ${change.before ?? "none"} → ${change.after ?? "none"}`;
    }
  }
}

const colorInput = z
  .enum(PROJECT_COLOR_NAMES)
  .optional()
  .describe("its color, from the app's palette");

const emojiInput = z.string().trim().min(1).max(8).optional();

const iconInput = z
  .string()
  .refine(isProjectIconName, {
    error: (issue) =>
      `"${String(issue.input)}" is not one of the app's icons. ${NAME} icons <words> finds ones that fit.`,
  })
  .optional();

/** A project shows an icon or an emoji, so a command takes one. */
const oneMark = {
  check: (input: { emoji?: string; icon?: string }) =>
    !(input.icon && input.emoji),
  error: "an icon or an emoji, not both: a project shows one.",
};

export const projectsCreate = defineCapability({
  input: z
    .object({
      about: z.string().optional().describe("a line on what goes in it"),
      color: colorInput,
      emoji: emojiInput.describe("one emoji to mark it with"),
      icon: iconInput.describe(
        `an icon from the app's set: ${NAME} icons finds one`,
      ),
      name: z.string({ error: "what is the project called?" }),
    })
    .refine(oneMark.check, { error: oneMark.error }),
  name: "projects.create",
  output: z.string(),
  async run({ about, color, emoji, icon, name }) {
    const existing = projectNamed(await listProjects(), projectName(name));
    if (existing && !existing.retired) {
      throw new Error(
        `there already is a project called ${existing.name}. ${NAME} set changes it.`,
      );
    }
    const made = await createProject({
      ...(about?.trim() ? { about: about.trim() } : {}),
      ...(color ? { color: PROJECT_COLOR_HEXES[color] } : {}),
      ...(emoji ? { emoji } : {}),
      ...(icon ? { icon } : {}),
      name,
    });
    if (existing) {
      return recordedChange(existing, made);
    }
    recordProjectChange({ after: lookOf(made), id: made.id }, []);
    return `Created ${made.name}, id ${made.id}.`;
  },
  summary:
    "Make a project, with its icon or emoji, its color and its line on what goes in it. A retired one by that name comes back.",
  surfaces: {
    cli: { help: "", positional: ["name"], words: ["projects", "create"] },
  },
  text: (said) => said,
  where: PROJECTS,
});

export const projectsSet = defineCapability({
  input: z
    .object({
      about: z
        .string()
        .optional()
        .describe("a line on what goes in it; empty takes it away"),
      color: colorInput,
      emoji: emojiInput.describe(
        "one emoji to mark it with, which replaces its icon",
      ),
      icon: iconInput.describe(
        `an icon from the app's set, which replaces its emoji: ${NAME} icons finds one`,
      ),
      name: z
        .string()
        .optional()
        .describe("a new name, which renames its folder"),
      project: projectArg,
    })
    .refine(oneMark.check, { error: oneMark.error }),
  name: "projects.set",
  output: z.string(),
  async run({ about, color, emoji, icon, name, project }) {
    const found = await findProject(project);
    return changeProject(found, {
      ...(about === undefined ? {} : { about: about.trim() }),
      ...(color ? { color: PROJECT_COLOR_HEXES[color] } : {}),
      ...(emoji ? { emoji } : {}),
      ...(icon ? { icon } : {}),
      ...(name === undefined ? {} : { name }),
    });
  },
  summary:
    "Change a project's name, its icon or emoji, its color, or its line on what goes in it.",
  surfaces: {
    cli: { help: "", positional: ["project"], words: ["projects", "set"] },
  },
  text: (said) => said,
  where: PROJECTS,
});

/** A command that takes projects out of the menus or puts them back. */
function retiredCapability({
  summary,
  to,
  word,
}: {
  summary: string;
  to: boolean;
  word: string;
}) {
  return defineCapability({
    input: z.object({ project: projectArg }),
    name: `projects.${word}`,
    output: z.string(),
    async run({ project }) {
      return changeProject(await findProject(project), { retired: to });
    },
    summary,
    surfaces: {
      cli: { help: "", positional: ["project"], words: ["projects", word] },
    },
    text: (said) => said,
    where: PROJECTS,
  });
}

export const projectsRetire = retiredCapability({
  summary:
    "Delete a project as the app does, which the user can undo: out of the menus, its folder and the chats filed under it left as they are.",
  to: true,
  word: "retire",
});

export const projectsUnretire = retiredCapability({
  summary: "Bring a deleted project back into the menus.",
  to: false,
  word: "unretire",
});

const ListedIcon = z.object({ group: z.string(), name: z.string() });

export const projectsIcons = defineCapability({
  input: z.object({
    words: z
      .array(z.string())
      .default([])
      .describe("what the project is about; none lists every icon"),
  }),
  name: "projects.icons",
  output: z.array(ListedIcon),
  run({ words }) {
    const groupOf = new Map<string, string>(
      PROJECT_ICON_GROUPS.flatMap(
        ({ icons, label }): (readonly [string, string])[] =>
          icons.map((icon: { name: string }) => [icon.name, label] as const),
      ),
    );
    const icons =
      words.length === 0
        ? PROJECT_ICONS
        : suggestProjectIcons(words.join(" "), 12);
    return Promise.resolve(
      icons.map((icon) => ({
        group: groupOf.get(icon.name) ?? "",
        name: icon.name,
      })),
    );
  },
  summary:
    "The icons a project can be marked with, best fit first for the words given.",
  surfaces: {
    cli: {
      help: "",
      positional: ["words"],
      words: ["projects", "icons"],
    },
    script: {},
  },
  text: (icons) =>
    icons.length === 0
      ? `No icon fits those words. ${NAME} icons with other words, or with none for every icon.`
      : icons.map((icon) => `  ${icon.name}  (${icon.group})`).join("\n"),
});

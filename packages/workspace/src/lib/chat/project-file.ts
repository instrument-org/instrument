import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { utcStamp } from "../utc-stamp";
import { splitFrontMatter } from "@instrument-org/shared";

import { isRecord } from "../skills";

/**
 * A project as its file holds it: `AGENTS.md`, the standing instructions every
 * chat under the project is read with, under plain YAML front matter.
 *
 * The instructions are the body, so a project opened in a text editor reads as
 * what it is and an edit there is the project, and another agent opened in
 * the folder reads them as its own. The front matter holds what the app and
 * another device have to agree on, and nothing a reader of the file would
 * have to decode. A file with none, one the person copied in, is a project
 * whose whole text is its instructions.
 *
 * A project's name is its folder's, so it is in no key here: renaming the
 * folder renames the project. Nor are the folders granted under it, which name
 * paths on one computer and are kept in that computer's permission settings
 * (`projects` there), so an edit to this file never opens a folder. Its `id`
 * is the one opaque value in the file, and it has to stay once anything points
 * at the project by it; without it a folder renamed in a file manager would
 * empty the project.
 */

/** Where the person's projects are, and the one file that says a folder is one. */
export { PROJECT_FILE_NAME, PROJECTS_FOLDER_NAME } from "../../constants";

/** The keys this build writes, and so the ones that are nobody else's. */
const OWN_KEYS = new Set([
  "about",
  "color",
  "created",
  "emoji",
  "id",
  "retired",
]);

/** What a project's `AGENTS.md` holds: everything about it but its name. */
export const ProjectFileSchema = z.object({
  /** The agent's line about what goes here, for later. */
  about: z.string().optional(),
  /** The tint its mark is drawn on. */
  color: z.string().optional(),
  /** When it was made, kept so the menus stay in the order they were made in. */
  created: z.date(),
  /** What stands for it: one emoji, chosen when it was made. */
  emoji: z.string().optional(),
  id: z.string(),
  /** The standing words for work under it; empty for most projects. */
  instructions: z.string().optional(),
  /**
   * Front matter this build does not write, kept as it was found. A project is
   * a file two programs write: the phone, a newer build, or the person with
   * an editor. Dropping a key on the way through would lose their work
   * silently, so what comes in unrecognized goes back out.
   */
  others: z.record(z.string(), z.unknown()).optional(),
  /** Out of the menus, with the chats that carry it left alone. */
  retired: z.boolean().optional(),
});

export type ProjectFile = z.output<typeof ProjectFileSchema>;

/**
 * A moment as a project's file keeps it: to the second, which is all `created`
 * writes, so the project in hand and the project on disk are the same project.
 */
export function toTheSecond(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

/** A project's file as read, which names no `id` until one is written into it. */
export type ProjectFileRead = Omit<ProjectFile, "id"> & { id?: string };

/**
 * A project from the bytes of its file. A file with no front matter, or with
 * a block that is not YAML, is all instructions, so nothing the person wrote
 * is lost when the app next writes the file.
 *
 * `at` is when the file was last written, which stands in for the `created`
 * the front matter does not hold.
 */
export function parseProjectFile(
  text: string,
  { at }: { at: Date },
): ProjectFileRead {
  const normalized = text.replaceAll("\r\n", "\n");
  const split = splitFrontMatter(normalized);
  if (split.ok) {
    try {
      const parsed = parseYaml(split.block) as unknown;
      if (isRecord(parsed)) {
        return fieldsOf(parsed, { at, instructions: split.body });
      }
    } catch {
      // Not YAML: the block stays in the instructions, as the person wrote it.
    }
  }
  return fieldsOf({}, { at, instructions: normalized });
}

/**
 * A project from a loose record of what was said about it, each key taken only
 * where it says something this build can use and the rest kept as `others`;
 * nothing where no `id` is named.
 *
 * The settings file a build before this one wrote is such a record, as is
 * front matter, which is why the coercion is here rather than in either
 * reader: a wrong type for a tint should cost the tint, never the project.
 */
export function projectFileOf(
  front: Record<string, unknown>,
  { at, instructions = "" }: { at: Date; instructions?: string },
): ProjectFile | undefined {
  const { id, ...rest } = fieldsOf(front, { at, instructions });
  return id ? { ...rest, id } : undefined;
}

function fieldsOf(
  front: Record<string, unknown>,
  { at, instructions }: { at: Date; instructions: string },
): ProjectFileRead {
  const others = Object.fromEntries(
    Object.entries(front).filter(([key]) => !OWN_KEYS.has(key)),
  );
  const about = words(front.about);
  const color = words(front.color);
  const emoji = words(front.emoji);
  const id = words(front.id);
  const standing = instructions.trim();
  return {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    created: toTheSecond(dateOf(front.created) ?? at),
    ...(emoji ? { emoji } : {}),
    ...(id ? { id } : {}),
    ...(standing ? { instructions: standing } : {}),
    ...(Object.keys(others).length > 0 ? { others } : {}),
    ...(front.retired === true ? { retired: true } : {}),
  };
}

/**
 * The file: the front matter, then the instructions. Written whole every
 * time, so the file is only ever one project's worth of bytes rather than
 * something patched in place.
 *
 * The keys this build knows come first, in a fixed order, and a key it does
 * not know follows them with its value and its shape as they were found, so
 * one save to the next never moves what somebody else wrote.
 */
export function renderProjectFile(project: ProjectFile): string {
  const front: Record<string, unknown> = { id: project.id };
  if (project.emoji !== undefined) {
    front.emoji = project.emoji;
  }
  if (project.color !== undefined) {
    front.color = project.color;
  }
  if (project.about !== undefined) {
    front.about = project.about;
  }
  front.created = utcStamp(project.created);
  // Only when true: a project in the menus says so by having no such line.
  if (project.retired === true) {
    front.retired = true;
  }
  for (const [key, value] of Object.entries(project.others ?? {})) {
    if (!(key in front)) {
      front[key] = value;
    }
  }
  // No line wrapping: a long line about a project is a long line, and folding
  // one would change the file every time a different build wrote it.
  const block = stringifyYaml(front, { lineWidth: 0 }).trimEnd();
  const instructions = project.instructions?.trim() ?? "";
  return `---\n${block}\n---\n${instructions ? `\n${instructions}\n` : ""}`;
}

function dateOf(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(Date.parse(value));
  }
  return undefined;
}

/**
 * The paths under a `folders:` list, which builds before this one wrote into
 * the front matter for the folders granted under a project, each by its path,
 * or written on its own the way a person would. Read once per computer, by
 * `moveProjectFolders`; nothing else reads the key.
 */
export function listedFolderPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    const folderPath = isRecord(entry) ? words(entry.path) : words(entry);
    return folderPath ? [folderPath] : [];
  });
}

/** A front-matter value as the text it names, or nothing where it names none. */
function words(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

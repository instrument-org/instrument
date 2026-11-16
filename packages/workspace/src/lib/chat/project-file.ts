import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { splitFrontMatter } from "@instrument-org/shared";

import { isRecord } from "../skills";

/**
 * A project's `AGENTS.md`: the standing instructions every chat under the
 * project is read with, and nothing else the app writes. Another agent opened
 * in the folder reads them as its own, and an edit there, by hand or by that
 * agent, is the project's instructions and can change nothing else.
 *
 * Builds before this one kept the rest of a project (its id, mark, tint,
 * about line, when it was made, whether it was retired) as plain YAML front
 * matter over the instructions. That now lives in the projects store
 * (`project-records.ts`), and the launch takes it out of each file
 * (`settleProjectFiles`); a build that still writes it may put it back, and
 * the next launch takes it out again. A key in the front matter this build
 * does not know is the person's, or another program's, and stays in the file.
 *
 * A project's name is its folder's, so renaming the folder renames the
 * project. The folders granted under it name paths on one computer and are
 * kept in that computer's permission settings (`projects` there), so an edit
 * to this file never opens a folder.
 */

/** Where the person's projects are, and the one file that says a folder is one. */
export {
  PROJECT_FILE_NAME,
  PROJECT_ID_FILE_NAME,
  PROJECTS_FOLDER_NAME,
} from "../../constants";

/**
 * The front-matter keys earlier builds wrote, and so the ones that are nobody
 * else's: what the launch takes out of the file into the projects store.
 * `projectId` is the 1.x project a build that called projects topics joined
 * one to.
 */
const OWN_KEYS = new Set([
  "about",
  "color",
  "created",
  "emoji",
  "icon",
  "id",
  "projectId",
  "retired",
]);

/** Everything about a project but its name. */
export const ProjectFileSchema = z.object({
  /** The agent's line about what goes here, for later. */
  about: z.string().optional(),
  /** The tint its mark is drawn on. */
  color: z.string().optional(),
  /** When it was made, kept so the menus stay in the order they were made in. */
  created: z.date(),
  /** What stands for it: one emoji, chosen when it was made. */
  emoji: z.string().optional(),
  /**
   * What stands for it in place of an emoji: a Phosphor icon by its name
   * (`books`), drawn in its color. A project has one or the other.
   */
  icon: z.string().optional(),
  id: z.string(),
  /** The standing words for work under it, its `AGENTS.md`; empty for most projects. */
  instructions: z.string().optional(),
  /** The 1.x project it was made from or joined to. */
  legacyId: z.string().optional(),
  /**
   * Front matter in its `AGENTS.md` this build does not know, kept as it was
   * found when the app writes the instructions. The file is written by more
   * than the app: the person with an editor, another agent, a newer build.
   * Dropping a key on the way through would lose their work silently.
   */
  others: z.record(z.string(), z.unknown()).optional(),
  /** Out of the menus, with the chats that carry it left alone. */
  retired: z.boolean().optional(),
});

export type ProjectFile = z.output<typeof ProjectFileSchema>;

/**
 * A moment as a project keeps it: to the second, which is all `created` ever
 * held, so the project in hand and the project read back are the same project.
 */
export function toTheSecond(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

/** A project's file as read, which names an `id` only where an earlier build wrote one. */
export type ProjectFileRead = Omit<ProjectFile, "id"> & { id?: string };

/**
 * A project from the bytes of its file, front matter an earlier build wrote
 * included. A file with no front matter, or with a block that is not YAML,
 * is all instructions, so nothing the person wrote is lost when the app next
 * writes the file.
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
  const icon = words(front.icon);
  const id = words(front.id);
  const legacyId = words(front.projectId);
  const standing = instructions.trim();
  return {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    created: toTheSecond(dateOf(front.created) ?? at),
    ...(emoji ? { emoji } : {}),
    ...(icon ? { icon } : {}),
    ...(id ? { id } : {}),
    ...(legacyId ? { legacyId } : {}),
    ...(standing ? { instructions: standing } : {}),
    ...(Object.keys(others).length > 0 ? { others } : {}),
    ...(front.retired === true ? { retired: true } : {}),
  };
}

/**
 * The file with the front-matter keys `drop` names taken out (by default every
 * key an earlier build wrote), its instructions and anyone else's keys kept;
 * the empty string where nothing is left, and nothing at all where the front
 * matter names none of them (or is not YAML), so there is nothing to write.
 */
export function withoutFrontMatterKeys(
  text: string,
  drop: ReadonlySet<string> = OWN_KEYS,
): string | undefined {
  const normalized = text.replaceAll("\r\n", "\n");
  const split = splitFrontMatter(normalized);
  if (!split.ok) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(split.block) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Object.keys(parsed).some((key) => drop.has(key))) {
    return undefined;
  }
  return renderInstructionsFile({
    instructions: split.body,
    others: Object.fromEntries(
      Object.entries(parsed).filter(([key]) => !drop.has(key)),
    ),
  });
}

/**
 * The file: the instructions, under the front matter this build does not know
 * where there is any, as it was found. Nothing at all for a project with
 * neither, which needs no file.
 */
export function renderInstructionsFile({
  instructions,
  others,
}: {
  instructions?: string;
  others?: Record<string, unknown>;
}): string {
  const body = instructions?.trim() ?? "";
  if (others === undefined || Object.keys(others).length === 0) {
    return body ? `${body}\n` : "";
  }
  // No line wrapping: folding a long value would change the file every time
  // a different build wrote it.
  const block = stringifyYaml(others, { lineWidth: 0 }).trimEnd();
  return `---\n${block}\n---\n${body ? `\n${body}\n` : ""}`;
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

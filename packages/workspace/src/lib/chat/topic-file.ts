import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { isRecord, splitFrontmatter } from "../skills";

/**
 * A topic as its file holds it: `TOPIC.md`, plain YAML front matter over the
 * standing instructions every chat under the topic is read with.
 *
 * The instructions are the body, so a topic opened in a text editor reads as
 * what it is and an edit there is the topic. The front matter holds what the
 * app and another device have to agree on, and nothing a reader of the file
 * would have to decode.
 *
 * A topic's name is its folder's, so it is in no key here: renaming the
 * folder renames the topic. Its `id` is the one opaque value in the file, and
 * it has to stay, because a chat's marks point at a topic by id; without it a
 * folder renamed in a file manager would empty the topic.
 */

/**
 * Where the person's topics are, at the workspace's top level: a folder per
 * topic named for it, each with the `TOPIC.md` that says what it is. One of
 * the six folders a person opens.
 */
export const TOPICS_FOLDER_NAME = "Topics";

/**
 * A topic in its folder. Capitalized like the one file that says what a
 * folder is in each of the six: a folder in `Topics/` without it is not a
 * topic's.
 */
export const TOPIC_FILE_NAME = "TOPIC.md";

/** A folder of the user's that work under a topic uses, by its path on disk. */
export const TopicFolderSchema = z.object({ path: z.string() });

export type TopicFolder = z.output<typeof TopicFolderSchema>;

/** The keys this build writes, and so the ones that are nobody else's. */
const OWN_KEYS = new Set([
  "about",
  "color",
  "created",
  "emoji",
  "folders",
  "id",
  "projectId",
  "retired",
]);

/** What a topic's `TOPIC.md` holds: everything about it but its name. */
export const TopicFileSchema = z.object({
  /** The agent's line about what goes here, for later. */
  about: z.string().optional(),
  /** The tint its mark is drawn on. */
  color: z.string().optional(),
  /** When it was made, kept so the menus stay in the order they were made in. */
  created: z.date(),
  /** What stands for it: one emoji, chosen when it was made. */
  emoji: z.string().optional(),
  /**
   * The user's folders the work under it uses, attached to each chat it is
   * on. These belong in the workspace's `permissions.json` rather than in a
   * document a person can widen by editing; they are here until that move.
   */
  folders: z.array(TopicFolderSchema).optional(),
  id: z.string(),
  /** The standing words for work under it; empty for most topics. */
  instructions: z.string().optional(),
  /**
   * Front matter this build does not write, kept as it was found. A topic is
   * a file two programs write: the phone, a newer build, or the person with
   * an editor. Dropping a key on the way through would lose their work
   * silently, so what comes in unrecognized goes back out.
   */
  others: z.record(z.string(), z.unknown()).optional(),
  /**
   * The 1.x project the migration made it from, or joined to it, so a later
   * boot finds it again by that rather than by a name two projects can share.
   */
  projectId: z.string().optional(),
  /** Out of the menus, with the chats that carry it left alone. */
  retired: z.boolean().optional(),
});

export type TopicFile = z.output<typeof TopicFileSchema>;

/**
 * A moment as a topic's file keeps it: to the second, which is all `created`
 * writes, so the topic in hand and the topic on disk are the same topic.
 */
export function toTheSecond(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

/**
 * A topic from the bytes of its file, or nothing where the file names no
 * topic: one with no front matter at all, or none holding an `id`, is
 * something else the person left in the folder.
 *
 * `at` is when the file was last written, which stands in for the `created`
 * the front matter does not hold.
 */
export function parseTopicFile(
  text: string,
  { at }: { at: Date },
): TopicFile | undefined {
  const split = splitFrontmatter(text);
  if (!split.ok) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(split.block) as unknown;
  } catch {
    return undefined;
  }
  return topicFileOf(isRecord(parsed) ? parsed : {}, {
    at,
    instructions: split.body,
  });
}

/**
 * A topic from a loose record of what was said about it, each key taken only
 * where it says something this build can use and the rest kept as `others`;
 * nothing where no `id` is named.
 *
 * Front matter is one such record, and the settings file a build before this
 * one wrote is another, which is why the coercion is here rather than in
 * either reader: a wrong type for a tint should cost the tint, never the
 * topic.
 */
export function topicFileOf(
  front: Record<string, unknown>,
  { at, instructions = "" }: { at: Date; instructions?: string },
): TopicFile | undefined {
  const id = words(front.id);
  if (!id) {
    return undefined;
  }
  const others = Object.fromEntries(
    Object.entries(front).filter(([key]) => !OWN_KEYS.has(key)),
  );
  const about = words(front.about);
  const color = words(front.color);
  const emoji = words(front.emoji);
  const folders = foldersOf(front.folders);
  const standing = instructions.trim();
  const projectId = words(front.projectId);
  return {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    created: toTheSecond(dateOf(front.created) ?? at),
    ...(emoji ? { emoji } : {}),
    ...(folders ? { folders } : {}),
    id,
    ...(standing ? { instructions: standing } : {}),
    ...(Object.keys(others).length > 0 ? { others } : {}),
    ...(projectId ? { projectId } : {}),
    ...(front.retired === true ? { retired: true } : {}),
  };
}

/**
 * The file: the front matter, then the instructions. Written whole every
 * time, so the file is only ever one topic's worth of bytes rather than
 * something patched in place.
 *
 * The keys this build knows come first, in a fixed order, and a key it does
 * not know follows them with its value and its shape as they were found, so
 * one save to the next never moves what somebody else wrote.
 */
export function renderTopicFile(topic: TopicFile): string {
  const front: Record<string, unknown> = { id: topic.id };
  if (topic.emoji !== undefined) {
    front.emoji = topic.emoji;
  }
  if (topic.color !== undefined) {
    front.color = topic.color;
  }
  if (topic.about !== undefined) {
    front.about = topic.about;
  }
  front.created = stamp(topic.created);
  // Only when true: a topic in the menus says so by having no such line.
  if (topic.retired === true) {
    front.retired = true;
  }
  if (topic.folders && topic.folders.length > 0) {
    front.folders = topic.folders.map((folder) => ({ path: folder.path }));
  }
  if (topic.projectId !== undefined) {
    front.projectId = topic.projectId;
  }
  for (const [key, value] of Object.entries(topic.others ?? {})) {
    if (!(key in front)) {
      front[key] = value;
    }
  }
  // No line wrapping: a long line about a topic is a long line, and folding
  // one would change the file every time a different build wrote it.
  const block = stringifyYaml(front, { lineWidth: 0 }).trimEnd();
  const instructions = topic.instructions?.trim() ?? "";
  return `---\n${block}\n---\n${instructions ? `\n${instructions}\n` : ""}`;
}

/**
 * When something happened as a person reads it: local time, no `T`, no `Z`,
 * no milliseconds, so the number matches the clock they were looking at.
 */
function stamp(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${day} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
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
 * The folders under a `folders:` list, each by its path; nothing for none. A
 * path written on its own counts, since that is how a person would write one.
 */
function foldersOf(value: unknown): TopicFolder[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const folders = value.flatMap((entry: unknown) => {
    const folderPath = isRecord(entry) ? words(entry.path) : words(entry);
    return folderPath ? [{ path: folderPath }] : [];
  });
  return folders.length > 0 ? folders : undefined;
}

/** A front-matter value as the text it names, or nothing where it names none. */
function words(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

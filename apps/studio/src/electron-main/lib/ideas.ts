import { type Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getRegistryDir } from "./registry-dir";

/**
 * The Ideas screen's catalog: the templates of the page skill, read off
 * the registry the app ships. Each template that carries an `idea.json` is an
 * idea, in the website's word for it; its examples are the finished pages
 * beside it, and their captures, when the registry has them, are the pictures
 * the screen shows before a page is opened. Read on every ask, since the list
 * is a couple of dozen folders and the registry only changes with a build.
 */
const PAGE_SKILL = "create-page";

const IdeaMetaSchema = z.object({
  /** The example the idea's tile stands for. */
  cover: z.string(),
  order: z.number(),
  /** The marks its tile is drawn with, first known one wins. */
  sketch: z.array(z.string()).optional(),
  tagline: z.string(),
  /** The first is the kind of thing the reader arrives with; the index groups by it. */
  tags: z.array(z.string()),
  title: z.string(),
  when: z.string(),
});

const ExampleMetaSchema = z.object({
  illustrative: z.boolean().optional(),
  note: z.string().optional(),
  prompt: z.string().optional(),
  title: z.string(),
  /** What this example shows of the shape that the other two do not. */
  variant: z.string().optional(),
});

export type Idea = z.output<typeof IdeaMetaSchema> & {
  examples: IdeaExample[];
  name: string;
};

interface IdeaExample {
  /** The picture of the page, when the registry carries one. */
  capture?: { path: string; version: number };
  /** The page itself, on this computer, to open as a page. */
  htmlPath: string;
  illustrative?: boolean;
  name: string;
  note?: string;
  prompt?: string;
  title: string;
  variant?: string;
}

export async function listIdeas(): Promise<Idea[]> {
  const templatesDir = path.join(
    getRegistryDir(),
    "skills",
    PAGE_SKILL,
    "templates",
  );
  let entries: Dirent[];
  try {
    entries = await fs.readdir(templatesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ideas = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<Idea | undefined> => {
        const templateDir = path.join(templatesDir, entry.name);
        const meta = IdeaMetaSchema.safeParse(
          await readJson(path.join(templateDir, "idea.json")),
        );
        // A template without a readable idea.json is the agent's alone.
        if (!meta.success) {
          return;
        }
        return {
          ...meta.data,
          examples: await readExamples(entry.name, templateDir),
          name: entry.name,
        };
      }),
  );
  return ideas
    .filter((idea) => idea !== undefined)
    .toSorted((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

async function readExamples(
  ideaName: string,
  templateDir: string,
): Promise<IdeaExample[]> {
  const examplesDir = path.join(templateDir, "examples");
  const capturesDir = path.join(getRegistryDir(), "captures", ideaName);
  let entries: string[];
  try {
    entries = await fs.readdir(examplesDir);
  } catch {
    return [];
  }
  const examples = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".html"))
      .toSorted()
      .map(async (entry): Promise<IdeaExample | undefined> => {
        const name = entry.slice(0, -".html".length);
        const meta = ExampleMetaSchema.safeParse(
          await readJson(path.join(examplesDir, `${name}.json`)),
        );
        // A page with no note beside it is still a page; its file name stands
        // in for the title the note would have given.
        const example: IdeaExample = {
          htmlPath: path.join(examplesDir, entry),
          name,
          title: meta.success ? meta.data.title : name,
          ...(meta.success && meta.data.variant
            ? { variant: meta.data.variant }
            : {}),
          ...(meta.success && meta.data.prompt
            ? { prompt: meta.data.prompt }
            : {}),
          ...(meta.success && meta.data.note ? { note: meta.data.note } : {}),
          ...(meta.success && meta.data.illustrative
            ? { illustrative: true }
            : {}),
        };
        const capturePath = path.join(capturesDir, `${name}.png`);
        try {
          const stats = await fs.stat(capturePath);
          example.capture = { path: capturePath, version: stats.mtimeMs };
        } catch {
          // No capture: the screen draws the page's name in its place.
        }
        return example;
      }),
  );
  return examples.filter((example) => example !== undefined);
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return;
  }
}

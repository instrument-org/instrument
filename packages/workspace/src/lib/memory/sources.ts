import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * Where the coding agents a person already runs keep what they know about
 * them, so memory can start from it rather than from nothing.
 *
 * Every one of these is a hidden folder in the home directory, which macOS
 * does not put behind a consent prompt: TCC covers Desktop, Documents,
 * Downloads, iCloud and other cloud storage, removable and network volumes,
 * and Time Machine, and nothing else in home. So looking is free, and the
 * screen can offer only what is actually there instead of listing six tools
 * the person has never installed.
 *
 * Reading them is the agent's job, not ours: it has the home folder mounted
 * already, it can tell a standing fact from a note about one old repository,
 * and a file that moves next release costs a sentence rather than a parser.
 * What is here is only enough to know the tool is installed and to tell the
 * agent where to start.
 */

export const MemorySourceSchema = z.object({
  /** The folder, as a person writes it: `~/.claude`. */
  home: z.string(),
  /** The product's name, as its own users say it. */
  name: z.string(),
  /** Where it really is, for the agent's brief. */
  path: z.string(),
  /** The site the product's mark comes from; it has no icon of its own on disk. */
  site: z.string(),
});

export type MemorySource = z.output<typeof MemorySourceSchema>;

interface KnownSource {
  /**
   * What has to exist for the tool to count as installed, any one of them. A
   * folder alone is left by an uninstall and by a tool that has only ever
   * been opened, so a marker is a file the tool writes once it has something
   * to say. A `*` segment stands for any one entry, for a tool that keeps
   * what it knows under a folder per project.
   */
  markers: string[][];
  name: string;
  /** Under the home directory, the way the tool itself writes it. */
  segments: string[];
  site: string;
}

const KNOWN: KnownSource[] = [
  {
    markers: [["CLAUDE.md"], ["projects", "*", "memory"]],
    name: "Claude Code",
    segments: [".claude"],
    site: "https://claude.ai",
  },
  {
    markers: [["AGENTS.md"]],
    name: "Codex",
    segments: [".codex"],
    site: "https://openai.com",
  },
  {
    markers: [["GEMINI.md"]],
    name: "Gemini CLI",
    segments: [".gemini"],
    site: "https://gemini.google.com",
  },
  {
    markers: [["rules"]],
    name: "Cursor",
    segments: [".cursor"],
    site: "https://cursor.com",
  },
  {
    markers: [["AGENTS.md"]],
    name: "opencode",
    segments: [".config", "opencode"],
    site: "https://opencode.ai",
  },
  {
    markers: [
      ["memories", "global_rules.md"],
      ["memories", "*"],
    ],
    name: "Windsurf",
    segments: [".codeium", "windsurf"],
    site: "https://windsurf.com",
  },
];

/**
 * The tools on this computer that have something to import, newest-known
 * first. A tool that is not installed is simply absent; nothing here says so.
 */
export async function listMemorySources(
  homeDir: string = os.homedir(),
): Promise<MemorySource[]> {
  const found = await Promise.all(
    KNOWN.map(async (source) => {
      const dir = path.join(homeDir, ...source.segments);
      const marked = await Promise.all(
        source.markers.map((marker) => exists(dir, marker)),
      );
      return marked.includes(true)
        ? {
            home: ["~", ...source.segments].join("/"),
            name: source.name,
            path: dir,
            site: source.site,
          }
        : undefined;
    }),
  );
  return found.flatMap((source) => (source ? [source] : []));
}

/** Whether the path under `dir` is there, with `*` matching any one entry. */
async function exists(dir: string, segments: string[]): Promise<boolean> {
  const [first, ...rest] = segments;
  if (first === undefined) {
    return true;
  }
  if (first !== "*") {
    const next = path.join(dir, first);
    return rest.length === 0
      ? fs
          .access(next)
          .then(() => true)
          .catch(() => false)
      : exists(next, rest);
  }
  const entries = await fs.readdir(dir).catch(() => []);
  const found = await Promise.all(
    entries.map((entry) => exists(path.join(dir, entry), rest)),
  );
  return found.includes(true);
}

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
   * What has to exist for the tool to count as installed. A folder alone is
   * left by an uninstall and by a tool that has only ever been opened, so the
   * marker is a file the tool writes once it has something to say.
   */
  marker: string[];
  name: string;
  /** Under the home directory, the way the tool itself writes it. */
  segments: string[];
  site: string;
}

const KNOWN: KnownSource[] = [
  {
    marker: ["CLAUDE.md"],
    name: "Claude Code",
    segments: [".claude"],
    site: "https://claude.ai",
  },
  {
    marker: ["AGENTS.md"],
    name: "Codex",
    segments: [".codex"],
    site: "https://openai.com",
  },
  {
    marker: ["GEMINI.md"],
    name: "Gemini CLI",
    segments: [".gemini"],
    site: "https://gemini.google.com",
  },
  {
    marker: ["rules"],
    name: "Cursor",
    segments: [".cursor"],
    site: "https://cursor.com",
  },
  {
    marker: ["AGENTS.md"],
    name: "opencode",
    segments: [".config", "opencode"],
    site: "https://opencode.ai",
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
      const marker = path.join(dir, ...source.marker);
      const exists = await fs
        .access(marker)
        .then(() => true)
        .catch(() => false);
      return exists
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

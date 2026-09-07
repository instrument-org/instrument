import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { getAppCatalog } from "../apps/catalog";
import { truncateMiddle } from "../truncate-buffer";
import { createAppCommand } from "./app";

const taskId = TaskIdSchema.parse("app-catalog-task");

async function catalog(...words: string[]) {
  const result = await createAppCommand({ taskId }).execute(
    ["catalog", ...words],
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
  return result.stdout;
}

describe("app catalog", () => {
  it("names the MCP server as the way in when a service has one", async () => {
    const text = await catalog("linear");
    expect(text).toContain(
      "set up: app new linear --name 'Linear' --mcp https://mcp.linear.app/mcp",
    );
  });

  // The set-up line used to be placeholders (--api <base-url> --auth <kind>)
  // for every service without an MCP server, which the agent filled in and
  // had refused; a keyed API gets its real base, and a service with no way in
  // that a card can open is told so rather than handed a line that cannot run.
  it("sets a keyed API up at its own base", async () => {
    const text = await catalog("github");
    expect(text).toContain(
      "set up: app new github --name 'GitHub' --api https://api.github.com --auth bearer --test",
    );
    expect(text).not.toContain("<base-url>");
  });

  // Figma's hosted server only registers clients Figma has approved, so the
  // desktop app's own server is the way in; it wants no sign-in, and the line
  // has to say so, since an MCP app defaults to a sign-in card.
  it("puts --auth none on a keyless MCP server's line", async () => {
    const text = await catalog("figma");
    expect(text).toContain(
      "set up: app new figma --name 'Figma' --mcp http://127.0.0.1:3845/mcp --auth none",
    );
  });

  it("says plainly when every way in needs a client the card cannot make", async () => {
    const text = await catalog("google-workspace");
    expect(text).toContain("set up: not as an app from here");
    expect(text).toContain("Browser screen");
    expect(text).not.toContain("<base-url>");
  });

  // The listing reaches the model through a command's output, which is kept as
  // a head and a tail with the middle dropped. Every entry in full ran to 43KB
  // and came back missing everything from "consensus" to "slack", the agent's
  // own note the only sign the directory it read was a fifth of the real one.
  it("keeps every service in a listing nobody narrowed", async () => {
    const text = await catalog();
    expect(truncateMiddle(text).truncated).toBe(false);
    const listed = new Set(
      [...text.matchAll(/^ {2}(\S+) /gm)].map((match) => match[1]),
    );
    const missing = getAppCatalog()
      .map((entry) => entry.slug)
      .filter((slug) => !listed.has(slug));
    expect(missing).toEqual([]);
  });

  // A query names a service, so an entry that is the thing asked for comes
  // ahead of one that mentions it: "paper" also matches Consensus, whose
  // tagline reads "read what the papers found", and used to answer with it.
  it.each(["paper", "expo", "front", "box", "make"])(
    "answers %s with the service of that name first",
    async (query) => {
      const text = await catalog(query);
      expect(text.startsWith(`${query}  `)).toBe(true);
    },
  );

  // A word like "data" matches dozens, and those in full are the same wall the
  // bare listing was.
  it("gives a broad query the detail on a few and a line for the rest", async () => {
    const text = await catalog("data");
    expect(truncateMiddle(text).truncated).toBe(false);
    expect(text).toContain('more match "data":');
  });
});

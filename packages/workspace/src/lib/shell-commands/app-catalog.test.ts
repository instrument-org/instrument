import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
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

  it("says plainly when every way in needs a client the card cannot make", async () => {
    const text = await catalog("google-workspace");
    expect(text).toContain("set up: not as an app from here");
    expect(text).toContain("Browser screen");
    expect(text).not.toContain("<base-url>");
  });
});

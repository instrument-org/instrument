import { describe, expect, it } from "vitest";

import { buildProjectContextText } from "./build-project-context-text";

describe("buildProjectContextText", () => {
  it("frames the instructions as standing setup and points at the mount", () => {
    expect(
      buildProjectContextText({
        instructions: "Use British spelling.",
        name: "Acme",
      }),
    ).toMatchInlineSnapshot(`
      "<project_instructions>
      This task belongs to the "Acme" project. These instructions apply to the whole task and persist across every turn -- treat them as standing setup, not as something attached in a single message.

      Use British spelling.

      The instructions above are \`/project/AGENTS.md\`, and the project's folder is mounted read-and-write at \`/project/\`. Editing that file changes the standing instructions for every task in this project, so only do that when the user asks you to.
      </project_instructions>"
    `);
  });

  // A project with an empty AGENTS.md still has a folder the agent can use, so
  // the block is rendered for the mount alone.
  it("still announces the mount when the project has no instructions", () => {
    const text = buildProjectContextText({ name: "Acme" });
    expect(text).toContain(`It has no instructions set.`);
    expect(text).toContain("/project/");
  });
});

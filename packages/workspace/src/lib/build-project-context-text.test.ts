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

      Everything in \`/project/\` outlives this task, so it is not where this task's work goes: scripts, scratch, and intermediate files belong in \`work/\`, and finished deliverables in \`output/\`, the same as outside a project. Deleting a task takes its folder with it and leaves anything here behind, so a file put here without a reason to outlive the task is one nobody will clean up. Write here for something meant to apply to the project's later tasks as well: a convention to follow, a note worth having next time. Something the user asked you to produce is this task's result and belongs in \`output/\`, even when they mention the project while asking for it.
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

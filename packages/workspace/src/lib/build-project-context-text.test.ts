import { describe, expect, it } from "vitest";

import { buildProjectContextText } from "./build-project-context-text";

describe("buildProjectContextText", () => {
  it("frames the instructions as standing setup", () => {
    expect(
      buildProjectContextText({
        instructions: "Use British spelling.",
        name: "Acme",
      }),
    ).toMatchInlineSnapshot(`
      "<project_instructions>
      This task belongs to the "Acme" project. These instructions apply to the whole task and persist across every turn -- treat them as standing setup, not as something attached in a single message.

      Use British spelling.
      </project_instructions>"
    `);
  });

  // The 1.x project folder is set aside by the import, so nothing here may
  // send the agent looking for it.
  it("names no mount when the project has no instructions", () => {
    const text = buildProjectContextText({ name: "Acme" });
    expect(text).toContain(`It has no instructions set.`);
    expect(text).not.toContain("mount");
  });
});

import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import { instrumentPlugin } from "./eslint-rules";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

// The rule that guards these paths cannot itself be written with `MOUNT`: what
// it has to prove is that these exact characters are found and these exact
// characters are left alone.
ruleTester.run(
  "no-bare-mount-path",
  instrumentPlugin.rules["no-bare-mount-path"],
  {
    invalid: [
      {
        code: `const a = "/mnt/Photos/cat.png";`,
        errors: [{ messageId: "bareMountPath" }],
      },
      {
        code: "const a = `open /task/output/report.pdf`;",
        errors: [{ messageId: "bareMountPath" }],
      },
      // The third slash of a file URL is the start of the path, not part of the
      // scheme, so this is a mount reference like any other.
      {
        code: `const a = "file:///task/x.html";`,
        errors: [{ messageId: "bareMountPath" }],
      },
      // Naming a mount with nothing after it is still naming it.
      {
        code: `const a = "mounted under /mnt";`,
        errors: [{ messageId: "bareMountPath" }],
      },
      // One report per string, naming every mount in it.
      {
        code: `const a = "/task/... and /mnt/... both work";`,
        errors: [
          {
            data: {
              paths: "`/mnt`, `/task`",
              replacements: "MOUNT.attachedFolders, MOUNT.task",
            },
            messageId: "bareMountPath",
          },
        ],
      },
    ],
    valid: [
      // A module specifier is a path in another space that shares a spelling.
      { code: `import { findSkills } from "../skills";` },
      { code: `export { x } from "../../skills";` },
      { code: `const m = await import("../skills");` },
      // The prompts are full of XML-ish sections, and a closing tag is not a path.
      { code: `const a = "<task>do the thing</task>";` },
      { code: "const a = `<project>\\n</project>`;" },
      // Longer names that merely start with a mount's.
      { code: `const a = "/task-id";` },
      { code: `const a = "/project_root";` },
      // A repo-relative path that ends in a mount's name.
      { code: `const a = ".agents/skills/foo";` },
      { code: `const a = "work/skills/foo";` },
      // A URL authority is not a mount, though it is spelled with two slashes.
      { code: `const a = "https://skills.sh";` },
      { code: `const a = "https://example.com/project/123";` },
      // What the rule is asking for.
      { code: "const a = `${MOUNT.attachedFolders}/Photos/cat.png`;" },
      // Nothing to find.
      { code: `const a = "no paths here";` },
      { code: `const a = 42;` },
    ],
  },
);

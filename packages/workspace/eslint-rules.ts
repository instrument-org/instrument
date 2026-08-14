import { type Rule } from "eslint";

import { MOUNT } from "./src/mount-points";

/**
 * Each mount, with the pattern that finds it written out as text.
 *
 * Built from `MOUNT` rather than restated, so a fifth mount is banned as a
 * literal the moment it is added and there is no second list to keep in step.
 *
 * A match is preceded by nothing word-like, so `.agents/skills/x` and
 * `foo/task` are not mount references; by no `<`, so a prompt's closing
 * `</task>` tag is not one; and by no `:/`, so the authority in
 * `https://skills.sh` is not one either, while the third slash of
 * `file:///task/...` still is. It is followed by nothing word-like, so
 * `/task-id` is not one. What remains is a path that starts at a mount,
 * whether it continues into the tree or ends there.
 */
const MOUNTS = Object.entries(MOUNT).map(([key, path]) => ({
  key,
  path,
  pattern: new RegExp(String.raw`(?<![\w.<-])(?<!:/)${path}(?![\w-])`),
}));

/**
 * Ban the mount paths as bare text, in code and in the prose the agent reads.
 *
 * The agent has to type these exactly, so a sentence that spells one out is a
 * copy of the mount rather than a reference to it, and nothing fails when the
 * two disagree: the model simply follows instructions to a path that no longer
 * exists. Interpolating `MOUNT` makes the prose track the mount it names.
 *
 * Only string and template text is checked. A comment naming `/task` is
 * addressed to a reader who can see the surrounding code and reads worse with
 * an expression spliced into it, and a regex that matches a mount cannot
 * interpolate one without becoming a `new RegExp` call.
 */
const noBareMountPath: Rule.RuleModule = {
  create(context) {
    const report = (loc: Rule.Node["loc"], text: string) => {
      // Nothing without a slash can hold a mount path, which is nearly every
      // string in the package.
      if (loc == null || !text.includes("/")) {
        return;
      }
      const hits = MOUNTS.filter(({ pattern }) => pattern.test(text));
      if (hits.length === 0) {
        return;
      }
      context.report({
        data: {
          paths: hits.map(({ path }) => `\`${path}\``).join(", "),
          replacements: hits.map(({ key }) => `MOUNT.${key}`).join(", "),
        },
        loc,
        messageId: "bareMountPath",
      });
    };

    return {
      Literal(node) {
        if (typeof node.value !== "string") {
          return;
        }
        // A module specifier is a path in a different space that happens to
        // share a spelling, and rewriting one would break the import.
        const { parent } = node;
        if (
          parent.type === "ExportAllDeclaration" ||
          parent.type === "ExportNamedDeclaration" ||
          parent.type === "ImportDeclaration" ||
          parent.type === "ImportExpression"
        ) {
          return;
        }
        report(node.loc, node.value);
      },
      TemplateElement(node) {
        report(node.loc, node.value.raw);
      },
    };
  },
  meta: {
    docs: {
      description:
        "Require the MOUNT constants instead of writing a mount path as text",
    },
    messages: {
      bareMountPath:
        "{{paths}} is written out here. Interpolate {{replacements}} from `mount-points` so this cannot drift from the mount it names.",
    },
    schema: [],
    type: "problem",
  },
};

export const instrumentPlugin = {
  rules: { "no-bare-mount-path": noBareMountPath },
};

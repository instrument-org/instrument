import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

import { answersFor, turnEndTests } from "./turn-end.ts";

const root = path.join(import.meta.dirname, "..");
const tests = turnEndTests(root);
const due = (file: string, text = "") =>
  tests
    .filter((test) => answersFor(test, [file], () => text))
    .map((test) => path.posix.basename(test.file))
    .sort();

// One of each kind of subject: by place, by place and text, and regenerated.
it.each([
  [
    "apps/studio/src/client/components/settings/pane.tsx",
    "",
    [
      "product-guide-places.test.tsx",
      "product-guide.test.ts",
      "settings-index.test.ts",
    ],
  ],
  [
    "apps/studio/src/client/components/toolbar.tsx",
    "<div />",
    ["product-guide-places.test.tsx"],
  ],
  [
    "apps/studio/src/client/components/toolbar.tsx",
    "<TooltipTrigger>",
    ["icon-button-accessible-name.test.ts", "product-guide-places.test.tsx"],
  ],
  [
    "apps/studio/src/client/components/toolbar.tsx",
    "h-[80vh]",
    ["product-guide-places.test.tsx", "use-app-zoom.test.tsx"],
  ],
  [
    "apps/studio/src/electron-main/rpc/routes/a.ts",
    "throw errors.GONE()",
    ["report-policy.test.ts"],
  ],
  [
    "apps/studio/src/electron-main/menus/app-window.ts",
    "",
    ["product-guide.test.ts"],
  ],
  [
    "packages/workspace/src/lib/titles.ts",
    "await generateText({",
    ["every-model-call-names-a-purpose.test.ts"],
  ],
  [
    "packages/workspace/src/lib/a.ts",
    "[x](instrument://settings/x)",
    ["product-guide.test.ts"],
  ],
  [
    "packages/workspace/src/model-text/notes/a-model-text.ts",
    "",
    ["model-text-bytes.test.ts", "model-text-home.test.ts"],
  ],
  [
    "packages/workspace/src/lib/records/record.ts",
    "",
    ["records-guide.test.ts"],
  ],
  [
    "packages/workspace/src/lib/shell-commands/native-text.ts",
    "",
    ["native-text-doc.test.ts"],
  ],
])("an edit to %s with %j runs %j", (file, text, expected) => {
  expect(due(file, text)).toEqual(expected);
});

it("marks every test that runs on every landing but the compiler's, which the turn's end asks file by file", () => {
  const landing = execFileSync(
    "git",
    ["grep", "-l", "^// land: every landing", "--", "*.test.ts", "*.test.tsx"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const marked = new Set(tests.map(({ file }) => file));
  expect(landing.filter((file) => !marked.has(file))).toEqual([
    "apps/studio/src/client/react-compiler-coverage.test.ts",
  ]);
});

import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

import { APP_RULES, modelRules } from "./tab-drive";

it("names only rules the model or the driver describes", () => {
  const run = fs.readFileSync(
    path.join(import.meta.dirname, "tab-drive-run.ts"),
    "utf8",
  );
  const used = new Set(
    [...run.matchAll(/(?:broke\(|rule: )"(\w+)"/g)].map(([, rule]) => rule ?? ""),
  );
  const known = { ...modelRules(), ...APP_RULES };
  expect([...used].filter((rule) => !(rule in known))).toEqual([]);
  expect(used.size).toBeGreaterThan(8);
});

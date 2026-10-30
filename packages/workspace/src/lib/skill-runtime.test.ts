import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { getSkillRuntime } from "./skill-runtime";

const made: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    made.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

it("reads a skill's package.json off the main thread", async () => {
  const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"));
  made.push(skillDir);
  await fs.writeFile(
    path.join(skillDir, "package.json"),
    JSON.stringify({ dependencies: { leftpad: "1.0.0" } }),
  );
  const opened = vi.spyOn(fsSync.promises, "open");

  expect(await getSkillRuntime(skillDir, "test-skill")).toEqual({
    node: true,
    python: false,
  });
  expect(opened).toHaveBeenCalledWith(path.join(skillDir, "package.json"), "r");
});

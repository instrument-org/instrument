// land: every landing. It reads source as text, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { settingsTargetOf } from "@/client/components/settings/settings-index";
import { instrumentLinkOf } from "@instrument-org/shared";
import { isScreenName } from "@/shared/instrument-screens";

import { productGuideReference } from "./product-guide";

const GUIDE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/workspace/system-skills/instrument-guide",
);
const WORKSPACE_DIR = path.resolve(GUIDE_DIR, "../..");

describe("the product guide skill", () => {
  it("carries the reference as the app has it, so a new setting reaches the agent with the change that adds it", async () => {
    await expect(productGuideReference()).toMatchFileSnapshot(
      path.join(GUIDE_DIR, "reference.md"),
    );
  });

  it("links only settings and screens the app has", () => {
    const text = fs.readFileSync(path.join(GUIDE_DIR, "SKILL.md"), "utf8");
    const links = [...text.matchAll(/\]\((instrument:\/\/[^)\s]+)\)/g)].map(
      (match) => match[1] ?? "",
    );
    expect(links.length).toBeGreaterThan(0);
    expect(brokenLinks(links)).toEqual([]);
  });
});

describe("the workspace's own text", () => {
  // Errors and notes the agent relays link the setting that fixes them, so a
  // renamed row would otherwise leave a chip that opens a search.
  it("links only settings and screens the app has", () => {
    const links = fs
      .globSync("src/**/*.ts", { cwd: WORKSPACE_DIR })
      .filter((file) => !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(WORKSPACE_DIR, file), "utf8");
        return [
          ...text.matchAll(/instrument:\/\/(?:settings|screen)\/[\w:-]+/g),
        ].map((match) => match[0]);
      });
    expect(links.length).toBeGreaterThan(0);
    expect(brokenLinks(links)).toEqual([]);
  });
});

function brokenLinks(links: string[]): string[] {
  return links.filter((url) => {
    const link = instrumentLinkOf(url);
    if (link?.kind === "settings") {
      return settingsTargetOf(link.name).kind === "search";
    }
    if (link?.kind === "screen") {
      return !isScreenName(link.name);
    }
    return true;
  });
}

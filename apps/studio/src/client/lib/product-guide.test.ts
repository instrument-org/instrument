import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { settingsTargetOf } from "@/client/components/settings/settings-index";
import { instrumentLinkOf } from "@/shared/instrument-link";
import { isScreenName } from "@/shared/instrument-screens";

import { productGuideReference } from "./product-guide";

const GUIDE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/workspace/system-skills/instrument-guide",
);

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
    const broken = links.filter((url) => {
      const link = instrumentLinkOf(url);
      if (link?.kind === "settings") {
        return settingsTargetOf(link.name).kind === "search";
      }
      if (link?.kind === "screen") {
        return !isScreenName(link.name);
      }
      return true;
    });
    expect(broken).toEqual([]);
  });
});

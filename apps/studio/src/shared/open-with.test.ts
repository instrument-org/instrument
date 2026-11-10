import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VIEWED_EXTENSIONS } from "./open-with";

// The open-in-instrument skill in the registry submodule tells other agents
// which files to link into the app. Its catalog is written by hand, so this
// holds it to the viewers the app actually has: a viewer added or dropped here
// fails until the skill says so too.
const SKILL_MD = path.join(
  import.meta.dirname,
  "../../../../registry/skills/open-in-instrument/SKILL.md",
);

/** The extensions written as `.ext` in a piece of Markdown, without the dot. */
function extensionsIn(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/`\.([a-z0-9]+)`/g)].map((match) => match[1]!),
  );
}

async function catalog() {
  const skill = await readFile(SKILL_MD, "utf8");
  const section = /^## What Instrument opens\n([\s\S]*?)\n## /m.exec(skill);
  if (!section) throw new Error(`${SKILL_MD} has no "What Instrument opens"`);
  const text = section[1]!;
  const bullets = text
    .split("\n")
    .filter((line) => line.startsWith("- ") && !line.includes("plain text"));
  const unsupported = /Other archives,(.*?)do not open/.exec(text);
  if (!unsupported) throw new Error("The catalog names nothing as not opening");
  return {
    linked: extensionsIn(bullets.join("\n")),
    mentioned: extensionsIn(text),
    unsupported: extensionsIn(unsupported[1]!),
  };
}

describe("the open-in-instrument skill's catalog", () => {
  it("links only extensions a viewer opens", async () => {
    const { linked } = await catalog();
    const unviewed = [...linked].filter((ext) => !(ext in VIEWED_EXTENSIONS));
    expect(unviewed).toEqual([]);
  });

  it("mentions every extension a viewer opens", async () => {
    const { mentioned } = await catalog();
    const missing = Object.keys(VIEWED_EXTENSIONS).filter(
      (ext) => !mentioned.has(ext),
    );
    expect(missing).toEqual([]);
  });

  it("names as not opening only what no viewer opens", async () => {
    const { unsupported } = await catalog();
    expect(unsupported.size).toBeGreaterThan(0);
    const viewed = [...unsupported].filter((ext) => ext in VIEWED_EXTENSIONS);
    expect(viewed).toEqual([]);
  });
});

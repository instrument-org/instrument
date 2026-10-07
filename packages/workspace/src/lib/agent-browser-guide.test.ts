import { describe, expect, it } from "vitest";

import {
  agentBrowserGuide,
  headingsOf,
  INSTRUMENT_ADDENDUM,
  LEFT_OUT_SECTIONS,
  upstreamCoreGuide,
  withoutSections,
} from "./agent-browser-guide";
import { BLOCKED_SUBCOMMANDS } from "./shell-commands/agent-browser";
import { SKILL_CONTENT_LIMIT } from "./skills";

/**
 * The guide is the installed agent-browser release's own text, so these hold
 * it to this app when a release changes it: a section it leaves out must still
 * be there to leave out, and a command the app refuses must not be taught
 * without the addendum saying so.
 */
describe("the agent-browser guide", () => {
  it("leaves out only sections the installed release has", () => {
    const headings = headingsOf(upstreamCoreGuide());
    expect(
      LEFT_OUT_SECTIONS.filter((left) => !headings.includes(left)),
    ).toEqual([]);
  });

  it("names, in the addendum, every refused command the upstream guide still teaches", () => {
    const upstream = withoutSections(upstreamCoreGuide(), LEFT_OUT_SECTIONS);
    const taught = new Set(
      [...upstream.matchAll(/agent-browser ([a-z][a-z-]*)/g)].map(
        (match) => match[1],
      ),
    );
    const unexplained = [...taught].filter(
      (subcommand) =>
        subcommand !== undefined &&
        BLOCKED_SUBCOMMANDS.has(subcommand) &&
        !INSTRUMENT_ADDENDUM.includes(`\`${subcommand}\``),
    );
    expect(unexplained).toEqual([]);
  });

  it("fits whole in what a delivered skill may carry", () => {
    expect(agentBrowserGuide().length).toBeLessThan(SKILL_CONTENT_LIMIT);
  });

  it("leads with the addendum and drops each left-out section to the next of its level", () => {
    const guide = agentBrowserGuide();
    expect(guide.startsWith(INSTRUMENT_ADDENDUM)).toBe(true);
    for (const left of LEFT_OUT_SECTIONS) {
      expect(headingsOf(guide)).not.toContain(left);
    }
    expect(headingsOf(guide)).toContain("## The core loop");
  });

  it("reads a line starting with # inside a code fence as code, not a heading", () => {
    const markdown = [
      "## Keep",
      "kept",
      "## Drop",
      "```bash",
      "# a shell comment",
      "```",
      "dropped",
      "### Still dropped",
      "## After",
      "kept too",
    ].join("\n");
    expect(withoutSections(markdown, ["## Drop"])).toBe(
      ["## Keep", "kept", "## After", "kept too"].join("\n"),
    );
  });
});

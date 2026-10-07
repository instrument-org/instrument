import { describe, expect, it } from "vitest";

import { agentBrowserGuide, INSTRUMENT_ADDENDUM } from "./agent-browser-guide";
import {
  coreGuideFrom,
  generatedGuideModule,
  headingsOf,
  installedAgentBrowser,
  LEFT_OUT_SECTIONS,
  upstreamCoreGuide,
  withoutSections,
} from "./agent-browser-guide-source";
import {
  AGENT_BROWSER_CORE_GUIDE,
  AGENT_BROWSER_CORE_GUIDE_READ_FROM,
  AGENT_BROWSER_CORE_REFERENCES,
} from "./agent-browser-core-guide.generated";
import {
  BLOCKED_FLAGS,
  BLOCKED_SUBCOMMANDS,
} from "./shell-commands/agent-browser";
import { SKILL_CONTENT_LIMIT } from "./skills";

/**
 * The guide is the agent-browser release's own text, generated into the
 * repository, so these hold it to the installed release and to this app: a
 * new release fails here until the guide is generated again, a section left
 * out must still be there to leave out, and a command or flag the app refuses
 * must not be taught without the addendum saying so.
 */
describe("the agent-browser guide", () => {
  const installed = installedAgentBrowser();

  it("was generated from the agent-browser release that is installed (run script:refresh-agent-browser-guide)", () => {
    expect(
      generatedGuideModule({
        guide: AGENT_BROWSER_CORE_GUIDE,
        references: AGENT_BROWSER_CORE_REFERENCES,
        version: AGENT_BROWSER_CORE_GUIDE_READ_FROM,
      }),
    ).toBe(
      generatedGuideModule({
        ...coreGuideFrom(installed.coreDir),
        version: installed.version,
      }),
    );
  });

  it("leaves out only sections the installed release has", () => {
    const headings = headingsOf(upstreamCoreGuide(installed.coreDir));
    expect(
      LEFT_OUT_SECTIONS.filter((left) => !headings.includes(left)),
    ).toEqual([]);
  });

  it("names, in the addendum, every refused subcommand and flag the upstream guide still teaches", () => {
    const subcommands = [
      ...AGENT_BROWSER_CORE_GUIDE.matchAll(/agent-browser ([a-z][a-z-]*)/g),
    ].map((match) => match[1] ?? "");
    const flags = [
      ...AGENT_BROWSER_CORE_GUIDE.matchAll(/(--[a-z][a-z-]*)/g),
    ].map((match) => match[1] ?? "");
    const unexplained = [
      ...new Set([
        ...subcommands.filter((name) => BLOCKED_SUBCOMMANDS.has(name)),
        ...flags.filter((flag) => BLOCKED_FLAGS.has(flag)),
      ]),
    ].filter((name) => !INSTRUMENT_ADDENDUM.includes(`\`${name}\``));
    expect(unexplained).toEqual([]);
  });

  it("fits whole in what a delivered skill may carry", () => {
    expect(agentBrowserGuide().length).toBeLessThan(SKILL_CONTENT_LIMIT);
  });

  it("leads with the addendum, and has none of the sections left out", () => {
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

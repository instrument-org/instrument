import { describe, expect, it } from "vitest";

import {
  agentBrowserGuide,
  agentBrowserReferencePaths,
  agentBrowserReferences,
  INSTRUMENT_ADDENDUM,
} from "./agent-browser-guide";
import {
  coreGuideFrom,
  generatedGuideModule,
  headingsOf,
  installedAgentBrowser,
  LEFT_OUT_LIST_ITEMS,
  LEFT_OUT_PARAGRAPHS,
  LEFT_OUT_SECTIONS,
  listItemStartsOf,
  paragraphStartsOf,
  upstreamCoreGuide,
  withoutListItems,
  withoutParagraphs,
  withoutSections,
} from "../../lib/agent-browser-guide-source";
import {
  AGENT_BROWSER_CORE_GUIDE,
  AGENT_BROWSER_CORE_GUIDE_READ_FROM,
  AGENT_BROWSER_CORE_REFERENCES,
} from "./agent-browser-core-guide.generated";
import {
  BLOCKED_FLAGS,
  BLOCKED_SUBCOMMANDS,
} from "../../lib/shell-commands/agent-browser";
import { SKILL_CONTENT_LIMIT } from "../../lib/skills";

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

  it("leaves out only paragraphs the installed release has", () => {
    const starts = paragraphStartsOf(upstreamCoreGuide(installed.coreDir));
    expect(
      LEFT_OUT_PARAGRAPHS.filter(
        (left) => !starts.some((start) => start.startsWith(left)),
      ),
    ).toEqual([]);
  });

  it("leaves out only list items the installed release has", () => {
    const starts = listItemStartsOf(upstreamCoreGuide(installed.coreDir));
    expect(
      LEFT_OUT_LIST_ITEMS.filter(
        (left) => !starts.some((start) => start.startsWith(left)),
      ),
    ).toEqual([]);
  });

  // What is cut is cut whole, so nothing kept points at a part that is gone.
  it("links to no section it left out", () => {
    const anchors = [...AGENT_BROWSER_CORE_GUIDE.matchAll(/\]\(#([a-z-]+)\)/g)]
      .map((match) => match[1] ?? "")
      .filter(
        (anchor) =>
          !headingsOf(AGENT_BROWSER_CORE_GUIDE).some(
            (heading) =>
              heading.replace(/^#+ /, "").toLowerCase().replaceAll(" ", "-") ===
              anchor,
          ),
      );
    expect(anchors).toEqual([]);
  });

  it("teaches no `tab keep`, which is refused", () => {
    expect(AGENT_BROWSER_CORE_GUIDE).not.toContain("tab keep");
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

  it("names each reference it carries in the addendum, by the name --ref takes", () => {
    for (const path of agentBrowserReferencePaths()) {
      const stem = path.slice(path.lastIndexOf("/") + 1, -".md".length);
      expect(INSTRUMENT_ADDENDUM).toContain(`\`--ref ${stem}\``);
    }
  });

  it("prints one reference by its path, file name or name, and several under their paths", () => {
    const [first, second] = AGENT_BROWSER_CORE_REFERENCES;
    if (!first || !second) {
      throw new Error("expected at least two references");
    }
    const fileName = first.path.slice(first.path.lastIndexOf("/") + 1);
    const stem = fileName.slice(0, -".md".length);
    for (const name of [first.path, `./${first.path}`, fileName, stem]) {
      expect(agentBrowserReferences([name])).toEqual({
        text: `${first.text}\n`,
      });
    }
    expect(agentBrowserReferences([stem, second.path, fileName])).toEqual({
      text: `--- ${first.path} ---\n\n${first.text}\n\n--- ${second.path} ---\n\n${second.text}\n`,
    });
  });

  it("names the references there are when asked for one it does not carry", () => {
    expect(agentBrowserReferences(["authentication"])).toEqual({
      error:
        "Reference not found: authentication. Available here: references/instrument.md, references/commands.md, references/snapshot-refs.md, references/trust-boundaries.md",
    });
  });

  it("carries this app's own reference beside the release's, and with --full", () => {
    const own = agentBrowserReferences(["instrument"]);
    expect("text" in own && own.text).toContain('credentials: "include"');
    expect(agentBrowserGuide()).not.toContain("document.images");
    expect(agentBrowserGuide({ full: true })).toContain(
      "<!-- references/instrument.md -->",
    );
  });

  it("drops a list item by how it starts, with its continuation lines, and nothing in a code fence", () => {
    const markdown = [
      "- **Keep** this.",
      "- **Drop me** and",
      "  my second line.",
      "- **Keep** this too.",
      "",
      "```bash",
      "- **Drop me** inside a fence stays",
      "```",
    ].join("\n");
    expect(withoutListItems(markdown, ["- **Drop me**"])).toBe(
      [
        "- **Keep** this.",
        "- **Keep** this too.",
        "",
        "```bash",
        "- **Drop me** inside a fence stays",
        "```",
      ].join("\n"),
    );
  });

  it("drops a whole paragraph by how it starts, and nothing in a code fence", () => {
    const markdown = [
      "Keep this.",
      "",
      "**Drop me** and",
      "my second line.",
      "",
      "```bash",
      "**Drop me** inside a fence stays",
      "```",
      "",
      "Keep this too.",
    ].join("\n");
    expect(withoutParagraphs(markdown, ["**Drop me**"])).toBe(
      [
        "Keep this.",
        "",
        "```bash",
        "**Drop me** inside a fence stays",
        "```",
        "",
        "Keep this too.",
      ].join("\n"),
    );
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

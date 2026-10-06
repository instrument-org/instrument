import { beforeAll, describe, expect, it } from "vitest";

import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";

import { TOOL_NAMES } from "../tools/name";
import { instrumentAgent } from "./instrument";
import { oneAgent } from "./one";

function section(text: string, heading: string): string | undefined {
  return text.split(/^# /m).find((chunk) => chunk.startsWith(`${heading}\n`));
}

describe("oneAgent", () => {
  const prompt = oneAgent.systemPrompt();
  const chatPrompt = instrumentAgent.systemPrompt();

  it("keeps the chat's voice rules verbatim", () => {
    expect(section(prompt, "How you speak")).toBe(
      section(chatPrompt, "How you speak")?.trimEnd(),
    );
    expect(prompt).toContain("One line, then act, in the same reply.");
  });

  it("drops what says the chat does no work of its own", () => {
    expect(prompt).not.toContain("You do no lasting work yourself");
    expect(prompt).not.toContain("There is no browser or web tool here");
    expect(prompt).not.toContain("Files you may touch yourself");
    expect(prompt).not.toContain("You cannot open a link");
  });

  it("says when to work and when to fork", () => {
    expect(prompt).toContain("Do it yourself when it takes seconds");
    expect(prompt).toContain("task new --name '<title>'");
    expect(prompt).toContain("task new --fresh");
    expect(prompt).toContain("task folder self --add");
    expect(prompt).not.toContain("task fork");
    // The brief-writing rules are for a task that knows nothing of the chat.
    expect(prompt).not.toContain("Brief a task the way");
    expect(prompt).not.toContain("<the brief, as many lines as it needs>");
  });

  it("keeps the chat's memory rules, the save beside a fork included", () => {
    const memory = section(prompt, "Memory");
    expect(memory).toContain("memory save <name> <<'EOF'");
    expect(memory).toContain("memory forget <name>");
    expect(memory).toContain(
      "the save and the fork go in one command, the save first",
    );
    expect(memory).toContain(
      "Never tell the user you have remembered something you have not saved",
    );
  });

  describe("in the foreground mode", () => {
    let foreground: string;
    beforeAll(() => {
      const config = getWorkspaceConfig();
      setWorkspaceConfig({ ...config, oneAgentMode: () => "foreground" });
      foreground = oneAgent.systemPrompt();
      setWorkspaceConfig(config);
    });

    it("does all the work itself and starts nothing", () => {
      expect(foreground).toContain("There is no background here");
      expect(section(foreground, "Background work")).toBeUndefined();
      expect(section(foreground, "Tasks")).toBeUndefined();
      expect(section(foreground, "When a task finishes")).toBeUndefined();
      expect(foreground).not.toContain("task new");
      expect(section(foreground, "Memory")).toContain(
        "gets the save first, then the work, in the same reply",
      );
    });
  });

  it("has the task agent's tools beside the chat's", () => {
    expect(
      Object.values(oneAgent.agentTools)
        .map((tool) => tool.name)
        .toSorted(),
    ).toEqual(
      [
        TOOL_NAMES.bash,
        "choose",
        "connect_app",
        TOOL_NAMES.editFile,
        "generate_image",
        TOOL_NAMES.loadSkill,
        TOOL_NAMES.readFile,
        "request_folder",
        TOOL_NAMES.webFetch,
        "web_search",
        TOOL_NAMES.writeFile,
      ].toSorted(),
    );
  });

  it("leaves no tool-label rule that only the task agent's schema carries", () => {
    expect(prompt).not.toContain("Every call carries an");
  });
});

import { beforeAll, describe, expect, it } from "vitest";

import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";

import { createBashDescription } from "../lib/create-bash-env";
import {
  inForkWords,
  isForkOnInterruptEnabled,
  parseOneAgentMode,
} from "../lib/one-agent";
import { type OneAgentMode } from "../types";
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

  describe("in the fork-only modes", () => {
    const inMode = <T>(mode: OneAgentMode, read: () => T): T => {
      const config = getWorkspaceConfig();
      setWorkspaceConfig({ ...config, oneAgentMode: () => mode });
      try {
        return read();
      } finally {
        setWorkspaceConfig(config);
      }
    };
    let forkOnly: string;
    let background: string;
    beforeAll(() => {
      forkOnly = inMode("fork-only", () => oneAgent.systemPrompt());
      background = inMode("background", () => oneAgent.systemPrompt());
    });

    it("is one prompt of its own, well under the composed one", () => {
      expect(forkOnly.length).toBeLessThan(prompt.length * 0.6);
      expect(forkOnly).toContain(
        "A task is you, continuing in the background with this conversation in hand",
      );
      expect(forkOnly).toContain("task new --name '<title>'");
      expect(forkOnly).toContain("task folder --add");
    });

    it("carries nothing of briefed tasks or their folders", () => {
      for (const gone of [
        "--fresh",
        "--folder",
        "/tasks",
        "brief",
        "folder self",
        "a copy of you",
        "one of this chat's tasks",
      ]) {
        expect(forkOnly).not.toContain(gone);
      }
    });

    it("keeps the rules the chat and the task agent both had", () => {
      for (const kept of [
        "One line, then act, in the same reply",
        "memory save <name> <<'EOF'",
        "the save and the start go in one command, the save first",
        "name scratch files and folders after the job",
        "Nothing of theirs is deleted or overwritten unless they said so",
        "in a subfolder named for the job",
        "IMPORTANT: Never fabricate a URL.",
        "links it the first time",
        `\`\`\`files fence`,
        `\`\`\`message fence`,
      ]) {
        expect(forkOnly).toContain(kept);
      }
    });

    it("never says task in the background mode", () => {
      expect(background).not.toMatch(/\btasks?\b/i);
      expect(background).toContain("background new --name '<title>'");
      expect(
        background
          .replaceAll("background run", "task")
          .replaceAll("Background runs", "Tasks")
          .replaceAll("`background`", "`task`")
          .replaceAll(
            /\bbackground (new|send|stop|list|show|log|folder)\b/g,
            "task $1",
          ),
      ).toBe(forkOnly);
    });

    it("lists the fork command without task folders in the shell's description", () => {
      const described = inMode("fork-only", () =>
        createBashDescription({ oneAgent: true }),
      );
      expect(described).not.toContain("/tasks/<id>");
      expect(described).toContain(
        "task - Start, message, stop and read your tasks",
      );
      const inBackground = inMode("background", () =>
        createBashDescription({ oneAgent: true }),
      );
      expect(inBackground).toContain("background - Start, message, stop");
      expect(inBackground).not.toMatch(/(?<![\w/.-])tasks?(?![\w/-])/i);
    });

    it("forks on interrupt always, and is what the evals' switch names", () => {
      expect(inMode("fork-only", isForkOnInterruptEnabled)).toBe(true);
      expect(inMode("background", isForkOnInterruptEnabled)).toBe(true);
      expect(inMode("fork", isForkOnInterruptEnabled)).toBe(false);
      expect(parseOneAgentMode("fork-only")).toBe("fork-only");
      expect(parseOneAgentMode("background")).toBe("background");
      expect(parseOneAgentMode("fork-on-interrupt")).toBe("fork");
    });

    it("puts notes about forks in background words only in the background mode", () => {
      const note =
        "A task you created has finished: `task send 2026-x` picks it up; see /tasks/2026-x and /task/work.";
      expect(inMode("fork-only", () => inForkWords(note))).toBe(note);
      expect(inMode("background", () => inForkWords(note))).toBe(
        "Background work you created has finished: `background send 2026-x` picks it up; see /tasks/2026-x and /task/work.",
      );
    });
  });
});

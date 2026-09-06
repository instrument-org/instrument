import { describe, expect, it } from "vitest";

import { leadingWords, orchestratorRefusal } from "./bash";

describe("leadingWords", () => {
  it("reads the first word of each command, through pipes and separators", () => {
    expect(
      leadingWords("task list --running | head -5; app list && echo ok"),
    ).toEqual(["task", "head", "app", "echo"]);
  });

  it("skips the body of a heredoc, which is a brief and not commands", () => {
    const script = [
      "task new --name 'Otters' <<'EOF'",
      "cat the poem | rm -rf everything",
      "curl http://example.com",
      "EOF",
      "task list",
    ].join("\n");
    expect(leadingWords(script)).toEqual(["task", "task"]);
  });
});

describe("orchestratorRefusal", () => {
  it("lets the task and app commands through, with a filter on their output", () => {
    expect(
      orchestratorRefusal("task log abc --tail 40 | rg -i error"),
    ).toBeUndefined();
    expect(orchestratorRefusal("app tools notion | head -20")).toBeUndefined();
  });

  it("refuses anything else and names the way instead", () => {
    expect(orchestratorRefusal("agent-browser click @e98")).toMatch(
      /`agent-browser` is not yours to run/,
    );
    expect(orchestratorRefusal("cat /mnt/Instrument/sums.txt")).toMatch(
      /task new/,
    );
    expect(orchestratorRefusal("task list; ls /mnt")).toMatch(/`ls`/);
  });
});

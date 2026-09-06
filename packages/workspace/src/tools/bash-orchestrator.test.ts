import { describe, expect, it } from "vitest";

import { leadingWords, orchestratorRefusal } from "./bash";

describe("leadingWords", () => {
  it("reads the first word of each command, and whether it follows a pipe", () => {
    expect(
      leadingWords("task list --running | head -5; app list && echo ok"),
    ).toEqual([
      { piped: false, word: "task" },
      { piped: true, word: "head" },
      { piped: false, word: "app" },
      { piped: false, word: "echo" },
    ]);
  });

  it("skips the body of a heredoc, which is a brief and not commands", () => {
    const script = [
      "task new --name 'Otters' <<'EOF'",
      "cat the poem | rm -rf everything",
      "curl http://example.com",
      "EOF",
      "task list",
    ].join("\n");
    expect(leadingWords(script).map(({ word }) => word)).toEqual([
      "task",
      "task",
    ]);
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
    expect(orchestratorRefusal("curl https://example.com")).toMatch(/task new/);
    expect(orchestratorRefusal("task list; python3 -c 'print(1)'")).toMatch(
      /`python3`/,
    );
  });

  it("lets a file be looked at and put where it belongs", () => {
    expect(orchestratorRefusal("ls /tasks/abc/output")).toBeUndefined();
    expect(
      orchestratorRefusal(
        "cp /tasks/abc/output/report.md /mnt/Instrument/report.md && cat /mnt/Instrument/report.md | head -3",
      ),
    ).toBeUndefined();
    expect(orchestratorRefusal("rm /mnt/Instrument/report.md")).toMatch(/`rm`/);
  });

  it("refuses a filter that is not on a pipe from task or app", () => {
    expect(orchestratorRefusal("jq '.issues[]' issues.json")).toMatch(/`jq`/);
    expect(orchestratorRefusal("awk -F, '{print $1}' saved.txt")).toMatch(
      /`awk`/,
    );
    expect(
      orchestratorRefusal("app call linear list_issues '{}' | jq '.[0]'"),
    ).toBeUndefined();
  });
});

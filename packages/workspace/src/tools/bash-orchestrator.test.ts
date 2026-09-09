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

  it("leaves a pipe inside quotes alone, since it is an argument and not a stage", () => {
    expect(
      leadingWords("task log abc --tail 60 | grep -iE 'call|url|project'"),
    ).toEqual([
      { piped: false, word: "task" },
      { piped: true, word: "grep" },
    ]);
    expect(
      leadingWords(
        `app call notion x '{"query":"a|b","note":"one; two && three"}'`,
      ),
    ).toEqual([{ piped: false, word: "app" }]);
    expect(leadingWords(`cat "a|b.txt" | head -1`)).toEqual([
      { piped: false, word: "cat" },
      { piped: true, word: "head" },
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

  it("lets the conversation read its other channels", () => {
    expect(orchestratorRefusal("chat list")).toBeUndefined();
    expect(
      orchestratorRefusal("chat read Connect --tail 20 | head -5"),
    ).toBeUndefined();
    expect(orchestratorRefusal("chat search gmail")).toBeUndefined();
  });

  it("reads a quoted pipe as an argument, not a command", () => {
    expect(
      orchestratorRefusal(
        "task log abc --tail 60 | grep -iE 'call|url|project'",
      ),
    ).toBeUndefined();
    expect(
      orchestratorRefusal(`app call notion x '{"query":"a|b"}'`),
    ).toBeUndefined();
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

  it("names the pipe a filter is missing, rather than only the rule", () => {
    expect(
      orchestratorRefusal("sed -n '1,5p' /mnt/Instrument/report.md"),
    ).toMatchInlineSnapshot(
      `"\`sed\` reads what a command before it printed, so give it one: \`cat <file> | sed ...\`. Searching a file by its path is \`grep\` or \`rg\`, which take one."`,
    );
  });

  it("searches a file by path, the same read cat already allows", () => {
    expect(
      orchestratorRefusal(
        "grep -n -E 'Bottom line|Cost per' /mnt/Instrument/dairy-protein-comparison.md",
      ),
    ).toBeUndefined();
    expect(
      orchestratorRefusal("rg -i caffeine /mnt/Instrument/notes.md | head -5"),
    ).toBeUndefined();
  });

  it("keeps the filters that can write from their own arguments on a pipe", () => {
    expect(orchestratorRefusal("sed -i 's/a/b/' /mnt/Instrument/x.md")).toMatch(
      /`sed`/,
    );
    expect(
      orchestratorRefusal(`awk 'BEGIN{print "x" > "/mnt/Instrument/x.md"}'`),
    ).toMatch(/`awk`/);
  });
});

describe("orchestratorRefusal: writing a file", () => {
  it.each([
    [
      "cat > '/mnt/Instrument/summary.md' <<'EOF'\nhello\nEOF",
      "cat redirected",
    ],
    ["ls /mnt/Instrument > listing.txt", "ls redirected"],
    ["task list >> /mnt/log.txt", "append"],
    ["find /mnt -name '*.md' &> out.txt", "both streams"],
  ])("refuses %j (%s)", (script) => {
    expect(orchestratorRefusal(script)).toMatch(/Redirecting output/);
  });

  it.each([
    ["task list", "a plain command"],
    ["app tools notion 2>&1 | head -20", "stderr duplicated onto stdout"],
    ["find /mnt -name 'ses_*' 2>/dev/null | head", "stderr thrown away"],
    ["ls /mnt; ls /mnt/mytop 2> /dev/null", "stderr thrown away, spaced"],
    [
      "cat /mnt/Instrument/notes.md | rg '>' | head -3",
      "a quoted angle bracket",
    ],
    [
      "task new --name 'Before > After' <<'EOF'\ncat > /tmp/x <<'INNER'\nINNER\nEOF",
      "a brief that talks about redirects",
    ],
  ])("allows %j (%s)", (script) => {
    expect(orchestratorRefusal(script)).toBeUndefined();
  });
});

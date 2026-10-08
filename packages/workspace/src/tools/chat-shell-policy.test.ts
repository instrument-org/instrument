import { describe, expect, it } from "vitest";

import { chatRefusal } from "./chat-shell-policy";

describe("chatRefusal: reading the script", () => {
  it("leaves a pipe or a separator inside quotes alone, since it is an argument", () => {
    expect(
      chatRefusal(
        `app call notion x '{"query":"a|b","note":"one; two && three"}'`,
      ),
    ).toBeUndefined();
    expect(chatRefusal(`cat "a|b.txt" | head -1`)).toBeUndefined();
  });

  it("skips the body of a heredoc, which is a brief and not commands", () => {
    const script = [
      "task new --name 'Otters' <<'EOF'",
      "cat the poem | rm -rf everything",
      "curl http://example.com > /mnt/Home/x",
      "EOF",
      "task list",
    ].join("\n");
    expect(chatRefusal(script)).toBeUndefined();
  });

  it.each([
    ['cat "$(sed -i s/a/b/ /mnt/Home/x.txt)"', "`sed`"],
    ["ls $(python3 -c 'print(1)')", "`python3`"],
    ["ls `python3 -c 'print(1)'`", "`python3`"],
    ["cat <(python3 -c 1)", "`python3`"],
    ["for f in a b; do python3 $f; done", "`python3`"],
    ["{ task list; python3 -c 1; }", "`python3`"],
    ["if task list; then curl https://example.com; fi", "`curl`"],
    ["$TOOL --version", "`$…`"],
  ])("checks every command the shell would run: %j", (script, named) => {
    expect(chatRefusal(script)).toContain(named);
  });

  it.each([
    ["task list | awk '{print > \"/mnt/Home/z\"}'", "awk print into a file"],
    ["task list | awk '{print | \"sh\"}'", "awk print into a command"],
    ["task list | awk '{system(\"rm x\")}'", "awk system()"],
    ["cat f | sed 'w /mnt/Home/w'", "sed's w command"],
    ["cat f | sed 's/a/b/w /mnt/Home/w'", "the s command's w flag"],
    ["cat f | sed -i 's/a/b/' /mnt/Home/x", "sed -i"],
  ])("refuses a filter writing from its own arguments: %j (%s)", (script) => {
    expect(chatRefusal(script)).toMatch(/Redirecting output/);
  });

  it.each([
    ["task list | awk '$1 > 5 {print $2}'", "an awk comparison"],
    ["cat f | sed -n '/word/p'", "a sed address that starts with w"],
    ["task list | sed -E 's/x/y/g'", "a plain substitution"],
  ])("allows a filter that only reads: %j (%s)", (script) => {
    expect(chatRefusal(script)).toBeUndefined();
  });
});

describe("chatRefusal", () => {
  it("lets the task and app commands through, with a filter on their output", () => {
    expect(chatRefusal("task log abc --tail 40 | rg -i error")).toBeUndefined();
    expect(chatRefusal("app tools notion | head -20")).toBeUndefined();
  });

  it("lets the conversation move into a folder to look around it", () => {
    expect(chatRefusal("cd /mnt/Personal; pwd; ls | head -30")).toBeUndefined();
  });

  it("lets the conversation read its other chats", () => {
    expect(chatRefusal("chat list --topic work")).toBeUndefined();
    expect(
      chatRefusal("chat read Connect --tail 20 | head -5"),
    ).toBeUndefined();
    expect(chatRefusal("chat search gmail")).toBeUndefined();
  });

  it("reads a quoted pipe as an argument, not a command", () => {
    expect(
      chatRefusal("task log abc --tail 60 | grep -iE 'call|url|project'"),
    ).toBeUndefined();
    expect(chatRefusal(`app call notion x '{"query":"a|b"}'`)).toBeUndefined();
  });

  // A slow read outlives yieldMs and goes to the background like any other
  // command, and the notice that says so names these to follow and stop it.
  it("lets the conversation follow and stop what it sent to the background", () => {
    expect(chatRefusal("fg bg_2 --timeout 0")).toBeUndefined();
    expect(chatRefusal("kill bg_2; jobs")).toBeUndefined();
  });

  it("refuses anything else and names the way instead", () => {
    expect(chatRefusal("agent-browser click @e98")).toMatch(
      /`agent-browser` is not yours to run/,
    );
    expect(chatRefusal("curl https://example.com")).toMatch(/task new/);
    expect(chatRefusal("task list; python3 -c 'print(1)'")).toMatch(
      /`python3`/,
    );
  });

  it("lets a file be looked at and put where it belongs", () => {
    expect(chatRefusal("ls /tasks/abc/output")).toBeUndefined();
    expect(
      chatRefusal(
        "cp /tasks/abc/output/report.md /mnt/Instrument/report.md && cat /mnt/Instrument/report.md | head -3",
      ),
    ).toBeUndefined();
    expect(chatRefusal("rm /mnt/Instrument/report.md")).toMatch(/`rm`/);
  });

  it("refuses a filter that is not on a pipe from task or app", () => {
    expect(chatRefusal("jq '.issues[]' issues.json")).toMatch(/`jq`/);
    expect(chatRefusal("awk -F, '{print $1}' saved.txt")).toMatch(/`awk`/);
    expect(
      chatRefusal("app call linear list_issues '{}' | jq '.[0]'"),
    ).toBeUndefined();
  });

  it("names the pipe a filter is missing, rather than only the rule", () => {
    expect(
      chatRefusal("sed -n '1,5p' /mnt/Instrument/report.md"),
    ).toMatchInlineSnapshot(
      `"\`sed\` reads what a command before it printed, so give it one: \`cat <file> | sed ...\`. Searching a file by its path is \`grep\` or \`rg\`, which take one."`,
    );
  });

  it("searches a file by path, the same read cat already allows", () => {
    expect(
      chatRefusal(
        "grep -n -E 'Bottom line|Cost per' /mnt/Instrument/dairy-protein-comparison.md",
      ),
    ).toBeUndefined();
    expect(
      chatRefusal("rg -i caffeine /mnt/Instrument/notes.md | head -5"),
    ).toBeUndefined();
  });

  it("keeps the filters that can write from their own arguments on a pipe", () => {
    expect(chatRefusal("sed -i 's/a/b/' /mnt/Instrument/x.md")).toMatch(
      /`sed`/,
    );
    expect(
      chatRefusal(`awk 'BEGIN{print "x" > "/mnt/Instrument/x.md"}'`),
    ).toMatch(/`awk`/);
  });
});

describe("chatRefusal: writing a file", () => {
  it.each([
    [
      "cat > '/mnt/Instrument/summary.md' <<'EOF'\nhello\nEOF",
      "cat redirected",
    ],
    ["ls /mnt/Instrument > listing.txt", "ls redirected"],
    ["task list >> /mnt/log.txt", "append"],
    ["find /mnt -name '*.md' &> out.txt", "both streams"],
    ["ls /mnt 2>/dev/nullx; ls", "a file named past /dev/null"],
    ["ls /mnt 2>/dev/null>out.txt", "a second target after /dev/null"],
    ["ls /mnt 2>/dev/null; ls > out.txt", "a later redirect on the line"],
  ])("refuses %j (%s)", (script) => {
    expect(chatRefusal(script)).toMatch(/Redirecting output/);
  });

  it.each([
    ["task list", "a plain command"],
    ["app tools notion 2>&1 | head -20", "stderr duplicated onto stdout"],
    ["find /mnt -name 'ses_*' 2>/dev/null | head", "stderr thrown away"],
    ["ls /mnt; ls /mnt/mytop 2> /dev/null", "stderr thrown away, spaced"],
    [
      "chat read ses_01M2 --tail 8 2>/dev/null; chat threads",
      "stderr thrown away before a semicolon",
    ],
    ["ls /mnt/a 2>/dev/null&& du -sh /mnt/a", "before an and-list"],
    ["ls /mnt/a 2>/dev/null|head", "before a pipe"],
    [
      "cat /mnt/Instrument/notes.md | rg '>' | head -3",
      "a quoted angle bracket",
    ],
    [
      "task new --name 'Before > After' <<'EOF'\ncat > /tmp/x <<'INNER'\nINNER\nEOF",
      "a brief that talks about redirects",
    ],
  ])("allows %j (%s)", (script) => {
    expect(chatRefusal(script)).toBeUndefined();
  });
});

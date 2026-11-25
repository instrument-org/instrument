// node --test scripts/checkout-guard.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { gitCommands, refusal } from "./checkout-guard.ts";

const refused = (command: string) =>
  gitCommands(command, "/repo").some(
    ({ args, env }) => refusal(args, env) !== undefined,
  );

void test("refuses what discards or takes in other sessions' edits", () => {
  for (const command of [
    "git stash",
    "git stash pop",
    "git restore src/a.ts",
    "git restore --staged --worktree src/a.ts",
    "git checkout -- src/a.ts",
    "git checkout main",
    "git switch -c mine",
    "git reset --hard HEAD",
    "git clean -fd",
    "git add -A",
    "git add .",
    "git commit --amend --no-edit",
    "git commit -am 'x'",
    "pnpm fix && git -c core.quotepath=off checkout -- a.ts",
    "cd sub; git stash",
  ]) {
    assert.equal(refused(command), true, command);
  }
});

void test("lets through what touches only the index, history or a private index", () => {
  for (const command of [
    "git status",
    "git stash list",
    "git restore --staged src/a.ts",
    "git reset -q -- src/a.ts",
    "git add src/a.ts",
    "GIT_INDEX_FILE=/tmp/i git add -A",
    "git commit -F msg -- src/a.ts",
    "git log --oneline | head",
    "echo 'git stash'",
    "rg -n 'git checkout' docs",
  ]) {
    assert.equal(refused(command), false, command);
  }
});

void test("follows cd and -C to the folder a git command runs in", () => {
  assert.deepEqual(
    gitCommands(
      "cd /elsewhere && git stash; git -C ../wt checkout x",
      "/repo",
    ).map(({ dir }) => dir),
    ["/elsewhere", "/wt"],
  );
});

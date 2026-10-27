import { describe, expect, it } from "vitest";

import { ampersandUse } from "./background-ampersand";

describe("ampersandUse", () => {
  it.each([
    ["pnpm dev", "none"],
    ["echo a && echo b", "none"],
    ["ls &> out.txt", "none"],
    ["echo 'a & b'", "none"],
    ["pnpm dev &", "trailing"],
    ["cd app && pnpm dev &", "trailing"],
    ["pnpm build; pnpm start &", "trailing"],
    ["nohup python server.py > log 2>&1 &", "trailing"],
    ["pnpm dev & echo $!", "refused"],
    ["pnpm dev & wait", "refused"],
    ["a & b &", "refused"],
    ["(sleep 5 &)", "refused"],
    ["for f in *.mp4; do ffmpeg -i $f $f.mp3 & done", "refused"],
    ["echo $(sleep 1 &)", "refused"],
    ["if true; then", "none"],
    ["bash -c 'echo a && echo b'", "none"],
    ["bash -c 'echo \"a & b\"'", "none"],
    ["bash -c 'pnpm dev' &", "trailing"],
    ["/bin/bash -c 'sleep 5 & echo after'", "none"],
    ["bash -c 'sleep 5 & echo after'", "refused"],
    ["sh -c 'pnpm dev &'", "refused"],
    ["bash -c 'pnpm dev &' &", "refused"],
    ['bash -c "sleep $N & echo after"', "refused"],
    ["bash -c \"bash -c 'sleep 5 &'\"", "refused"],
    ["eval 'sleep 5 &'", "refused"],
    [
      `bash -c 'sh -c "sleep 900" & python3 spawn_tree.py & while true; do date >> bg.log; sleep 5; done'`,
      "refused",
    ],
  ])("%s is %s", (command, use) => {
    expect(ampersandUse(command)).toBe(use);
  });
});

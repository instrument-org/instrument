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
  ])("%s is %s", (command, use) => {
    expect(ampersandUse(command)).toBe(use);
  });
});

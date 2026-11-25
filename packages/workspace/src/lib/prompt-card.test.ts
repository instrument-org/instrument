import { describe, expect, it } from "vitest";

import { promptFenceOf, promptSentAt, promptsSentOf } from "./prompt-card";

const fence = (front: string, body: string) =>
  `\`\`\`message\n---\n${front}\n---\n${body}\n\`\`\``;

const REPLY = [
  "Here's the email and two prompts.",
  fence("message: email\nto: Dana\nsubject: Hi", "Hi Dana"),
  fence("message: prompt", "Find the prices"),
  fence("message: prompt\nto: Claude Code", "Add a table"),
  fence("message: prompt", "Rewrite the FAQ"),
].join("\n\n");

describe("promptFenceOf", () => {
  it.each([
    ["the first prompt, counting the email before it", "Find the prices", 1],
    ["a later prompt", "Rewrite the FAQ", 3],
    ["a prompt for another app's agent", "Add a table", undefined],
    ["an email", "Hi Dana", undefined],
    ["words the reply does not have", "Something else", undefined],
  ])("finds %s", (_name, body, index) => {
    expect(promptFenceOf(REPLY, body)).toBe(index);
  });
});

describe("promptsSentOf", () => {
  const chat = "2026-11-25-prices-ab12";
  const at = "2026-11-25T11:31:00.000Z";

  it("reads each card's Send and passes over what is not one", () => {
    const metadata = {
      promptsSent: [{ at, chat, fence: 1 }],
    };
    expect(promptSentAt(metadata, 1)).toEqual({ at, chat, fence: 1 });
    expect(promptSentAt(metadata, 3)).toBeUndefined();
    expect(promptsSentOf({})).toEqual([]);
    expect(promptsSentOf({ promptsSent: "garbled" })).toEqual([]);
  });
});

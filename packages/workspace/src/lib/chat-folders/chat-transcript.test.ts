import { expect, it } from "vitest";

import { isChatTranscript } from "./chat-transcript";

const HEAD = `---
title: Kyoto
---

[Open this chat in Instrument](instrument://chat/2026-09-16-kyoto)
`;

it.each([
  ["/Users/sam/Workspace/Chats/Kyoto/CHAT.md", HEAD, true],
  ["C:\\Users\\sam\\Workspace\\Chats\\Kyoto\\CHAT.md", HEAD, true],
  ["/Users/sam/Workspace/Chats/Kyoto/CHAT.md", "# My own notes\n", false],
  ["/Users/sam/Workspace/Notes/Kyoto/CHAT.md", HEAD, false],
  ["/Users/sam/Workspace/Chats/CHAT.md", HEAD, false],
  ["/Users/sam/Workspace/Chats/Kyoto/notes.md", HEAD, false],
])("%s", (hostPath, text, expected) => {
  expect(isChatTranscript(hostPath, text)).toBe(expected);
});

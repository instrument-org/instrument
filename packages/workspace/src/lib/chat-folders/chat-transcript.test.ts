import { expect, it } from "vitest";

import { chatLinkedInText, isChatTranscript } from "./chat-transcript";

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

it("reads the chat from the front matter's key before the link", () => {
  expect(
    chatLinkedInText(
      "---\ntitle: Kyoto\nchat: 2026-09-16-kyoto\n---\n\n[Open](instrument://chat/2026-09-16-other)\n",
    ),
  ).toBe("2026-09-16-kyoto");
});

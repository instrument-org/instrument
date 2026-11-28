import { expect, it } from "vitest";

import { chatLinkedInText } from "./chat-transcript";

it.each(["instrument://chat/2026-09-16-kyoto", "2026-09-16-kyoto"])(
  "reads the chat from the front matter's key before the link: %s",
  (named) => {
    expect(
      chatLinkedInText(
        `---\ntitle: Kyoto\nchat: ${named}\n---\n\n[Open](instrument://chat/2026-09-16-other)\n`,
      ),
    ).toBe("2026-09-16-kyoto");
  },
);

it("reads the chat from the link in a transcript written before the key", () => {
  expect(
    chatLinkedInText(
      "---\ntitle: Kyoto\n---\n\n[Open this chat in Instrument](instrument://chat/2026-09-16-kyoto)\n",
    ),
  ).toBe("2026-09-16-kyoto");
});

it("reads nothing from a person's own notes", () => {
  expect(chatLinkedInText("# My own notes\n")).toBeUndefined();
});

it.each([
  "# Notes\n\nchat: 2026-09-16-kyoto\n",
  "# Notes\n\n[Kyoto](instrument://chat/2026-09-16-kyoto)\n",
  "---\ntitle: Notes\n---\n\nSome text\n\n[Kyoto](instrument://chat/2026-09-16-kyoto)\n",
])(
  "reads nothing from a chat named outside the front matter and the line under it: %j",
  (text) => {
    expect(chatLinkedInText(text)).toBeUndefined();
  },
);

import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import {
  type SessionMessagePart,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { afterEach, expect, test, vi } from "vitest";

import { AgentFilesBlock } from "./agent-files-block";
import { AssistantMessage } from "./assistant-message";
import { MarkdownTaskContext } from "./markdown-task-context";

vi.mock("@/client/hooks/use-host-paths", () => ({
  useHostPaths: (_taskId: unknown, filePaths: readonly string[]) =>
    Object.fromEntries(
      filePaths.map((filePath) => [filePath, `/Users/casey/${filePath}`]),
    ),
}));
vi.mock(import("@/client/lib/computer-file-url"), async (importOriginal) => ({
  ...(await importOriginal()),
  getComputerFileUrl: ({ hostPath }: { hostPath: string }) =>
    `http://files.example.test${hostPath}`,
}));

const taskId = TaskIdSchema.parse("dishwasher");

const EMAIL = [
  "Here's a note for Marcy.",
  "",
  "```message",
  "---",
  "message: email",
  "to: Marcy <marcy@example.com>",
  "subject: Dishwasher still broken",
  "---",
  "Hi Marcy,",
  "",
  "The dishwasher has been out for two weeks now. Could someone come by this week?",
  "",
  "Thanks,",
  "Casey",
  "```",
].join("\n");

function textPart(text: string): SessionMessagePart.TextPart {
  return {
    metadata: {
      createdAt: new Date(0),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    state: "done",
    text,
    type: "text",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a reply's message fence stands under the bubble as a card", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 560 }}>
      <AssistantMessage bubble part={textPart(EMAIL)} taskId={taskId} />
    </div>,
  );

  await expect
    .element(screen.getByText("Dishwasher still broken"))
    .toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- paragraph: Here's a note for Marcy.
    - text: Email to Marcy <marcy@example.com>
    - button "Copy recipient"
    - paragraph: Dishwasher still broken
    - button "Copy subject"
    - paragraph: Hi Marcy, The dishwasher has been out for two weeks now. Could someone come by this week? Thanks, Casey
    - button "Copy body"
    - button "Copy"
    - button "Send""
  `);
});

test("a message file named in a files fence draws as the card", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          "---\nmessage: text\nto: Sam\n---\nRunning 15 late, order for me.\n",
        ),
      ),
    ),
  );
  const screen = await renderInBrowser(
    <div style={{ width: 560 }}>
      <MarkdownTaskContext value={{ isStreaming: false, taskId }}>
        <AgentFilesBlock content={"work/text-to-sam.md\n"} />
      </MarkdownTaskContext>
    </div>,
  );

  await expect
    .element(screen.getByText("Running 15 late, order for me."))
    .toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- text: Text to Sam
    - button "Copy recipient"
    - button "text-to-sam.md"
    - paragraph: Running 15 late, order for me.
    - button "Copy body"
    - button "Copy"
    - button "Share""
  `);
});

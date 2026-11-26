import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import {
  type SessionMessagePart,
  StoreId,
  ChatIdSchema,
} from "@instrument-org/workspace/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { AgentFilesBlock } from "./agent-files-block";
import { AssistantMessage } from "./assistant-message";
import { MarkdownChatContext } from "./markdown-chat-context";
import { type EditSource } from "./reply-blocks/message-edits";
import { MessageEditSourcesContext } from "./transcript/message-edit-sources";

vi.mock("@/client/hooks/use-host-paths", () => ({
  useHostPaths: (_chatId: unknown, filePaths: readonly string[]) =>
    Object.fromEntries(
      filePaths.map((filePath) => [filePath, `/Users/casey/${filePath}`]),
    ),
}));
vi.mock(import("@/client/lib/computer-file-url"), async (importOriginal) => ({
  ...(await importOriginal()),
  getComputerFileUrl: ({ hostPath }: { hostPath: string }) =>
    `http://files.example.test${hostPath}`,
}));

const chatId = ChatIdSchema.parse("dishwasher");

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
  vi.restoreAllMocks();
});

test("a reply's message fence stands in its words as a card", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 560 }}>
      <AssistantMessage part={textPart(EMAIL)} chatId={chatId} />
    </div>,
  );

  await expect
    .element(screen.getByText("Dishwasher still broken"))
    .toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- paragraph: Here's a note for Marcy.
    - text: Email to Marcy <
    - button "marcy@example.com"
    - text: ">"
    - paragraph: Subject Dishwasher still broken
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
      <MarkdownChatContext value={{ isStreaming: false, chatId }}>
        <AgentFilesBlock content={"work/text-to-sam.md\n"} />
      </MarkdownChatContext>
    </div>,
  );

  await expect
    .element(screen.getByText("Running 15 late, order for me."))
    .toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- text: Text to Sam
    - button "text-to-sam.md"
    - paragraph: Running 15 late, order for me.
    - button "Copy body"
    - button "Copy"
    - button "Share""
  `);
});

test("a message the agent sends itself keeps Copy and drops Share", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 560 }}>
      <AssistantMessage
        chatId={chatId}
        part={textPart(
          [
            "```message",
            "---",
            "message: chat",
            "to: Amazon Customer Service",
            "sender: agent",
            "---",
            "I'd like to return the motion sickness tablets I bought by mistake.",
            "```",
          ].join("\n"),
        )}
      />
    </div>,
  );

  await expect
    .element(screen.getByText("Amazon Customer Service"))
    .toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- text: Message to Amazon Customer Service
    - paragraph: I'd like to return the motion sickness tablets I bought by mistake.
    - button "Copy body"
    - button "Copy""
  `);
});

const PROMPT = [
  "What their AI costs.",
  "",
  "```message",
  "---",
  "message: prompt",
  "---",
  "Find what Zendesk, Intercom and Freshdesk charge for each conversation their AI resolves.",
  "```",
].join("\n");

test("a prompt for a new chat has Copy and Send", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 560 }}>
      <AssistantMessage part={textPart(PROMPT)} chatId={chatId} />
    </div>,
  );

  await expect.element(screen.getByText("a new chat")).toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- paragraph: What their AI costs.
    - text: Prompt for a new chat
    - paragraph: Find what Zendesk, Intercom and Freshdesk charge for each conversation their AI resolves.
    - button "Copy body"
    - button "Copy"
    - button "Send""
  `);
});

test("a prompt already sent says when, and opens its chat", async () => {
  const part = textPart(PROMPT);
  const screen = await renderInBrowser(
    <div style={{ width: 560 }}>
      <AssistantMessage
        chatId={chatId}
        part={{
          ...part,
          metadata: {
            ...part.metadata,
            promptsSent: [
              {
                at: "2024-03-05T11:31:00.000Z",
                chat: "2024-03-05-prices",
                fence: 0,
              },
            ],
          },
        }}
      />
    </div>,
  );

  await expect.element(screen.getByText("Sent Mar 5, 2024")).toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- paragraph: What their AI costs.
    - text: Prompt for a new chat
    - paragraph: Find what Zendesk, Intercom and Freshdesk charge for each conversation their AI resolves.
    - button "Copy body"
    - text: Sent Mar 5, 2024
    - button "Copy"
    - button "Open chat""
  `);
});

test("a prompt for another app's agent only copies", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 560 }}>
      <AssistantMessage
        chatId={chatId}
        part={textPart(
          [
            "```message",
            "---",
            "message: prompt",
            "to: Claude Code",
            "---",
            "Add a comparison table under the plan cards.",
            "```",
          ].join("\n"),
        )}
      />
    </div>,
  );

  await expect.element(screen.getByText("Claude Code")).toBeVisible();
  await expect(ariaSnapshot(screen.locator)).resolves.toMatchInlineSnapshot(`
    "- text: Prompt for Claude Code
    - paragraph: Add a comparison table under the plan cards.
    - button "Copy body"
    - button "Copy""
  `);
});

describe("a message that is a new version of earlier text", () => {
  const WORDY =
    "I am writing to you today in order to express my very strong interest in the Marketing Coordinator position that I saw posted on your website. I truly believe that I would be a really great fit for this role because of the fact that I have basically spent the last four years working in marketing at a small nonprofit organization.";
  const TIGHT =
    "I am writing to express my strong interest in the Marketing Coordinator position posted on your website. I would be a great fit for this role because I have spent the last four years working in marketing at a small nonprofit organization.";
  const LANDLORD =
    "Hi, this is Marcus from Alder Street Properties. We need to do the annual smoke detector inspection in your unit. Would Thursday between 10 and 2 work for you? If not, let me know a day that does. Thanks, Marcus";

  const reply = (body: string) =>
    textPart(
      ["Here it is.", "", "```message", "message: other", "", body, "```"].join(
        "\n",
      ),
    );

  const renderReply = (body: string, sources: readonly EditSource[]) =>
    renderInBrowser(
      <div style={{ width: 560 }}>
        <MessageEditSourcesContext value={sources}>
          <AssistantMessage chatId={chatId} part={reply(body)} />
        </MessageEditSourcesContext>
      </div>,
    );

  const pasted: EditSource = {
    from: "person",
    text: `Can you tighten this paragraph?\n\n${WORDY}`,
  };

  test("switches between the original and the revision, tinting new words while pointed at", async () => {
    const screen = await renderReply(
      "I am writing to express my strong interest in the Marketing Coordinator role on your website. I would be a great fit for this role because I have spent four years working in marketing at a small nonprofit organization.",
      [pasted],
    );

    await expect
      .element(screen.getByRole("tab", { name: "Revised" }))
      .toHaveAttribute("aria-selected", "true");
    const edits = screen.container.querySelectorAll(".message-edit");
    expect([...edits].map((edit) => edit.textContent)).toMatchInlineSnapshot(`
      [
        "role",
      ]
    `);
    const tint = () => getComputedStyle(edits[0] as Element).backgroundColor;
    expect(tint()).toBe("rgba(0, 0, 0, 0)");

    await userEvent.hover(screen.getByText("Here it is."));
    await userEvent.hover(edits[0] as HTMLElement);
    expect(tint()).not.toBe("rgba(0, 0, 0, 0)");
    await expect
      .element(screen.getByRole("tooltip"))
      .toMatchTextContent(/^Was\s*position that I saw posted$/);

    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    await userEvent.click(screen.getByRole("tab", { name: "Original" }));
    await expect.element(screen.getByText(WORDY)).toBeVisible();
    expect(screen.container.querySelector(".message-edit")).toBeNull();
    await expect
      .element(screen.getByRole("button", { name: /^(Send|Share)$/ }))
      .not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy original" }),
    );
    expect(writeText).toHaveBeenCalledWith(WORDY);
  });

  test("takes the agent's last draft on a second pass", async () => {
    const second =
      "I would love to join you as Marketing Coordinator. I have spent the last four years working in marketing at a small nonprofit organization.";
    const screen = await renderReply(second, [
      { from: "person", text: "Shorter please, and warmer." },
      { from: "draft", text: TIGHT },
      pasted,
    ]);

    await userEvent.click(screen.getByRole("tab", { name: "Original" }));
    await expect.element(screen.getByText(TIGHT)).toBeVisible();
  });

  test("is drawn as any message when it replies to a pasted email", async () => {
    const screen = await renderReply(
      "Hi Marcus, Thursday works for me, but I'm only home after noon. Could the inspection be between 12 and 2? Thanks, Sam",
      [
        {
          from: "person",
          text: `My landlord sent this. Can you write a reply saying Thursday works but I'll be home only after noon?\n\n${LANDLORD}`,
        },
      ],
    );

    await expect.element(screen.getByText(/^Hi Marcus/)).toBeVisible();
    await expect
      .element(screen.getByRole("tab", { name: "Original" }))
      .not.toBeInTheDocument();
  });

  test("keeps the original but marks no words in a rewrite", async () => {
    const screen = await renderReply(
      "Your Marketing Coordinator opening caught my eye. For the last four years working in marketing at a small nonprofit organization, I ran every social account and doubled what we raised each spring, which is the work I want to keep doing.",
      [pasted],
    );

    await expect
      .element(screen.getByRole("tab", { name: "Original" }))
      .toBeVisible();
    expect(screen.container.querySelector(".message-edit")).toBeNull();
  });
});

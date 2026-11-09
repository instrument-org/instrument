import { describe, expect, it } from "vitest";

import { takeRoleRefusals } from "../lib/capabilities/role-refusals";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { runTool } from "../test/helpers/run-tool";
import { TOOLS } from "./all";

const input = {
  questions: [
    {
      choices: [{ label: "React" }, { label: "Vue" }],
      header: "Framework",
      question: "Which framework?",
    },
  ],
};

function modelText(
  output: ReturnType<typeof TOOLS.Choose.toModelOutput>,
): string | undefined {
  return output.type === "text" ? output.value : undefined;
}

describe("choose", () => {
  // A session that is not the chat's own is a task's.
  it("refuses a task with what it is, and keeps that it did", async () => {
    const sessionId = StoreId.newSessionId();
    const result = await runTool(TOOLS.Choose, {
      chatId: ChatIdSchema.parse("2026-11-08-not-a-chat"),
      input: { ...input, activity: "Asking", explanation: "Asking" },
      model: createMockAIGatewayModel(),
      sessionId,
      signal: AbortSignal.timeout(10_000),
    });
    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"You are a task the chat started, running in the background, where nobody sees a card: the chat asks the user its questions itself. Do your assignment, and end your last message with a needs fence naming what you need from the user, if anything."`,
    );
    expect(takeRoleRefusals(sessionId)).toEqual(["choose"]);
  });

  it("tells the model the card is up and its answers come later", () => {
    expect(
      modelText(
        TOOLS.Choose.toModelOutput({
          input,
          output: { asked: true },
          toolCallId: "test",
        }),
      ),
    ).toMatchInlineSnapshot(
      `"The user now sees your questions and their choices on a card in the chat, and answers there. Their answers reach you together as a message of their own."`,
    );
  });

  // Transcripts from when the turn waited on the card hold the answer as the
  // call's output.
  it("reads an answer a waiting turn returned", () => {
    const outputs = [
      { selectedChoice: "Vue" },
      { selectedChoice: "Plain HTML" },
      { note: "The team knows it.", selectedChoice: "React" },
      { declined: true as const, note: "Ask design." },
    ];
    expect(
      outputs.map((output) =>
        modelText(
          TOOLS.Choose.toModelOutput({ input, output, toolCallId: "test" }),
        ),
      ),
    ).toMatchInlineSnapshot(`
      [
        "The user answered your question "Which framework?": Vue",
        "The user answered your question "Which framework?": Plain HTML (in their own words)",
        "The user answered your question "Which framework?": React
      Their note: The team knows it.",
        "The user skipped your question "Which framework?". Decide without the answer: take the likelier reading and say which, or say what you cannot do without it.
      Their note: Ask design.",
      ]
    `);
  });

  it("asks one to four questions, each with two choices or more", () => {
    const question = input.questions[0];
    expect(
      [
        { questions: [] },
        { questions: [question, question, question, question] },
        { questions: [question, question, question, question, question] },
        { questions: [{ ...question, choices: [{ label: "React" }] }] },
      ].map((each) => TOOLS.Choose.inputSchema.safeParse(each).success),
    ).toEqual([false, true, false, false]);
  });
});

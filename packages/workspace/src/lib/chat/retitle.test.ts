import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type askDecisionModel } from "../decision-model";
import { titleStillFits } from "./retitle";

function answering(moved: number | undefined) {
  const answers: Record<string, { noul: number; type: "noul" }> =
    moved === undefined ? {} : { moved: { noul: moved, type: "noul" } };
  return vi.fn<typeof askDecisionModel>(() =>
    Promise.resolve({
      ms: 200,
      provider: "openrouter",
      response: { answers, model: "typesafe/jev-1.13" },
    }),
  );
}

// Only the type matters to which providers can reach the decision model.
const reachable = [
  { type: "openrouter" },
] as unknown as AIGatewayProviderConfig.Type[];

const chat = {
  configs: reachable,
  currentTitle: "Find flights to Lisbon",
  opening: "find me cheap flights to lisbon",
  reply: "I found three options under $600.",
  chatId: ChatIdSchema.parse("2026-10-10-find-flights"),
};

describe("titleStillFits", () => {
  it.each([
    { expected: true, moved: 0.07 },
    { expected: true, moved: 0.29 },
    { expected: false, moved: 0.3 },
    { expected: false, moved: 0.74 },
    { expected: false, moved: undefined },
  ])(
    "keeps the title at P(moved)=$moved: $expected",
    async ({ expected, moved }) => {
      await expect(
        titleStillFits({ ...chat, ask: answering(moved) }),
      ).resolves.toBe(expected);
    },
  );

  it("leaves the title model to decide when no provider can reach the decision model", async () => {
    const ask = answering(0.1);
    await expect(titleStillFits({ ...chat, ask, configs: [] })).resolves.toBe(
      false,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    {
      ask: () => Promise.reject(new Error("upstream 529")),
      case: "fails",
    },
    { ask: () => Promise.resolve(undefined), case: "is resting after failing" },
  ])("keeps the title when the decision model $case", async ({ ask }) => {
    await expect(
      titleStillFits({ ...chat, ask: vi.fn<typeof askDecisionModel>(ask) }),
    ).resolves.toBe(true);
  });

  it("asks one yes-or-no about the title against the opening and the reply", async () => {
    const ask = answering(0.1);
    await titleStillFits({ ...chat, ask });
    expect(ask.mock.calls[0]?.[0].body.state).toMatchInlineSnapshot(`
      {
        "current_title": "Find flights to Lisbon",
        "latest_reply": "I found three options under $600.",
        "opening_message": "find me cheap flights to lisbon",
      }
    `);
  });
});

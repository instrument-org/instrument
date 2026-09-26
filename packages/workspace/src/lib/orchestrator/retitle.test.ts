import { describe, expect, it, vi } from "vitest";

import { type askDecisionModel } from "../system-one";
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

const thread = {
  configs: [],
  currentTitle: "Find flights to Lisbon",
  opening: "find me cheap flights to lisbon",
  reply: "I found three options under $600.",
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
        titleStillFits({ ...thread, ask: answering(moved) }),
      ).resolves.toBe(expected);
    },
  );

  it("leaves the title model to decide when no provider can reach the decision model", async () => {
    const ask = vi.fn<typeof askDecisionModel>(() =>
      Promise.resolve(undefined),
    );
    await expect(titleStillFits({ ...thread, ask })).resolves.toBe(false);
  });

  it("leaves the title model to decide when the decision model fails", async () => {
    const ask = vi.fn<typeof askDecisionModel>(() =>
      Promise.reject(new Error("upstream 529")),
    );
    await expect(titleStillFits({ ...thread, ask })).resolves.toBe(false);
  });

  it("asks one yes-or-no about the title against the opening and the reply", async () => {
    const ask = answering(0.1);
    await titleStillFits({ ...thread, ask });
    expect(ask.mock.calls[0]?.[0].body.state).toMatchInlineSnapshot(`
      {
        "current_title": "Find flights to Lisbon",
        "latest_reply": "I found three options under $600.",
        "opening_message": "find me cheap flights to lisbon",
      }
    `);
  });
});

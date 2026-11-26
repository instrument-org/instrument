import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatReads } from "../lib/chat-reads";

import {
  FEEDBACK_OFFER_GAP_MS,
  feedbackOfferRefusal,
  recordFeedbackOffer,
} from "../lib/feedback-offers";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { ChatIdSchema } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { runTool } from "../test/helpers/run-tool";
import { OfferFeedback, offeredIn } from "./offer-feedback";

const role = vi.hoisted(() => ({ current: "chat" as "chat" | "task" }));
vi.mock(import("../lib/chat/children"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionRole: () => role.current,
}));

const model = createMockAIGatewayModel();
const CHAT = ChatIdSchema.parse("2026-10-27-pricing");
const NOW = new Date("2026-10-27T15:00:00Z");

beforeEach(async () => {
  role.current = "chat";
  setWorkspaceConfig({ ...getWorkspaceConfig(), mayOfferFeedback: undefined });
  // The last offer is kept for the workspace on this computer, across tests.
  await recordFeedbackOffer(new Date(0));
});

async function offer(attach?: { windowPicture: boolean }) {
  const result = await runTool(OfferFeedback, {
    chatId: CHAT,
    input: {
      ...attach,
      activity: "Writing up a problem",
      explanation: "The browser tab crashed",
      title: "Zendesk's page crashed the browser tab three times in a row",
      reason:
        "Other sites loaded fine, so this looks like a bug in Instrument.",
      writeup: "The tab crashed each of three times.",
    },
    model,
    signal: AbortSignal.timeout(10_000),
  });
  return result._unsafeUnwrap();
}

describe("offer_feedback", () => {
  it("shows a card, then none for days after, across every chat", async () => {
    expect(await offer()).toEqual({ offered: true });
    expect(await offer()).toEqual({ offered: false, reason: "recent" });
  });

  it("shows nothing from a task, which nobody watches", async () => {
    role.current = "task";
    expect(await offer()).toEqual({ offered: false, reason: "background" });
  });

  it("shows nothing once the person turned offers off", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      mayOfferFeedback: () => false,
    });
    expect(await offer()).toEqual({ offered: false, reason: "off" });
  });

  it.each([
    { ago: 0, mayOffer: true, refusal: "recent" },
    { ago: FEEDBACK_OFFER_GAP_MS - 1, mayOffer: true, refusal: "recent" },
    { ago: FEEDBACK_OFFER_GAP_MS, mayOffer: true, refusal: undefined },
    { ago: undefined, mayOffer: true, refusal: undefined },
    { ago: undefined, mayOffer: false, refusal: "off" },
  ])(
    "refuses an offer $ago ms after the last with offers allowed $mayOffer: $refusal",
    ({ ago, mayOffer, refusal }) => {
      expect(
        feedbackOfferRefusal({
          last: ago === undefined ? undefined : new Date(NOW.getTime() - ago),
          mayOffer,
          now: NOW,
        }),
      ).toBe(refusal);
    },
  );

  it("counts only a call that showed its card as this chat's offer", () => {
    const call = (output: unknown) =>
      ({
        parts: [
          { output, state: "output-available", type: "tool-offer_feedback" },
        ],
      }) as unknown as SessionMessage.WithParts;
    expect(offeredIn([call({ offered: false, reason: "recent" })])).toBe(false);
    expect(offeredIn([call({ offered: true })])).toBe(true);
    expect(offeredIn([call({ offered: true, outcome: "dismissed" })])).toBe(
      true,
    );
  });

  it("attaches the newest window picture taken since the person's message, when asked", async () => {
    const picture = (base64Data: string) => ({
      base64Data,
      height: 600,
      mimeType: "image/png",
      viewHeight: 600,
      viewWidth: 800,
      width: 800,
    });
    const look = (base64Data: string) => ({
      output: { windowPicture: picture(base64Data) },
      state: "output-available",
      type: "tool-bash",
    });
    const messages = [
      { parts: [look("before")], role: "assistant" },
      { parts: [], role: "user" },
      { parts: [look("first"), look("newest")], role: "assistant" },
      {
        parts: [{ output: {}, state: "output-available", type: "tool-bash" }],
        role: "assistant",
      },
    ] as unknown as SessionMessage.WithParts[];
    const read = vi
      .spyOn(ChatReads, "modelHistory")
      .mockReturnValue(okAsync(messages));
    expect(await offer({ windowPicture: true })).toEqual({
      offered: true,
      picture: picture("newest"),
    });
    await recordFeedbackOffer(new Date(0));
    expect(await offer({ windowPicture: false })).toEqual({ offered: true });
    await recordFeedbackOffer(new Date(0));
    read.mockReturnValue(okAsync(messages.slice(0, 2)));
    expect(await offer({ windowPicture: true })).toEqual({ offered: true });
    read.mockRestore();
  });

  it("never lets what the person did change what the model reads", () => {
    const read = (
      output: Parameters<typeof OfferFeedback.toModelOutput>[0]["output"],
    ) =>
      OfferFeedback.toModelOutput({
        input: {} as never,
        output,
        toolCallId: "test",
      });
    expect(read({ offered: true, outcome: "sent" })).toEqual(
      read({ offered: true }),
    );
  });
});

import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { errorOutcomeOf } from "./error-outcome";
import { type TranscriptMessage } from "./transcript-message";

const sessionId = StoreId.newSessionId();

function reply(
  error?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  parts: unknown[] = [],
): TranscriptMessage {
  return {
    id: StoreId.newMessageId(),
    metadata: {
      createdAt: new Date(0),
      modelId: "m",
      providerId: "p",
      sessionId,
      ...(error && { error }),
      ...extra,
    },
    parts,
    role: "assistant",
  } as TranscriptMessage;
}

const said = { metadata: {}, state: "done", text: "Words.", type: "text" };
const busy = { classification: "rate-limit", kind: "unknown", message: "Busy" };
const concurrency = {
  kind: "api-call",
  message: "No",
  name: "x",
  responseBody: JSON.stringify({ error: { code: "concurrency-limit" } }),
  url: "u",
};

describe("errorOutcomeOf", () => {
  it.each([
    ["a stop", { kind: "aborted", message: "A", reason: "manual" }, "Stopped"],
    [
      "a quit",
      { kind: "aborted", message: "A", reason: "quit" },
      "Stopped when the app quit",
    ],
    [
      "a newer message",
      { kind: "aborted", message: "A", reason: "superseded" },
      "Replaced by a newer message",
    ],
    [
      "the chat's stop",
      { kind: "aborted", message: "A", reason: "chat" },
      "Stopped by the chat",
    ],
  ])("draws no row for %s, and names it", (_case, error, cause) => {
    const message = reply(error);
    expect(
      errorOutcomeOf(message, {
        isLive: false,
        lastMessageId: message.id,
        next: undefined,
      }),
    ).toEqual({ cause, draws: "none" });
  });

  it("says so when a turn ended on a timeout, and not while it may retry", () => {
    const timedOut = reply({
      kind: "aborted",
      message: "A",
      reason: "timeout",
    });
    const ended = { lastMessageId: timedOut.id, next: undefined };
    expect(errorOutcomeOf(timedOut, { ...ended, isLive: false })).toEqual({
      cause: "Timed out",
      draws: "card",
    });
    expect(errorOutcomeOf(timedOut, { ...ended, isLive: true })?.draws).toBe(
      "none",
    );
    const retry = reply(undefined, {}, [said]);
    expect(
      errorOutcomeOf(timedOut, {
        isLive: false,
        lastMessageId: retry.id,
        next: retry,
      })?.draws,
    ).toBe("none");
  });

  it("names a retried failure, with a row only while a retry may wait on the computer", () => {
    const failed = reply(busy);
    const answered = reply(undefined, {}, [said]);
    expect(
      errorOutcomeOf(failed, {
        isLive: false,
        lastMessageId: answered.id,
        next: answered,
      }),
    ).toEqual({ cause: "Retried: rate limit", draws: "none" });
    const silent = reply();
    expect(
      errorOutcomeOf(failed, {
        isLive: false,
        lastMessageId: silent.id,
        next: silent,
      })?.draws,
    ).toBe("online-retry");
  });

  it("keeps a failure the turn ended on as a card", () => {
    const failed = reply(busy);
    expect(
      errorOutcomeOf(failed, {
        isLive: false,
        lastMessageId: failed.id,
        next: undefined,
      }),
    ).toEqual({ cause: "Error: rate limit", draws: "card" });
  });

  it("reads a run of one refusal as its latest", () => {
    const refused = { classification: "auth", kind: "unknown", message: "No" };
    const later = reply(refused);
    expect(
      errorOutcomeOf(reply(refused), {
        isLive: false,
        lastMessageId: later.id,
        next: later,
      }),
    ).toEqual({ cause: "Repeated: auth", draws: "none" });
  });

  it("names a concurrency refusal, drawing nothing once the turn went on", () => {
    const refused = reply(concurrency);
    const after = reply(undefined, {}, [said]);
    expect(
      errorOutcomeOf(refused, {
        isLive: false,
        lastMessageId: refused.id,
        next: undefined,
      })?.draws,
    ).toBe("card");
    expect(
      errorOutcomeOf(refused, {
        isLive: false,
        lastMessageId: after.id,
        next: after,
      }),
    ).toEqual({ cause: "Waited for capacity", draws: "nothing" });
  });

  it("has nothing to say of a message with no error", () => {
    expect(
      errorOutcomeOf(reply(), {
        isLive: false,
        lastMessageId: undefined,
        next: undefined,
      }),
    ).toBeUndefined();
  });
});

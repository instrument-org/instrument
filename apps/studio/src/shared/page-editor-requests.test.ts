import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerRequest,
  createRequests,
  type EditorRequest,
  type EditorResponse,
} from "./page-editor-requests";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRequests", () => {
  it("settles each question with the answer that carries its id", async () => {
    const sent: EditorRequest<string>[] = [];
    const asks = createRequests<string, number>({
      send: (message) => {
        sent.push(message);
      },
      timeoutMs: 1000,
    });
    const first = asks.request("one");
    const second = asks.request("two");
    const [a, b] = sent;
    asks.settle({ id: b?.id ?? -1, result: 2, type: "response" });
    asks.settle({ id: a?.id ?? -1, result: 1, type: "response" });
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
  });

  it("fails a question whose answer is an error", async () => {
    const sent: EditorRequest<string>[] = [];
    const asks = createRequests<string, number>({
      send: (message) => {
        sent.push(message);
      },
      timeoutMs: 1000,
    });
    const pending = asks.request("save");
    asks.settle({
      error: "disk full",
      id: sent[0]?.id ?? -1,
      type: "response",
    });
    await expect(pending).rejects.toThrow("disk full");
  });

  it("fails a question nobody answers at its deadline, and ignores a late answer", async () => {
    vi.useFakeTimers();
    const sent: EditorRequest<string>[] = [];
    const asks = createRequests<string, number>({
      send: (message) => {
        sent.push(message);
      },
      timeoutMs: 3000,
    });
    const pending = asks.request("flush").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3000);
    expect(String(await pending)).toContain("No answer within 3s");
    expect(() => {
      asks.settle({ id: sent[0]?.id ?? -1, result: 1, type: "response" });
    }).not.toThrow();
  });

  it("fails every question still waiting when the other side is gone", async () => {
    const asks = createRequests<string, number>({
      send: vi.fn(),
      timeoutMs: 1000,
    });
    const pending = [asks.request("a"), asks.request("b")];
    asks.abandon("The page left Edit");
    for (const question of pending) {
      await expect(question).rejects.toThrow("The page left Edit");
    }
  });
});

describe("answerRequest", () => {
  // A save that threw sent no answer, so every later save queued behind it
  // forever (6d06cb144): the asker's chain must hear the failure and go on.
  it("answers a question whose handler throws, and the next one still settles", async () => {
    const asks = createRequests<string, string>({
      send: (message) => {
        void answerRequest(
          message,
          (body) =>
            body === "bad"
              ? Promise.reject(new Error("could not write"))
              : Promise.resolve(`wrote ${body}`),
          (response: EditorResponse<string>) => {
            asks.settle(response);
          },
        );
      },
      timeoutMs: 1000,
    });
    await expect(asks.request("bad")).rejects.toThrow("could not write");
    await expect(asks.request("good")).resolves.toBe("wrote good");
  });
});

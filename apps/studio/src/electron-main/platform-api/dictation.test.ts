import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dictationAllowance, transcribeDictation } from "./dictation";
import { getToken } from "./utils";

vi.mock(import("./headers"), () => ({
  getPlatformApiHeaders: () => ({
    authorization: "Bearer test-token",
    "user-agent": "Instrument/1.4.2",
    "x-client-arch": "arm64",
    "x-client-name": "studio",
    "x-client-os-version": "15.6",
    "x-client-platform": "darwin",
    "x-client-version": "1.4.2",
  }),
}));
vi.mock(import("./utils"), () => ({
  getToken: vi.fn(),
}));

const mockGetToken = vi.mocked(getToken);

const audio = new Blob([new Uint8Array([1, 2, 3])], {
  type: "audio/webm;codecs=opus",
});

describe("transcribeDictation", () => {
  beforeEach(() => {
    mockGetToken.mockReturnValue("test-token");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for a sign-in without making a request when signed out", async () => {
    mockGetToken.mockReturnValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await transcribeDictation({ audio, surface: "composer" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchInlineSnapshot(`
      {
        "failure": {
          "kind": "signed-out",
        },
        "ok": false,
      }
    `);
  });

  it("posts the raw recording with its type, surface, and language", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ durationSeconds: 4.2, text: "Hello there." }),
      );

    const result = await transcribeDictation({
      audio,
      language: "fr",
      surface: "report",
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toEqual(expect.stringMatching(/\/dictation\?language=fr$/));
    expect(init?.body).toBe(audio);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchInlineSnapshot(`
      {
        "authorization": "Bearer test-token",
        "content-type": "audio/webm;codecs=opus",
        "user-agent": "Instrument/1.4.2",
        "x-client-arch": "arm64",
        "x-client-name": "studio",
        "x-client-os-version": "15.6",
        "x-client-platform": "darwin",
        "x-client-version": "1.4.2",
        "x-instrument-dictation-surface": "report",
      }
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "durationSeconds": 4.2,
        "ok": true,
        "text": "Hello there.",
      }
    `);
  });

  it("leaves the language out when none was picked", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ durationSeconds: 1, text: "Hi" }));

    await transcribeDictation({ audio, surface: "composer" });

    expect(fetchSpy.mock.calls[0]?.[0]).toEqual(
      expect.stringMatching(/\/dictation$/),
    );
  });

  it.each([
    [401, { error: "Unauthorized" }, { kind: "signed-out" }],
    [
      429,
      {
        error: {
          code: "rate-limit-exceeded",
          message: "Slow down",
          retryable: true,
        },
      },
      { kind: "rate-limited" },
    ],
    [
      429,
      {
        error: {
          code: "dictation-allowance-reached",
          message: "Come back later",
          resetsAt: "2026-10-14T00:00:00.000Z",
          retryable: false,
        },
      },
      {
        kind: "allowance-reached",
        remainingSeconds: 0,
        resetsAt: "2026-10-14T00:00:00.000Z",
      },
    ],
    [
      413,
      { error: { code: "too-large", message: "Too big", retryable: false } },
      { kind: "too-large" },
    ],
    [
      502,
      { error: { code: "upstream-failed", message: "Nope", retryable: true } },
      { kind: "server" },
    ],
    [502, { error: "Transcription failed" }, { kind: "server" }],
    [413, { error: "Recording too large" }, { kind: "too-large" }],
    [400, { error: "No audio" }, { kind: "no-audio" }],
    [400, { error: "Unsupported language" }, { kind: "rejected" }],
    [415, { error: "Unsupported audio type" }, { kind: "unsupported-audio" }],
    [500, "not json", { kind: "server" }],
  ])("maps a %i response to a failure", async (status, body, failure) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      typeof body === "string"
        ? new Response(body, { status })
        : Response.json(body, { status }),
    );

    const result = await transcribeDictation({ audio, surface: "composer" });

    expect(result).toEqual({ failure, ok: false });
  });

  it("reports a request that never got an answer as a lost connection", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed"),
    );

    const result = await transcribeDictation({ audio, surface: "composer" });

    expect(result).toEqual({ failure: { kind: "connection" }, ok: false });
  });

  it("reports a request the renderer abandoned as canceled", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });

    const result = await transcribeDictation({
      audio,
      signal: controller.signal,
      surface: "composer",
    });

    expect(result).toEqual({ failure: { kind: "canceled" }, ok: false });
  });

  it("treats a success it can't read as a server failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ words: "Hello" }),
    );

    const result = await transcribeDictation({ audio, surface: "composer" });

    expect(result).toEqual({ failure: { kind: "server" }, ok: false });
  });

  describe("the allowance", () => {
    const resetsAt = "2026-10-14T00:00:00.000Z";
    const beforeReset = Date.parse("2026-10-13T20:00:00.000Z");
    const respond = (status: number, remaining: string, body: unknown) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json(body, {
          headers: { "x-dictation-remaining-seconds": remaining },
          status,
        }),
      );
      return transcribeDictation({ audio, surface: "composer" });
    };
    const reached = {
      error: {
        code: "dictation-allowance-reached",
        message: "Come back later",
        resetsAt,
        retryable: false,
      },
    };

    it("hands the seconds left to the renderer with the words", async () => {
      expect(
        await respond(200, "1234", { durationSeconds: 2, text: "Hi" }),
      ).toMatchObject({ ok: true, remainingSeconds: 1234 });
      expect(dictationAllowance(beforeReset)).toEqual({ exhausted: false });
    });

    it("is used up after a refusal, until the reset passes", async () => {
      await respond(429, "0", reached);
      expect(dictationAllowance(beforeReset)).toEqual({
        exhausted: true,
        resetsAt,
      });
      expect(dictationAllowance(Date.parse(resetsAt) + 1)).toEqual({
        exhausted: false,
      });
    });

    it("starts fresh for another account signing in", async () => {
      await respond(429, "0", reached);
      mockGetToken.mockReturnValue("another-token");
      expect(dictationAllowance(beforeReset)).toEqual({ exhausted: false });
    });

    it("is not called used up on a zero with no reset time to wait for", async () => {
      await respond(429, "0", reached);
      await respond(200, "0", { durationSeconds: 2, text: "Hi" });
      expect(dictationAllowance(beforeReset)).toEqual({ exhausted: false });
    });

    it("starts over when an answer says there is time left", async () => {
      await respond(429, "0", reached);
      await respond(200, "60", { durationSeconds: 2, text: "Hi" });
      expect(dictationAllowance(beforeReset)).toEqual({ exhausted: false });
    });
  });
});

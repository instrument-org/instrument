import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelOpenRouterConnect,
  connectOpenRouter,
  receiveOpenRouterCallback,
} from "./openrouter-connect";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("electron", () => ({ shell: { openExternal } }));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    Response.json({ key: "sk-or-v1-made", user_id: "user_1" }),
  );
});

afterEach(() => {
  cancelOpenRouterConnect();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function start() {
  const save = vi.fn((_key: string) => Promise.resolve());
  const result = connectOpenRouter({ callbackPort: 4826, save });
  const opened = openExternal.mock.lastCall?.[0];
  if (typeof opened !== "string") {
    throw new Error("The consent page was not opened");
  }
  return { result, save, url: new URL(opened) };
}

describe("connectOpenRouter", () => {
  it("opens the consent page with a loopback callback and an S256 challenge", () => {
    const { url } = start();
    const params = Object.fromEntries(url.searchParams);

    expect({
      ...params,
      code_challenge: params.code_challenge?.length,
      state: params.state?.length,
    }).toMatchInlineSnapshot(`
      {
        "callback_url": "http://127.0.0.1:4826/auth/callback/openrouter",
        "code_challenge": 43,
        "code_challenge_method": "S256",
        "key_label": "Instrument",
        "state": 43,
      }
    `);
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
  });

  it("trades the code for a key with the verifier behind the challenge, and saves it before settling", async () => {
    const { result, save, url } = start();

    const page = receiveOpenRouterCallback(
      new URLSearchParams({
        code: "code-1",
        state: url.searchParams.get("state") ?? "",
      }),
    );

    await expect(page).resolves.toEqual({ outcome: "connected" });
    await expect(result).resolves.toEqual({ outcome: "connected" });
    expect(save).toHaveBeenCalledWith("sk-or-v1-made");

    const [exchangeURL, init] = fetchMock.mock.lastCall ?? [];
    expect(exchangeURL).toBe("https://openrouter.ai/api/v1/auth/keys");
    const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    expect(body).toMatchObject({
      code: "code-1",
      code_challenge_method: "S256",
    });
    const verifier =
      typeof body === "object" && body && "code_verifier" in body
        ? String(body.code_verifier)
        : "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      url.searchParams.get("code_challenge"),
    );
  });

  it("turns away a redirect carrying another state and keeps waiting", async () => {
    const { result, url } = start();

    expect(
      receiveOpenRouterCallback(
        new URLSearchParams({ code: "code-1", state: "someone-else" }),
      ),
    ).toBeUndefined();

    void receiveOpenRouterCallback(
      new URLSearchParams({
        code: "code-1",
        state: url.searchParams.get("state") ?? "",
      }),
    );
    await expect(result).resolves.toEqual({ outcome: "connected" });
  });

  it("ends as declined on a denial, which OpenRouter sends without state", async () => {
    const { result, save } = start();

    void receiveOpenRouterCallback(new URLSearchParams({ error: "access_denied" }));

    await expect(result).resolves.toEqual({ outcome: "declined" });
    expect(save).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ends as canceled when the app gives up, and refuses the redirect after", async () => {
    const { result, url } = start();

    cancelOpenRouterConnect();

    await expect(result).resolves.toEqual({ outcome: "canceled" });
    expect(
      receiveOpenRouterCallback(
        new URLSearchParams({
          code: "code-1",
          state: url.searchParams.get("state") ?? "",
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects when OpenRouter refuses the code", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));
    const { result, save, url } = start();

    void receiveOpenRouterCallback(
      new URLSearchParams({
        code: "stale",
        state: url.searchParams.get("state") ?? "",
      }),
    )?.catch(() => {});

    await expect(result).rejects.toThrow(
      "OpenRouter didn't create a key (403)",
    );
    expect(save).not.toHaveBeenCalled();
  });
});

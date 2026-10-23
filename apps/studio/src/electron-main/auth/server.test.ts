import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatgpt: vi.fn(),
  openrouter: vi.fn(),
  instrument: vi.fn(),
  open: vi.fn(),
  capture: vi.fn(),
  app: vi.fn<(params: URLSearchParams) => Promise<unknown>>(),
}));

vi.mock("./client", () => ({
  receiveAppOpen: mocks.open,
  receiveInstrumentCallback: mocks.instrument,
}));
vi.mock("./page", () => ({
  GOOGLE_MARK: "google",
  OPENAI_MARK: "openai",
  OPENROUTER_MARK: "openrouter",
  newAuthReference: () => "reference",
  previewOutcomes: () => [],
  renderAuthPage: (page: { kind: string }) => page.kind,
}));
vi.mock("../lib/apps", () => ({
  appMark: vi.fn(),
  appName: vi.fn(),
  getAppsDir: () => undefined,
  receiveAppCallback: mocks.app,
}));
vi.mock("../lib/chatgpt-account", () => ({
  receiveChatGPTCallback: mocks.chatgpt,
}));
vi.mock("../lib/openrouter-connect", () => ({
  receiveOpenRouterCallback: mocks.openrouter,
}));
vi.mock("../lib/capture-server-exception", () => ({
  captureServerException: mocks.capture,
}));
vi.mock("../lib/directory-icons", () => ({ directoryIconDataUri: vi.fn() }));
vi.mock("../windows/foreground", () => ({ focusAppWindow: vi.fn() }));

import { createAuthCallbackApp } from "./server";
import { APP_OPEN_PATH, AUTH_CALLBACK_PATHS } from "./routes";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.instrument.mockImplementation((params: URLSearchParams) =>
    params.get("state") === "instrument-state"
      ? Promise.resolve({ outcome: "declined" })
      : undefined,
  );
  mocks.chatgpt.mockImplementation((params: URLSearchParams) =>
    params.get("state") === "chatgpt-state"
      ? Promise.resolve({ outcome: "declined" })
      : undefined,
  );
});

describe("the assembled auth callback server", () => {
  it("routes a ChatGPT callback while an Instrument sign-in is pending", async () => {
    const response = await createAuthCallbackApp().request(
      "/auth/callback?state=chatgpt-state&error=access_denied",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("declined");
    expect(mocks.chatgpt).toHaveBeenCalledOnce();
    expect(mocks.instrument).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("finishes an Instrument sign-in at its own path", async () => {
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.instrument}?state=instrument-state&error=access_denied`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("declined");
    expect(mocks.chatgpt).not.toHaveBeenCalled();
  });

  it("sends the browser on to the website when the sign-in names it", async () => {
    mocks.instrument.mockResolvedValue({
      email: "dana@example.com",
      next: "https://tryinstrument.com/welcome?port=51234",
      outcome: "signed-in",
    });
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.instrument}?state=instrument-state&token=t`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://tryinstrument.com/welcome?port=51234",
    );
  });

  it("opens the app for the website's button, passing on its step", async () => {
    const response = await createAuthCallbackApp().request(
      `${APP_OPEN_PATH}?step=subscriptions`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("opened");
    expect(mocks.open).toHaveBeenCalledWith("subscriptions");
  });

  // An address the API won't create an account for is an answer, not a bug.
  it("says sign-ups are closed without reporting a failure", async () => {
    mocks.instrument.mockResolvedValue({ outcome: "sign-up-refused" });
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.instrument}?state=instrument-state&error=unable_to_create_user`,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("sign-up-refused");
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("hands ChatGPT a callback carrying the Instrument state", async () => {
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.chatgpt}?state=instrument-state&token=token`,
    );
    expect(response.status).toBe(400);
    expect(mocks.instrument).not.toHaveBeenCalled();
  });

  it.each(["stale-state", ""])(
    "turns away an Instrument callback with unknown state %s",
    async (state) => {
      const response = await createAuthCallbackApp().request(
        `${AUTH_CALLBACK_PATHS.instrument}?state=${state}`,
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("expired");
      expect(mocks.capture).toHaveBeenCalledOnce();
    },
  );

  it("routes OpenRouter to its own receiver", async () => {
    mocks.openrouter.mockResolvedValue({ outcome: "declined" });
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.openrouter}?state=openrouter-state`,
    );
    expect(response.status).toBe(200);
    expect(mocks.openrouter).toHaveBeenCalledOnce();
    expect(mocks.chatgpt).not.toHaveBeenCalled();
  });

  it("routes connected apps independently", async () => {
    mocks.app.mockResolvedValue({
      error: "refused",
      outcome: "failed",
      slug: "linear",
    });
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.app}?state=app-state&code=code`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("failed");
    expect(mocks.app.mock.lastCall?.[0].toString()).toBe(
      "state=app-state&code=code",
    );
    expect(mocks.chatgpt).not.toHaveBeenCalled();
  });

  it("reports an Instrument sign-in that failed after the browser came back", async () => {
    mocks.instrument.mockRejectedValue(new Error("Expired handoff"));
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.instrument}?state=instrument-state&token=token`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("failed");
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it("renders a completed Instrument sign-in", async () => {
    mocks.instrument.mockResolvedValue({
      email: "test@example.com",
      outcome: "signed-in",
    });
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.instrument}?state=instrument-state&token=token`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("signed-in");
  });

  it("renders a completed ChatGPT sign-in", async () => {
    mocks.chatgpt.mockResolvedValue({
      outcome: "signed-in",
      account: { email: "test@example.com" },
    });
    const response = await createAuthCallbackApp().request(
      "/auth/callback?state=chatgpt-state&code=code",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("connected");
    expect(mocks.instrument).not.toHaveBeenCalled();
  });

  it("registers each GET path once", () => {
    const routes = createAuthCallbackApp().routes.map(
      ({ method, path }) => `${method} ${path}`,
    );
    expect(new Set(routes).size).toBe(routes.length);
    for (const path of Object.values(AUTH_CALLBACK_PATHS)) {
      expect(routes).toContain(`GET ${path}`);
    }
  });
});

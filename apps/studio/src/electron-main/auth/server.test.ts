import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatgpt: vi.fn(),
  openrouter: vi.fn(),
  exchange: vi.fn(),
  publish: vi.fn(),
  capture: vi.fn(),
  completeApp: vi.fn(),
  store: { state: null as string | null, codeVerifier: null as string | null },
}));

vi.mock("./client", () => ({
  store: mocks.store,
  exchangeDesktopSignIn: mocks.exchange,
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
  APP_OAUTH_CALLBACK_PATH: "/auth/callback/app",
  announceConnected: vi.fn(),
  appMark: vi.fn(),
  appName: vi.fn(),
  getAppsDir: () => undefined,
}));
vi.mock("../lib/chatgpt-account", () => ({
  receiveChatGPTCallback: mocks.chatgpt,
}));
vi.mock("../lib/openrouter-connect", () => ({
  OPENROUTER_CALLBACK_PATH: "/auth/callback/openrouter",
  receiveOpenRouterCallback: mocks.openrouter,
}));
vi.mock("../lib/capture-server-exception", () => ({
  captureServerException: mocks.capture,
}));
vi.mock("../lib/directory-icons", () => ({ directoryIconDataUri: vi.fn() }));
vi.mock("../lib/set-default-model", () => ({ setDefaultModel: vi.fn() }));
vi.mock("../rpc/publisher", () => ({ publisher: { publish: mocks.publish } }));
vi.mock("../stores/workspace/session", () => ({
  getSessionStore: () => ({ set: vi.fn() }),
}));
vi.mock("../stores/workspace/state", () => ({
  getWorkspaceState: () => ({ set: vi.fn() }),
}));
vi.mock("../windows/foreground", () => ({ focusAppWindow: vi.fn() }));
vi.mock("../browser-view/history-intents", () => ({ settleSignIn: vi.fn() }));
vi.mock("@instrument-org/workspace/electron", () => ({
  appChanged: vi.fn(),
  cancelMcpOAuth: vi.fn(),
  completeMcpOAuth: mocks.completeApp,
  pendingMcpOAuthSlug: () => undefined,
  recordConnection: vi.fn(),
}));

import { createAuthCallbackApp } from "./server";
import { AUTH_CALLBACK_PATHS } from "./routes";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.store.state = "instrument-state";
  mocks.store.codeVerifier = "verifier";
  mocks.chatgpt.mockImplementation((params: URLSearchParams) =>
    params.get("state") === "chatgpt-state"
      ? Promise.resolve({ outcome: "declined" })
      : undefined,
  );
});

describe("the assembled auth callback server", () => {
  it("routes a ChatGPT callback past the legacy Instrument handler", async () => {
    const response = await createAuthCallbackApp().request(
      "/auth/callback?state=chatgpt-state&error=access_denied",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("declined");
    expect(mocks.chatgpt).toHaveBeenCalledOnce();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.store.state).toBe("instrument-state");
  });

  it.each([AUTH_CALLBACK_PATHS.instrument, AUTH_CALLBACK_PATHS.chatgpt])(
    "finishes an Instrument sign-in at %s",
    async (path) => {
      const response = await createAuthCallbackApp().request(
        `${path}?state=instrument-state&error=access_denied`,
      );
      expect(response.status).toBe(200);
      expect(mocks.publish).toHaveBeenCalledWith("auth.sign-in-outcome", {
        outcome: "declined",
      });
      expect(mocks.chatgpt).not.toHaveBeenCalled();
      expect(mocks.store.state).toBeNull();
    },
  );

  it("uses state rather than token-shaped parameters to select a flow", async () => {
    await createAuthCallbackApp().request(
      "/auth/callback?state=chatgpt-state&token=unexpected",
    );
    expect(mocks.chatgpt).toHaveBeenCalledOnce();
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it.each(["stale-state", ""])(
    "leaves pending sign-ins intact for unknown state %s",
    async (state) => {
      const response = await createAuthCallbackApp().request(
        `/auth/callback?state=${state}`,
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("expired");
      expect(mocks.publish).not.toHaveBeenCalled();
      expect(mocks.store.state).toBe("instrument-state");
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
    mocks.completeApp.mockResolvedValue({ isErr: () => true });
    const response = await createAuthCallbackApp().request(
      `${AUTH_CALLBACK_PATHS.app}?state=app-state&code=code`,
    );
    expect(response.status).toBe(400);
    expect(mocks.completeApp).toHaveBeenCalledWith({
      code: "code",
      state: "app-state",
    });
    expect(mocks.chatgpt).not.toHaveBeenCalled();
  });

  it("refuses to construct a server when callback paths collide", () => {
    const instrument = AUTH_CALLBACK_PATHS.instrument;
    try {
      Object.assign(AUTH_CALLBACK_PATHS, {
        instrument: AUTH_CALLBACK_PATHS.chatgpt,
      });
      expect(() => createAuthCallbackApp()).toThrow(
        "Duplicate auth callback route: GET /auth/callback",
      );
    } finally {
      Object.assign(AUTH_CALLBACK_PATHS, { instrument });
    }
  });

  it("reports an Instrument exchange failure and consumes its callback", async () => {
    mocks.exchange.mockRejectedValue(new Error("Expired handoff"));
    const app = createAuthCallbackApp();
    const response = await app.request(
      `${AUTH_CALLBACK_PATHS.instrument}?state=instrument-state&token=token`,
    );
    expect(response.status).toBe(400);
    expect(mocks.publish).toHaveBeenCalledWith(
      "auth.sign-in-outcome",
      expect.objectContaining({ outcome: "failed" }),
    );
    expect(mocks.store.state).toBeNull();
    await app.request(
      `${AUTH_CALLBACK_PATHS.instrument}?state=instrument-state&token=token`,
    );
    expect(mocks.exchange).toHaveBeenCalledOnce();
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
    expect(mocks.exchange).not.toHaveBeenCalled();
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

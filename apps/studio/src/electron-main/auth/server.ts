import {
  auth,
  createGoogleProvider,
  decodeOAuthState,
  store,
} from "@/electron-main/auth/client";
import { renderAuthPage, testStates } from "@/electron-main/auth/page";
import {
  getAuthServer,
  setAuthServer,
  setAuthServerPort,
} from "@/electron-main/auth/state";
import { captureServerEvent } from "@/electron-main/lib/capture-server-event";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { publisher } from "@/electron-main/rpc/publisher";
import { getAppStateStore } from "@/electron-main/stores/app-state";
import { getSessionStore } from "@/electron-main/stores/session";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { getOnboardingWindow } from "@/electron-main/windows/onboarding";
import { serve } from "@hono/node-server";
import { PORTS } from "@instrument-org/shared";
import {
  cancelMcpOAuth,
  completeMcpOAuth,
} from "@instrument-org/workspace/electron";
import { detect } from "detect-port";
import { type Context, Hono } from "hono";
import fs from "node:fs/promises";

function focusAppWindow() {
  // Prefer the onboarding window if it's currently open (first-run login).
  // Otherwise fall back to the main window (login from inside the app).
  const onboardingWindow = getOnboardingWindow();
  const target =
    onboardingWindow && !onboardingWindow.isDestroyed()
      ? onboardingWindow
      : getMainWindow();
  if (target && !target.isDestroyed()) {
    if (target.isMinimized()) {
      target.restore();
    }
    target.show();
    // Temporarily set always-on-top to reliably bring window to front on Windows
    target.setAlwaysOnTop(true);
    target.focus();
    target.setAlwaysOnTop(false);
  }
}

const DEFAULT_PORT =
  process.env.NODE_ENV === "development"
    ? PORTS.authCallback.dev
    : PORTS.authCallback.prod;

const serveAsset = async (
  c: Context,
  importFn: () => Promise<{ default: string }>,
  contentType: string,
) => {
  try {
    const { default: assetPath } = await importFn();
    const buffer = await fs.readFile(assetPath);
    return c.body(buffer, 200, { "Content-Type": contentType });
  } catch (error) {
    captureServerException(
      new Error("Failed to load asset", { cause: error }),
      { scopes: ["auth"] },
    );
    return c.body(null, 404);
  }
};

export async function startAuthCallbackServer() {
  const existingServer = getAuthServer();
  if (existingServer !== null) {
    return;
  }

  const port = await detect(DEFAULT_PORT);
  setAuthServerPort(port);

  const app = new Hono();

  app.get("/icon.png", (c) =>
    serveAsset(
      c,
      () => import("../../../resources/icon.png?asset"),
      "image/png",
    ),
  );
  app.get("/app-icon-stylized.png", (c) =>
    serveAsset(
      c,
      () => import("../../client/assets/app-icon-stylized.png?asset"),
      "image/png",
    ),
  );
  app.get("/favicon.ico", (c) =>
    serveAsset(
      c,
      () => import("../../../resources/favicon.ico?asset"),
      "image/x-icon",
    ),
  );
  app.get("/tailwind.js", (c) =>
    serveAsset(
      c,
      () => import("../../../resources/tailwind-browser.js?asset"),
      "application/javascript",
    ),
  );

  app.get("/auth/callback/google", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (
      code === undefined ||
      store.state === null ||
      state !== store.state ||
      store.codeVerifier === null
    ) {
      captureServerException(
        new Error("OAuth callback received with invalid state or missing code"),
        { scopes: ["auth"] },
      );
      focusAppWindow();
      return c.html(renderAuthPage({ isError: true }), 400);
    }

    const decodedState = decodeOAuthState(state);
    if (!decodedState) {
      focusAppWindow();
      return c.html(renderAuthPage({ isError: true }), 400);
    }

    const google = createGoogleProvider({ port });
    const tokens = await google.validateAuthorizationCode(
      code,
      store.codeVerifier,
    );

    const sessionStore = getSessionStore();
    sessionStore.set("provider", "google");
    sessionStore.set("providerAccessToken", tokens.accessToken());
    sessionStore.set("providerRefreshToken", tokens.refreshToken());
    sessionStore.set("providerIdToken", tokens.idToken());
    sessionStore.set("providerScopes", tokens.scopes());
    sessionStore.set("providerTokenType", tokens.tokenType());

    const headers = new Headers();

    try {
      const res = await auth.signIn.social(
        {
          idToken: {
            accessToken: tokens.accessToken(),
            refreshToken: tokens.refreshToken(),
            token: tokens.idToken(),
          },
          provider: "google",
        },
        {
          headers,
          onSuccess(ctx) {
            const authToken = ctx.response.headers.get("set-auth-token");
            sessionStore.set("apiBearerToken", authToken);
            getAppStateStore().set("hasCompletedProviderSetup", true);
          },
        },
      );

      if (res.error) {
        captureServerException(
          new Error("Login failed", { cause: res.error }),
          { scopes: ["auth"] },
        );
        publisher.publish("auth.login-error", {
          error: res.error,
        });
        focusAppWindow();
        return await c.html(renderAuthPage({ isError: true }), 400);
      }
    } catch (error) {
      captureServerException(new Error("Error signing in", { cause: error }), {
        scopes: ["auth"],
      });
      focusAppWindow();
      return c.html(renderAuthPage({ isError: true }), 400);
    }

    void setDefaultModel();
    publisher.publish("auth.login-success", { success: true });
    // Delay focus so the renderer has time to navigate to the success screen
    // before the window comes to front -- keeps the entrance animation visible.
    setTimeout(focusAppWindow, 400);
    captureServerEvent("auth.logged_in");
    return c.html(renderAuthPage({}));
  });

  // MCP connector OAuth: the browser lands here after the user approves. Finish
  // the parked flow (exchange the code for tokens), then let the app re-list and
  // enable the connector via connectors.updated.
  app.get("/auth/callback/connector", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const oauthError = c.req.query("error");
    focusAppWindow();
    if (
      state !== undefined &&
      (oauthError !== undefined || code === undefined)
    ) {
      // Denied / cancelled: tear down the parked flow so it doesn't leak.
      await cancelMcpOAuth(state);
      publisher.publish("connectors.updated", null);
      return c.html(renderAuthPage({ isError: true }), 400);
    }
    if (code === undefined || state === undefined) {
      return c.html(renderAuthPage({ isError: true }), 400);
    }
    const result = await completeMcpOAuth({ code, state });
    if (result.isErr()) {
      captureServerException(
        new Error(`Connector OAuth failed: ${result.error.message}`),
        { scopes: ["auth"] },
      );
      return c.html(renderAuthPage({ isError: true }), 400);
    }
    publisher.publish("connectors.updated", null);
    return c.html(renderAuthPage({}));
  });

  app.get("/test", (c) =>
    c.html(
      renderAuthPage({
        indexHref: "/test",
        states: testStates,
        title: "Auth Page Preview",
      }),
    ),
  );
  app.get("/test/success", (c) => c.html(renderAuthPage({})));
  app.get("/test/error", (c) => c.html(renderAuthPage({ isError: true })));
  const server = serve({ fetch: app.fetch, port });
  setAuthServer(server);

  return {
    port,
    server,
  };
}

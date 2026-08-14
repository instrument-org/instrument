import {
  auth,
  createGoogleProvider,
  decodeOAuthState,
  store,
} from "@/electron-main/auth/client";
import { renderAuthPage, testStates } from "@/electron-main/auth/page";
import { setAuthServerPort } from "@/electron-main/auth/state";
import { captureServerEvent } from "@/electron-main/lib/capture-server-event";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { publisher } from "@/electron-main/rpc/publisher";
import { getAppStateStore } from "@/electron-main/stores/app-state";
import { getSessionStore } from "@/electron-main/stores/session";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { getOnboardingWindow } from "@/electron-main/windows/onboarding";
import { serve } from "@hono/node-server";
import { listenWithPortFallback, PORTS } from "@instrument-org/shared";
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

let startPromise: Promise<undefined | { port: number }> | undefined;

/**
 * Memoized rather than guarded on the started server, because that handle only
 * exists once the bind resolves: two calls that overlap the bind would both
 * pass a guard on it and start a second server.
 */
export function startAuthCallbackServer() {
  startPromise ??= start();
  return startPromise;
}

async function start() {
  const app = new Hono();

  // Bound before the routes are registered, so they close over the port the
  // bind actually took. Nothing can reach the server in between: registration
  // runs in the same tick.
  //
  // IPv4 loopback only, so the OAuth callback and the auth preview pages aren't
  // exposed to the local network; the system browser reaches the callback via
  // localhost/127.0.0.1.
  const bound = await listenWithPortFallback({
    basePort: DEFAULT_PORT,
    listen: (port) => serve({ fetch: app.fetch, hostname: "127.0.0.1", port }),
  }).catch((error: unknown) => {
    captureServerException(
      new Error("Failed to start the auth callback server", { cause: error }),
      { scopes: ["auth"] },
    );
    return null;
  });

  if (!bound) {
    return;
  }

  const { port, server } = bound;
  setAuthServerPort(port);

  // Sign-in is the only thing this server carries, so losing it is worth
  // reporting and not worth crashing over. Without a listener, a socket error
  // reaches the process and takes the whole app down.
  server.on("error", (error) => {
    captureServerException(
      new Error("Auth callback server error", { cause: error }),
      {
        scopes: ["auth"],
      },
    );
  });

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

  return { port };
}

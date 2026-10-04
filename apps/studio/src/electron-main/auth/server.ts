import {
  auth,
  createGoogleProvider,
  decodeOAuthState,
  store,
} from "@/electron-main/auth/client";
import {
  GOOGLE_MARK,
  newAuthReference,
  OPENAI_MARK,
  previewOutcomes,
  renderAuthPage,
} from "@/electron-main/auth/page";
import { setAuthServerPort } from "@/electron-main/auth/state";
import {
  announceConnected,
  APP_OAUTH_CALLBACK_PATH,
  appHome,
  appMark,
  appName,
  getAppsDir,
} from "@/electron-main/lib/apps";
import { captureServerEvent } from "@/electron-main/lib/capture-server-event";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  CHATGPT_CALLBACK_PATH,
  receiveChatGPTCallback,
} from "@/electron-main/lib/chatgpt-plan";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { publisher } from "@/electron-main/rpc/publisher";
import { getSessionStore } from "@/electron-main/stores/workspace/session";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { serve } from "@hono/node-server";
import { listenWithPortFallback, PORTS } from "@instrument-org/shared";
import {
  cancelMcpOAuth,
  completeMcpOAuth,
  pendingMcpOAuthSlug,
  recordConnection,
  workspacePublisher,
} from "@instrument-org/workspace/electron";
import { type Context, Hono } from "hono";
import fs from "node:fs/promises";

function focusAppWindow() {
  const target = getForegroundWindow();
  if (target) {
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
      // The file is a PNG under an .ico name, and Safari draws nothing for
      // one served as an icon file.
      "image/png",
    ),
  );
  // The app's own Roboto Serif, so the pages set their headings in the
  // face the window uses even where the browser can't reach Google Fonts.
  app.get("/fonts/roboto-serif-400.woff2", (c) =>
    serveAsset(
      c,
      () =>
        import("@fontsource/roboto-serif/files/roboto-serif-latin-400-normal.woff2?asset"),
      "font/woff2",
    ),
  );
  app.get("/tailwind.js", (c) =>
    serveAsset(
      c,
      () => import("../../../resources/tailwind-browser.js?asset"),
      "application/javascript",
    ),
  );

  const googleService = { mark: GOOGLE_MARK, name: "Google" };
  // A failure the page offers a reference for, logged under that reference.
  const failed = (
    error: Error,
    page: { connecting?: string; provider: string },
  ) => {
    const reference = newAuthReference();
    captureServerException(error, {
      auth_reference: reference,
      scopes: ["auth"],
    });
    return renderAuthPage({ ...page, kind: "failed", reference });
  };

  app.get("/auth/callback/google", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (
      c.req.query("error") !== undefined &&
      state !== undefined &&
      state === store.state
    ) {
      focusAppWindow();
      return c.html(
        renderAuthPage({
          fromChat: false,
          kind: "declined",
          service: googleService,
          signIn: true,
        }),
      );
    }

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
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }

    const decodedState = decodeOAuthState(state);
    if (!decodedState) {
      focusAppWindow();
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }

    const google = createGoogleProvider({ port });
    const { codeVerifier } = store;
    const sessionStore = getSessionStore();

    const headers = new Headers();
    let email: string | undefined;

    try {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const res = await auth.signIn.social(
        {
          // The ID token alone proves who signed in; Google's access and
          // refresh tokens are never sent to the platform.
          idToken: { token: tokens.idToken() },
          provider: "google",
        },
        {
          headers,
          onSuccess(ctx) {
            const authToken = ctx.response.headers.get("set-auth-token");
            sessionStore.set("apiBearerToken", authToken);
            getWorkspaceState().set("hasCompletedProviderSetup", true);
          },
        },
      );

      if (res.error) {
        const page = failed(new Error("Login failed", { cause: res.error }), {
          provider: "Google",
        });
        publisher.publish("auth.login-error", {
          error: res.error,
        });
        focusAppWindow();
        return await c.html(page, 400);
      }
      // The session is saved by now, so reading the email must not throw
      // into the catch below and report a sign-in that went through as failed.
      const { data } = res;
      email = data && "user" in data ? data.user.email : undefined;
    } catch (error) {
      const page = failed(new Error("Error signing in", { cause: error }), {
        provider: "Google",
      });
      // The button in the app holds until it hears how the sign-in went.
      publisher.publish("auth.login-error", {
        error: {
          message: error instanceof Error ? error.message : undefined,
          status: 500,
          statusText: "Error signing in",
        },
      });
      focusAppWindow();
      return c.html(page, 400);
    }

    void setDefaultModel();
    publisher.publish("auth.login-success", { success: true });
    // Delay focus so the renderer has time to navigate to the success screen
    // before the window comes to front -- keeps the entrance animation visible.
    setTimeout(focusAppWindow, 400);
    captureServerEvent("auth.logged_in");
    return c.html(
      renderAuthPage({ email, kind: "signed-in", service: googleService }),
    );
  });

  // An app's sign-in lands here after the user approves. Finish the parked
  // flow (the code becomes tokens, the app becomes connected), then tell the
  // window and the chat. The page opened in the window's own browser,
  // so this renders where the user is looking rather than pulling focus.
  app.get(APP_OAUTH_CALLBACK_PATH, async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const oauthError = c.req.query("error");
    const appsDir = getAppsDir();
    if (
      state !== undefined &&
      (oauthError !== undefined || code === undefined)
    ) {
      // Denied or abandoned in the provider's page: the flow is torn down and
      // the conversation hears a decline, the same as "Not now" on the card.
      const slug = pendingMcpOAuthSlug(state);
      await cancelMcpOAuth(state);
      if (slug === undefined || !appsDir) {
        return c.html(renderAuthPage({ kind: "expired" }), 400);
      }
      await recordConnection(slug, { status: "declined" });
      const name = await appName(appsDir, slug);
      workspacePublisher.publish("app.updated", null);
      workspacePublisher.publish("app.event", {
        event: "declined",
        name,
        slug,
      });
      return c.html(
        renderAuthPage({
          fromChat: true,
          kind: "declined",
          service: { mark: await appMark(appsDir, slug), name },
        }),
      );
    }
    if (code === undefined || state === undefined) {
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }
    const slug = pendingMcpOAuthSlug(state);
    const result = await completeMcpOAuth({ code, state });
    if (result.isErr()) {
      // No flow was waiting for this state: an old tab or a second visit.
      if (slug === undefined) {
        return c.html(renderAuthPage({ kind: "expired" }), 400);
      }
      const name = appsDir ? await appName(appsDir, slug) : slug;
      const page = failed(
        new Error(`App sign-in failed: ${result.error.message}`),
        { connecting: name, provider: name },
      );
      if (appsDir) {
        await recordConnection(slug, {
          error: result.error.message,
          status: "failed",
        });
        workspacePublisher.publish("app.updated", null);
        workspacePublisher.publish("app.event", {
          detail: result.error.message,
          event: "failed",
          name,
          slug,
        });
      }
      return c.html(page, 400);
    }
    const name = appsDir
      ? await appName(appsDir, result.value.slug)
      : result.value.slug;
    if (appsDir) {
      await announceConnected(appsDir, result.value.slug);
    }
    // A sign-in that ran in the window's own browser lands on the service
    // itself, signed in: the connection is visible where it matters, and no
    // page of ours is left in the tab. One that ran in the user's browser
    // gets a page that says what happened and the way back into the app.
    const home = appsDir
      ? await appHome(appsDir, result.value.slug)
      : undefined;
    if (result.value.opensIn === "app" && home) {
      return c.redirect(home);
    }
    return c.html(
      renderAuthPage({
        inFront: false,
        kind: "connected",
        service: {
          mark: appsDir ? await appMark(appsDir, result.value.slug) : undefined,
          name,
        },
      }),
    );
  });

  // Sign in with ChatGPT lands here. The sign-in is finished before the page
  // renders, so it says whether the plan is ready, and the window comes back
  // to the front because the browser it ran in is the user's own.
  app.get(CHATGPT_CALLBACK_PATH, async (c) => {
    const params = new URL(c.req.url).searchParams;
    const finished = receiveChatGPTCallback(params);
    if (!finished) {
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }
    const chatGPT = { mark: OPENAI_MARK, name: "ChatGPT" };
    const failedPage = (error: Error) =>
      failed(error, { connecting: chatGPT.name, provider: "OpenAI" });
    const status = await finished.then(
      (value) => ({ value }),
      (error: unknown) =>
        failedPage(new Error("ChatGPT sign-in failed", { cause: error })),
    );
    focusAppWindow();
    if (!("value" in status)) {
      return c.html(status, 400);
    }
    const account = status.value;
    if (account === undefined) {
      // Canceled on OpenAI's page, or a newer sign-in took this one's place.
      return params.get("error") === "access_denied"
        ? c.html(
            renderAuthPage({
              fromChat: false,
              kind: "declined",
              service: chatGPT,
            }),
          )
        : c.html(renderAuthPage({ kind: "expired" }), 400);
    }
    if (account.state !== "signed-in") {
      return c.html(
        failedPage(new Error(`ChatGPT sign-in ended ${account.state}`)),
        400,
      );
    }
    return c.html(
      renderAuthPage({
        email: account.email,
        inFront: true,
        kind: "connected",
        service: chatGPT,
      }),
    );
  });

  app.get("/test", (c) =>
    c.html(
      renderAuthPage({
        index: previewOutcomes.map(({ label }, i) => ({
          href: `/test/${String(i)}`,
          label,
        })),
      }),
    ),
  );
  app.get("/test/:index", (c) => {
    const preview = previewOutcomes[Number(c.req.param("index"))];
    return preview ? c.html(renderAuthPage(preview.outcome)) : c.notFound();
  });

  return { port };
}

import { receiveInstrumentCallback } from "@/electron-main/auth/client";
import {
  GOOGLE_MARK,
  newAuthReference,
  OPENAI_MARK,
  OPENROUTER_MARK,
  previewOutcomes,
  renderAuthPage,
} from "@/electron-main/auth/page";
import { AUTH_CALLBACK_PATHS } from "@/electron-main/auth/routes";
import { setAuthServerPort } from "@/electron-main/auth/state";
import {
  appMark,
  appName,
  getAppsDir,
  receiveAppCallback,
} from "@/electron-main/lib/apps";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { directoryIconDataUri } from "@/electron-main/lib/directory-icons";
import { receiveChatGPTCallback } from "@/electron-main/lib/chatgpt-account";
import { receiveOpenRouterCallback } from "@/electron-main/lib/openrouter-connect";
import { focusAppWindow } from "@/electron-main/windows/foreground";
import { serve } from "@hono/node-server";
import { listenWithPortFallback, PORTS } from "@instrument-org/shared";
import { type Context, type Handler, Hono } from "hono";
import fs from "node:fs/promises";

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
      { area: "auth" },
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
  const app = createAuthCallbackApp();

  // IPv4 loopback keeps callbacks and preview pages off the local network.
  const bound = await listenWithPortFallback({
    basePort: DEFAULT_PORT,
    listen: (port) => serve({ fetch: app.fetch, hostname: "127.0.0.1", port }),
  }).catch((error: unknown) => {
    captureServerException(
      new Error("Failed to start the auth callback server", { cause: error }),
      { area: "auth" },
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
        area: "auth",
      },
    );
  });

  return { port };
}

export function createAuthCallbackApp() {
  const app = new Hono();
  const paths = new Set<string>();
  const get = (path: string, handler: Handler) => {
    if (paths.has(path)) {
      throw new Error(`Duplicate auth callback route: GET ${path}`);
    }
    paths.add(path);
    app.get(path, handler);
  };

  get("/icon.png", (c) =>
    serveAsset(
      c,
      () => import("../../../resources/icon.png?asset"),
      "image/png",
    ),
  );
  get("/app-icon-stylized.png", (c) =>
    serveAsset(
      c,
      () => import("../../client/assets/app-icon-stylized.png?asset"),
      "image/png",
    ),
  );
  get("/favicon.ico", (c) =>
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
  get("/fonts/roboto-serif-400.woff2", (c) =>
    serveAsset(
      c,
      () =>
        import("@fontsource/roboto-serif/files/roboto-serif-latin-400-normal.woff2?asset"),
      "font/woff2",
    ),
  );
  get("/tailwind.js", (c) =>
    serveAsset(
      c,
      () => import("../../../resources/tailwind-browser.js?asset"),
      "application/javascript",
    ),
  );

  const googleService = { mark: GOOGLE_MARK, name: "Google" };
  // A failure the page offers a reference for, logged under that reference.
  const failed = (error: Error, page: { connecting?: string } = {}) => {
    const reference = newAuthReference();
    captureServerException(error, {
      area: "auth",
      data: { authReference: reference },
    });
    return renderAuthPage({ ...page, kind: "failed", reference });
  };

  // The API's Google sign-in lands here with a single-use token, or with the
  // error that ended it.
  get(AUTH_CALLBACK_PATHS.instrument, async (c) => {
    const finished = receiveInstrumentCallback(new URL(c.req.url).searchParams);
    if (!finished) {
      captureServerException(
        new Error("Sign-in callback received with invalid state"),
        { area: "auth" },
      );
      focusAppWindow();
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }
    let result: Awaited<typeof finished>;
    try {
      result = await finished;
    } catch (error) {
      const page = failed(new Error("Error signing in", { cause: error }));
      focusAppWindow();
      return c.html(page, 400);
    }
    switch (result.outcome) {
      case "canceled": {
        focusAppWindow();
        return c.html(renderAuthPage({ kind: "expired" }), 400);
      }
      case "declined": {
        focusAppWindow();
        return c.html(
          renderAuthPage({
            kind: "declined",
            service: googleService,
            signIn: true,
          }),
        );
      }
      case "sign-up-refused": {
        focusAppWindow();
        return c.html(renderAuthPage({ kind: "sign-up-refused" }), 403);
      }
      case "signed-in": {
        // Delay focus so the renderer has time to navigate to the success
        // screen before the window comes to front -- keeps the entrance
        // animation visible.
        setTimeout(focusAppWindow, 400);
        return c.html(
          renderAuthPage({
            email: result.email,
            kind: "signed-in",
            service: googleService,
          }),
        );
      }
    }
  });

  // An app's sign-in lands here after the user approves. The page opened in
  // the window's own browser, so this renders where the user is looking
  // rather than pulling focus.
  get(AUTH_CALLBACK_PATHS.app, async (c) => {
    const result = await receiveAppCallback(new URL(c.req.url).searchParams);
    if (result.outcome === "expired") {
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }
    const appsDir = getAppsDir();
    const name = appsDir ? await appName(appsDir, result.slug) : result.slug;
    const service = {
      mark: appsDir ? await appMark(appsDir, result.slug) : undefined,
      name,
    };
    switch (result.outcome) {
      case "connected": {
        // Either way the tab gets a page that says what happened. The window
        // takes itself back to the app's page when the sign-in it waited on
        // lands; one that ran in the user's own browser also brings the
        // window to the front, so that way back is already taken.
        if (result.opensIn !== "app") {
          focusAppWindow();
        }
        return c.html(renderAuthPage({ kind: "connected", service }));
      }
      case "declined": {
        focusAppWindow();
        return c.html(renderAuthPage({ kind: "declined", service }));
      }
      case "refused": {
        // The card back in the app offers signing in on the web.
        focusAppWindow();
        return c.html(
          renderAuthPage({
            headline: `${name} won’t let this account connect directly`,
            kind: "declined",
            service,
          }),
        );
      }
      case "failed": {
        const page = failed(new Error(`App sign-in failed: ${result.error}`), {
          connecting: name,
        });
        focusAppWindow();
        return c.html(page, 400);
      }
    }
  });

  // Sign in with ChatGPT lands here. The sign-in is finished before the page
  // renders, so it says whether the plan is ready, and the window comes back
  // to the front because the browser it ran in is the user's own.
  get(AUTH_CALLBACK_PATHS.chatgpt, async (c) => {
    const params = new URL(c.req.url).searchParams;
    const finished = receiveChatGPTCallback(params);
    if (!finished) {
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }
    const chatGPT = { mark: OPENAI_MARK, name: "ChatGPT" };
    const failedPage = (error: Error) =>
      failed(error, { connecting: chatGPT.name });
    const status = await finished.then(
      (value) => ({ value }),
      (error: unknown) =>
        failedPage(new Error("ChatGPT sign-in failed", { cause: error })),
    );
    focusAppWindow();
    if (!("value" in status)) {
      return c.html(status, 400);
    }
    const { account, outcome } = status.value;
    switch (outcome) {
      case "canceled": {
        // A newer sign-in took this one's place, or it was given up in the app.
        return c.html(renderAuthPage({ kind: "expired" }), 400);
      }
      case "declined": {
        return c.html(renderAuthPage({ kind: "declined", service: chatGPT }));
      }
      case "plan-off": {
        // Signed in, with plan access left unchecked on OpenAI's page.
        return c.html(
          renderAuthPage({
            headline: "ChatGPT account access is off",
            kind: "declined",
            service: chatGPT,
          }),
        );
      }
      case "signed-in": {
        return c.html(
          renderAuthPage({
            email: account?.email,
            kind: "connected",
            service: chatGPT,
          }),
        );
      }
    }
  });

  get(AUTH_CALLBACK_PATHS.openrouter, async (c) => {
    const finished = receiveOpenRouterCallback(new URL(c.req.url).searchParams);
    if (!finished) {
      return c.html(renderAuthPage({ kind: "expired" }), 400);
    }
    const openRouter = { mark: OPENROUTER_MARK, name: "OpenRouter" };
    const status = await finished.then(
      (value) => ({ value }),
      (error: unknown) =>
        failed(new Error("Connecting OpenRouter failed", { cause: error }), {
          connecting: openRouter.name,
        }),
    );
    focusAppWindow();
    if (!("value" in status)) {
      return c.html(status, 400);
    }
    switch (status.value.outcome) {
      case "canceled": {
        // A newer connect took this one's place, or it was given up in the app.
        return c.html(renderAuthPage({ kind: "expired" }), 400);
      }
      case "connected": {
        return c.html(
          renderAuthPage({ kind: "connected", service: openRouter }),
        );
      }
      case "declined": {
        return c.html(
          renderAuthPage({ kind: "declined", service: openRouter }),
        );
      }
    }
  });

  get("/test", (c) =>
    c.html(
      renderAuthPage({
        index: previewOutcomes().map(({ label }, i) => ({
          href: `/test/${String(i)}`,
          label,
        })),
      }),
    ),
  );
  get("/test/:index", async (c) => {
    const previews = previewOutcomes(await directoryIconDataUri("linear"));
    const preview = previews[Number(c.req.param("index"))];
    return preview ? c.html(renderAuthPage(preview.outcome)) : c.notFound();
  });

  return app;
}

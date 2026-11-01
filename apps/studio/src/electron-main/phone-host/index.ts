import { getAppSession } from "@/electron-main/lib/app-session";
import { computerFileBase } from "@/electron-main/lib/computer-files";
import { logger } from "@/electron-main/lib/electron-logger";
import { getUserDataDir } from "@/electron-main/lib/get-workspace-folder";
import { readSetupState } from "@/electron-main/lib/setup-state";
import { systemCountry } from "@/electron-main/lib/system-country";
import { resolvedTheme } from "@/electron-main/lib/theme-utils";
import {
  rpcClientInterceptors,
  rpcContextFor,
} from "@/electron-main/rpc/initialize";
import { router } from "@/electron-main/rpc/routes";
import { getAppWindow } from "@/electron-main/windows/app-window";
import { APP_PROTOCOL } from "@instrument-org/shared";
import { RPCHandler } from "@orpc/server/ws";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";

/**
 * A development host for a phone or a browser on the network, which serves
 * this app's own renderer the router it talks to in the window, over HTTP:
 * the spike that shows the window's interface driven from another device.
 *
 * Nothing here is for a shipping build. It binds every interface, so the
 * whole router (files, the shell, the workspace) is one bearer token away
 * from anyone on the network; `INSTRUMENT_PHONE_HOST=1` turns it on, and the
 * token is kept in userData so the address a phone has keeps working across
 * the relaunches a development edit causes.
 *
 * What it answers:
 * - `/rpc?token=`: the router over one WebSocket, as the window's message
 *   port serves it. One socket rather than HTTP because the window holds
 *   dozens of live subscriptions open at once, and a browser allows six
 *   connections to a host over plain HTTP, after which every call waits.
 * - `/bootstrap`: what the preload reads for the window before its first
 *   render, as one JSON document.
 * - `/p/<token>/<host>/<path>`: the app's own scheme by proxy, so a file on
 *   this computer, a site's icon or a viewer's engine loads on the phone from
 *   the URL the renderer builds for it. The token is in the path because an
 *   `<img>` sends no header.
 */
const DEFAULT_PORT = 48180;
const TOKEN_FILE = "phone-host.json";

const log = logger.scope("phone-host");

export function startPhoneHost(): void {
  const port = Number(process.env.INSTRUMENT_PHONE_HOST_PORT ?? DEFAULT_PORT);
  const token = loadToken();
  const handler = new RPCHandler(router, {
    clientInterceptors: rpcClientInterceptors,
  });
  const sockets = new WebSocketServer({ noServer: true });

  const server = http.createServer((request, response) => {
    void serve(request, response).catch((error: unknown) => {
      log.error("Request failed", error);
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
  });

  async function serve(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (url.pathname.startsWith("/p/")) {
      await proxyAppProtocol({ request, response, token, url });
      return;
    }
    if (!isAuthorized(request, token)) {
      response.writeHead(401, corsHeaders());
      response.end();
      return;
    }
    if (url.pathname === "/bootstrap") {
      const body = JSON.stringify(bootstrap({ origin: url.origin, token }));
      response.writeHead(200, {
        ...corsHeaders(),
        "content-type": "application/json",
      });
      response.end(body);
      return;
    }
    response.writeHead(404, corsHeaders());
    response.end();
  }

  // The socket's token rides in the query: a browser's WebSocket sends no
  // header of its own.
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const given = url.searchParams.get("token");
    if (url.pathname !== "/rpc" || !given || !sameToken(given, token)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      void handler.upgrade(ws, {
        context: rpcContextFor(getAppWindow()?.webContents.id ?? -1),
      });
    });
  });

  server.listen(port, "0.0.0.0", () => {
    const address = lanAddress();
    const rendererURL = process.env.ELECTRON_RENDERER_URL;
    const page = rendererURL
      ? new URL("phone.html", rendererURL.replace("localhost", address)).href
      : "(a built renderer: no dev server to load the page from)";
    const open = `${page}#host=http://${address}:${String(port)}&token=${token}`;
    log.info(`Phone host on http://${address}:${String(port)}; open ${open}`);
    fs.writeFileSync(
      path.join(getUserDataDir(), TOKEN_FILE),
      JSON.stringify({ open, token }, null, 2),
    );
  });
  server.on("error", (error) => {
    log.error("Phone host could not listen", error);
  });
}

function bootstrap({ origin, token }: { origin: string; token: string }) {
  return {
    computerFileBase: `${origin}/p/${token}/${new URL(computerFileBase()).hostname}`,
    homeDir: os.homedir(),
    platform: process.platform,
    setupState: readSetupState(),
    systemRegion: systemCountry(),
    theme: resolvedTheme(),
  };
}

/** The app's scheme answered over HTTP: `/p/<token>/<host>/<path>` as `<scheme>://<host>/<path>`. */
async function proxyAppProtocol({
  request,
  response,
  token,
  url,
}: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  token: string;
  url: URL;
}) {
  const [, , given, host, ...rest] = url.pathname.split("/");
  if (!given || !host || !sameToken(given, token)) {
    response.writeHead(401, corsHeaders());
    response.end();
    return;
  }
  const target = `${APP_PROTOCOL}://${host}/${rest.join("/")}${url.search}`;
  const headers: Record<string, string> = {};
  for (const name of ["accept", "range"]) {
    const value = request.headers[name];
    if (typeof value === "string") {
      headers[name] = value;
    }
  }
  const answer = await getAppSession().fetch(target, {
    headers,
    method: request.method,
  });
  const out: Record<string, string> = { ...corsHeaders() };
  answer.headers.forEach((value, name) => {
    if (name !== "access-control-allow-origin") {
      out[name] = value;
    }
  });
  response.writeHead(answer.status, out);
  if (!answer.body || request.method === "HEAD") {
    response.end();
    return;
  }
  // A web stream from Electron's fetch, read by Node's: the same bytes, typed
  // by two libraries that do not know each other.
  Readable.fromWeb(answer.body as Parameters<typeof Readable.fromWeb>[0]).pipe(
    response,
  );
}

function corsHeaders() {
  return {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "*",
  };
}

function isAuthorized(request: http.IncomingMessage, token: string) {
  const header = request.headers.authorization;
  const given = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  return given !== undefined && sameToken(given, token);
}

function sameToken(given: string, token: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The token, kept across launches so the phone's address stays good. */
function loadToken(): string {
  const file = path.join(getUserDataDir(), TOKEN_FILE);
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- userData, never in a synced folder
    const kept: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      kept !== null &&
      typeof kept === "object" &&
      "token" in kept &&
      typeof kept.token === "string" &&
      kept.token.length >= 32
    ) {
      return kept.token;
    }
  } catch {
    // A first run, or a file that does not read: a new token below.
  }
  return randomBytes(16).toString("hex");
}

/** This computer's address on the network, for the phone to reach it by. */
function lanAddress(): string {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

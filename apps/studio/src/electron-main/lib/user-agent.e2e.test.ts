import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// End-to-end check that applyStandardUserAgent actually rewrites a real Electron
// session: it boots the real Electron binary, loads a URL through a normalized
// session, and asserts the headers the server receives. This is the wiring the
// unit tests can't cover (they mock electron), and it's the exact failure mode
// we hit once (app.getName() not matching the UA's app token). It's heavy -- it
// launches a GUI Electron process and needs a display -- so it's gated behind an
// env var rather than run in CI or a normal `pnpm test`. Run it on demand with:
//
//   USER_AGENT_E2E=1 pnpm test run src/electron-main/lib/user-agent.e2e.test.ts
//
// (unset ELECTRON_RUN_AS_NODE first if your shell exports it -- the child is
// stripped of it below, but the parent vitest run doesn't need it either).

type Env = typeof process.env & {
  ELECTRON_RUN_AS_NODE?: string;
  USER_AGENT_E2E?: string;
};
const env = process.env as Env;

const ENABLED = env.USER_AGENT_E2E === "1";

// Resolve the Electron executable straight from the package's path.txt, the same
// way electron's own index.js does. Avoids `import "electron"`, which the test
// setup auto-mocks.
function electronExecutable(): string {
  const require = createRequire(import.meta.url);
  const electronDir = path.dirname(require.resolve("electron/package.json"));
  const relative = fs
    .readFileSync(path.join(electronDir, "path.txt"), "utf8")
    .trim();
  return path.join(electronDir, "dist", relative);
}

// A minimal Electron main process: strip the live user-agent.ts to plain ESM,
// load a URL through a normalized session, and print the request headers the
// local server sees. Kept as an inline template so the test always exercises the
// current source and leaves no committed harness file behind.
const HARNESS = `
import { app, BrowserWindow, session } from "electron";
import http from "node:http";
import { applyStandardUserAgent } from "./user-agent.mjs";

const captured = {};
const server = http.createServer((req, res) => {
  Object.assign(captured, req.headers);
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});

async function main() {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const guestSession = session.fromPartition("user-agent-e2e-check");
  applyStandardUserAgent(guestSession);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: guestSession },
  });
  await win.loadURL(\`http://127.0.0.1:\${port}/\`);
  process.stdout.write("UA_E2E_RESULT " + JSON.stringify(captured) + "\\n");
  win.destroy();
  server.close();
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\\n");
  app.exit(1);
});
`;

function runHarness(): Record<string, string> {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "user-agent.ts"),
    "utf8",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "user-agent-e2e-"));
  try {
    fs.writeFileSync(
      path.join(dir, "user-agent.mjs"),
      stripTypeScriptTypes(source, { mode: "strip" }),
    );
    const harnessPath = path.join(dir, "harness.mjs");
    fs.writeFileSync(harnessPath, HARNESS);

    const childEnv: Env = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const stdout = execFileSync(electronExecutable(), [harnessPath], {
      encoding: "utf8",
      env: childEnv,
      timeout: 60_000,
    });

    const line = stdout
      .split("\n")
      .find((entry) => entry.startsWith("UA_E2E_RESULT "));
    if (!line) {
      throw new Error(`no result line in harness output:\n${stdout}`);
    }
    const parsed: unknown = JSON.parse(line.slice("UA_E2E_RESULT ".length));
    return parsed as Record<string, string>;
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

const expectedPlatformHint =
  process.platform === "darwin"
    ? '"macOS"'
    : process.platform === "win32"
      ? '"Windows"'
      : '"Linux"';

describe.runIf(ENABLED)("applyStandardUserAgent against real Electron", () => {
  it("serves a standard Chrome UA and consistent client hints", () => {
    const headers = runHarness();
    const userAgent = headers["user-agent"] ?? "";

    // No extra product tokens survive -- this is exactly what regressed once.
    expect(userAgent).not.toMatch(/Electron\//);
    expect(userAgent).not.toMatch(/Instrument/);
    expect(userAgent).toMatch(/ Chrome\/\d+/);
    expect(userAgent).toMatch(/ Safari\/537\.36$/);

    // Client hints agree with the surviving Chrome major version.
    const major = / Chrome\/(\d+)\./.exec(userAgent)?.[1] ?? "";
    expect(major).toBeTruthy();
    expect(headers["sec-ch-ua"]).toContain(`"Google Chrome";v="${major}"`);
    expect(headers["sec-ch-ua-mobile"]).toBe("?0");
    expect(headers["sec-ch-ua-platform"]).toBe(expectedPlatformHint);
    expect(headers["accept-language"]).toBeTruthy();
  }, 90_000);
});

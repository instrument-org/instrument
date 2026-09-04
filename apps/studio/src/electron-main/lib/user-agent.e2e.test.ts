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
// load a URL through a normalized session, and print both what the local server
// received and what the page itself reports, so the two identity surfaces can be
// compared against each other. Kept as an inline template so the test always
// exercises the current source and leaves no committed harness file behind.
const HARNESS = `
import { app, BrowserWindow, session } from "electron";
import http from "node:http";
import {
  applyProductBrandedMetadata,
  applyStandardUserAgent,
} from "./user-agent.mjs";

// Name the app the way the real bootstrap does. An Electron left with its
// default name omits the product token entirely, and that token is what the
// identity now rests on, so an unnamed harness would test a shape we do not
// ship.
app.setName("Instrument");
const productBranded = process.argv.includes("--product-branded");
const captured = {};
const server = http.createServer((req, res) => {
  Object.assign(captured, req.headers);
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>ua</title>");
});

const PAGE_IDENTITY = \`({
  brands: navigator.userAgentData.brands
    .map((entry) => '"' + entry.brand + '";v="' + entry.version + '"')
    .join(", "),
  languages: navigator.languages,
  mobile: navigator.userAgentData.mobile,
  platform: navigator.userAgentData.platform,
  userAgent: navigator.userAgent,
})\`;

async function main() {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const guestSession = session.fromPartition(
    productBranded ? "user-agent-e2e-branded" : "user-agent-e2e-check",
  );
  applyStandardUserAgent(guestSession, { productBranded });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: guestSession },
  });
  if (productBranded) {
    win.webContents.debugger.attach("1.3");
    applyProductBrandedMetadata(win.webContents);
  }
  await win.loadURL(\`http://127.0.0.1:\${port}/\`);
  const page = await win.webContents.executeJavaScript(PAGE_IDENTITY, true);
  process.stdout.write(
    "UA_E2E_RESULT " + JSON.stringify({ headers: captured, page }) + "\\n",
  );
  win.destroy();
  server.close();
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\\n");
  app.exit(1);
});
`;

interface HarnessResult {
  headers: Record<string, string>;
  page: {
    brands: string;
    languages: string[];
    mobile: boolean;
    platform: string;
    userAgent: string;
  };
}

function runHarness({ productBranded = false } = {}): HarnessResult {
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
    const args = productBranded
      ? [harnessPath, "--product-branded"]
      : [harnessPath];
    const stdout = execFileSync(electronExecutable(), args, {
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
    return parsed as HarnessResult;
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
  it("serves the shape a Chromium-derived browser ships, with consistent hints", () => {
    const { headers, page } = runHarness();
    const userAgent = headers["user-agent"] ?? "";

    // The framework token goes, the app's own token stays, and the Chrome
    // version is reduced the way every shipping Chromium browser reduces it. A
    // UA with no product token is the shape Google's sign-in refuses.
    expect(userAgent).not.toMatch(/Electron\//);
    expect(userAgent).toMatch(/ Instrument\/\S+ Chrome\/\d+\.0\.0\.0 /);
    expect(userAgent).toMatch(/ Safari\/537\.36$/);

    const major = / Chrome\/(\d+)\./.exec(userAgent)?.[1] ?? "";
    expect(major).toBeTruthy();
    expect(headers["sec-ch-ua"]).toContain(`"Chromium";v="${major}"`);
    expect(headers["sec-ch-ua-mobile"]).toBe("?0");
    expect(headers["sec-ch-ua-platform"]).toBe(expectedPlatformHint);
    expect(headers["accept-language"]).toBeTruthy();

    // The header identity and the page identity describe the same browser. A
    // site that reads both surfaces has nothing to compare and disagree about,
    // which is the whole reason the brand list is generated rather than written.
    expect(headers["sec-ch-ua"]).toBe(page.brands);
    expect(headers["user-agent"]).toBe(page.userAgent);
    expect(headers["sec-ch-ua-platform"]).toBe(`"${page.platform}"`);
    expect(headers["sec-ch-ua-mobile"]).toBe(page.mobile ? "?1" : "?0");
    expect(headers["accept-language"]).toContain(page.languages[0] ?? "");
  }, 90_000);

  // The guest session's configuration: the app names itself in the brand list
  // too, which only holds together because the page-side metadata moves with it.
  it("names the app on both surfaces for a product-branded session", () => {
    const { headers, page } = runHarness({ productBranded: true });
    const major =
      / Chrome\/(\d+)\./.exec(headers["user-agent"] ?? "")?.[1] ?? "";

    expect(headers["sec-ch-ua"]).toContain(`"Chromium";v="${major}"`);
    expect(headers["sec-ch-ua"]).toMatch(/"Instrument";v="\d+"/);
    expect(headers["sec-ch-ua"]).toBe(page.brands);
    expect(headers["user-agent"]).toBe(page.userAgent);
    expect(page.languages.length).toBeGreaterThan(0);
  }, 90_000);
});

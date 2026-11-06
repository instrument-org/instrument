import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { openPathOnComputer } from "../lib/open-path";
import { log } from "./log";

const execFileAsync = promisify(execFile);

/** How long the desktop app's helper gets to answer before the check gives up. */
const REPLY_TIMEOUT_MS = 4000;

/**
 * Where an extension stands with the app on this computer it talks to:
 * connected, refused because the app does not trust this browser, or the app
 * is not installed. Null when the helper never answered, which says nothing.
 */
export type ExtensionConnection = "connected" | "no-app" | "refused";

/**
 * The extensions that talk to an app on this computer over native messaging
 * and refuse a browser the app has not approved, by extension id: the host
 * the extension connects to, the first message it sends, what the helper's
 * refusal says, and where the app itself is beside its helper.
 */
const DESKTOP_APPS: Record<
  string,
  {
    /** The program files that are the app, beside its helper, on the systems where the helper is not inside the app's bundle. */
    appBeside: string[];
    ask: unknown;
    /** The app's own page on taking a browser it does not know. */
    help: string;
    host: string;
    name: string;
    refusal: string;
  }
> = {
  // 1Password's helper answers the extension's first message with
  // BrowserVerificationFailed when the browser is not on its list or added
  // under Settings › Browser › Add Browser.
  aeblfdkhhhdcdjpifhhbdiojplfjncoa: {
    appBeside: ["1Password.exe", "1password"],
    ask: {
      callbackId: 1,
      invocation: {
        content: { supportsDelegation: true, userRequested: false, version: 1 },
        type: "NmRequestAccounts",
      },
    },
    help: "https://support.1password.com/additional-browsers/",
    host: "com.1password.1password",
    name: "1Password",
    refusal: "BrowserVerificationFailed",
  },
};

/** The app an extension talks to on this computer, by name, with its page on adding a browser; null for one that talks to none. */
export function desktopAppOf(
  extensionId: string,
): null | { help: string; name: string } {
  const entry = DESKTOP_APPS[extensionId];
  return entry ? { help: entry.help, name: entry.name } : null;
}

/**
 * Asks the extension's desktop app, through its helper, whether it takes
 * this browser, the way the extension's own first message does: spawned
 * from the main process, which is the program the helper checks the
 * signature of. Null for an extension that talks to no app, or a helper
 * that gave no answer in time.
 */
export async function checkExtensionConnection(
  extensionId: string,
): Promise<ExtensionConnection | null> {
  const entry = DESKTOP_APPS[extensionId];
  if (!entry) {
    return null;
  }
  const host = await readHostManifest(entry.host);
  if (
    !host ||
    !host.allowed_origins.includes(`chrome-extension://${extensionId}/`)
  ) {
    return "no-app";
  }
  const reply = await askHost(host.path, extensionId, entry.ask);
  if (reply === null) {
    log.warn(`${entry.name}'s helper did not answer the connection check`);
    return null;
  }
  return reply.includes(entry.refusal) ? "refused" : "connected";
}

/** Opens the app an extension talks to, found beside its helper, for the person to approve this browser in. */
export async function openDesktopApp(extensionId: string): Promise<void> {
  const entry = DESKTOP_APPS[extensionId];
  if (!entry) {
    return;
  }
  const host = await readHostManifest(entry.host);
  if (!host) {
    return;
  }
  const target = appPathOf(host.path, entry.appBeside);
  if (!target) {
    log.warn(`no app to open beside ${host.path}`);
    return;
  }
  const failure = await openPathOnComputer(target);
  if (failure) {
    log.warn(`could not open ${target}: ${failure}`);
  }
}

/**
 * The app a helper belongs to: on macOS the outermost bundle the helper is
 * inside, elsewhere one of the app's own program files beside it.
 */
function appPathOf(helperPath: string, appBeside: string[]): null | string {
  if (process.platform === "darwin") {
    const parts = helperPath.split(path.sep);
    const bundle = parts.findIndex((part) => part.endsWith(".app"));
    return bundle === -1 ? null : parts.slice(0, bundle + 1).join(path.sep);
  }
  const dir = path.dirname(helperPath);
  return appBeside.map((name) => path.join(dir, name)).at(0) ?? null;
}

type HostManifest = { allowed_origins: string[]; path: string };

/**
 * The native messaging host's manifest, from where Chrome keeps them on
 * this system (the extension layer reads the same places), or null when the
 * app that writes it is not installed.
 */
async function readHostManifest(host: string): Promise<HostManifest | null> {
  for (const file of await manifestPaths(host)) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "path" in parsed &&
        typeof parsed.path === "string" &&
        "allowed_origins" in parsed &&
        Array.isArray(parsed.allowed_origins)
      ) {
        return {
          allowed_origins: parsed.allowed_origins.filter(
            (origin): origin is string => typeof origin === "string",
          ),
          path: parsed.path,
        };
      }
    } catch {
      // Not there, or not a manifest: the next place may have it.
    }
  }
  return null;
}

async function manifestPaths(host: string): Promise<string[]> {
  const file = `${host}.json`;
  switch (process.platform) {
    case "darwin":
      return [
        path.join("/Library/Google/Chrome/NativeMessagingHosts", file),
        path.join(
          os.homedir(),
          // oxlint-disable-next-line studio/no-os-words -- a path on macOS, read on macOS alone
          "Library/Application Support/Google/Chrome/NativeMessagingHosts",
          file,
        ),
      ];
    case "linux":
      return [
        path.join("/etc/opt/chrome/native-messaging-hosts", file),
        path.join(
          os.homedir(),
          ".config/google-chrome/NativeMessagingHosts",
          file,
        ),
      ];
    case "win32": {
      const keys = ["HKCU", "HKLM"].map(
        (root) =>
          `${root}\\Software\\Google\\Chrome\\NativeMessagingHosts\\${host}`,
      );
      const found = await Promise.all(keys.map(readRegistryDefault));
      return found.filter((value): value is string => value !== null);
    }
    default:
      return [];
  }
}

/** The default value of a registry key, which is where Chrome on Windows is told a host manifest's path. */
async function readRegistryDefault(key: string): Promise<null | string> {
  try {
    const { stdout } = await execFileAsync("reg", ["query", key, "/ve"]);
    return /REG_SZ\s+(.+)$/m.exec(stdout)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts the helper the way the browser does, with the extension's origin
 * as its argument, sends it one message in Chrome's native messaging
 * framing, and resolves with the first message it writes back.
 */
function askHost(
  helperPath: string,
  extensionId: string,
  message: unknown,
): Promise<null | string> {
  return new Promise((resolve) => {
    const helper = spawn(helperPath, [`chrome-extension://${extensionId}/`], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let received = Buffer.alloc(0);
    const finish = (reply: null | string) => {
      clearTimeout(timer);
      helper.kill();
      resolve(reply);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, REPLY_TIMEOUT_MS);
    helper.stdout.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 4) {
        return;
      }
      const length = received.readUInt32LE(0);
      if (received.length >= 4 + length) {
        finish(received.subarray(4, 4 + length).toString("utf8"));
      }
    });
    helper.on("error", () => {
      finish(null);
    });
    helper.on("exit", () => {
      finish(
        received.length > 4 ? received.subarray(4).toString("utf8") : null,
      );
    });
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const framed = Buffer.alloc(4 + body.length);
    framed.writeUInt32LE(body.length, 0);
    body.copy(framed, 4);
    helper.stdin.write(framed);
  });
}

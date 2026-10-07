import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import {
  type ClaudeCodeRelease,
  claudeCodeRelease,
} from "@instrument-org/ai-gateway";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { finished, pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { app, net } from "electron";
import { z } from "zod";

const log = createScopedLogger("claude-code-download");
const run = promisify(execFile);

/** Where the copies we install live, one folder per Claude Code version. */
function installRoot() {
  return path.join(app.getPath("userData"), "claude-code");
}

/** The release this build drives, or undefined where Anthropic builds none. */
export function wantedRelease(): ClaudeCodeRelease | undefined {
  try {
    return claudeCodeRelease();
  } catch (error) {
    log.warn("Couldn't read the Agent SDK's Claude Code manifest", error);
    return undefined;
  }
}

/** Our copy of the release this build drives, when it is installed whole. */
export async function currentCopy() {
  const release = wantedRelease();
  if (!release) {
    return undefined;
  }
  const binary = path.join(installRoot(), release.version, release.binary);
  try {
    const { size } = await stat(binary);
    return size === release.size ? binary : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The copy to run: the release this build drives, or, while an update to it
 * has not been installed yet, the newest one already here, so an app update
 * does not sign the person out until the download is done.
 */
export async function installedCopy() {
  const current = await currentCopy();
  const release = wantedRelease();
  if (current || !release) {
    return current;
  }
  const versions = await readdir(installRoot()).catch(() => []);
  const newest = versions
    .filter((entry) => !entry.startsWith("."))
    .sort(compareVersions)
    .at(-1);
  if (!newest) {
    return undefined;
  }
  const binary = path.join(installRoot(), newest, release.binary);
  return (await stat(binary).then(
    () => true,
    () => false,
  ))
    ? binary
    : undefined;
}

function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

const RegistryVersionSchema = z.object({
  dist: z.object({ integrity: z.string(), tarball: z.string() }),
});

/**
 * Download the Claude Code binary this build drives from npm, where Anthropic
 * publishes it beside the Agent SDK, check it against npm's integrity hash
 * and Anthropic's own checksum, and install it in the app's data folder.
 * Unmodified, and signed in to through its own flow like any other copy.
 */
export async function downloadClaudeCode(
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  const release = wantedRelease();
  if (!release) {
    throw new Error(
      `Claude Code isn't built for ${process.platform}-${process.arch}.`,
    );
  }
  const root = installRoot();
  // A download cut short by a quit leaves its staging folder behind; one at a
  // time runs, so any found now is left over.
  await removeEntries(root, (entry) => entry.startsWith(".download-"));
  const staging = path.join(root, `.download-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    const registry = RegistryVersionSchema.parse(
      await (
        await fetchOk(
          `https://registry.npmjs.org/${release.packageName.replace("/", "%2f")}/${release.packageVersion}`,
        )
      ).json(),
    );

    const tarball = path.join(staging, "package.tgz");
    const response = await fetchOk(registry.dist.tarball);
    const total =
      Number(response.headers.get("content-length")) || release.size;
    const [algorithm, expected] = registry.dist.integrity.split("-", 2);
    const hash = createHash(algorithm ?? "sha512");
    let received = 0;
    let lastReport = 0;
    if (!response.body) {
      throw new Error("The download came back empty.");
    }
    const reader = response.body.getReader();
    const file = createWriteStream(tarball);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      hash.update(value);
      received += value.length;
      if (!file.write(value)) {
        await once(file, "drain");
      }
      if (Date.now() - lastReport > 250) {
        lastReport = Date.now();
        onProgress({ received, total });
      }
    }
    file.end();
    await finished(file);
    onProgress({ received, total });
    if (hash.digest("base64") !== expected) {
      throw new Error("The download didn't match npm's integrity hash.");
    }

    // Every platform this runs on has a `tar` that reads gzip: bsdtar on
    // macOS and Windows 10 and later, GNU tar on Linux.
    await run(tarPath(), [
      "-xzf",
      tarball,
      "-C",
      staging,
      `package/${release.binary}`,
    ]);
    const extracted = path.join(staging, "package", release.binary);
    if ((await sha256(extracted)) !== release.sha256) {
      throw new Error("Claude Code didn't match Anthropic's checksum.");
    }
    await chmod(extracted, 0o755);

    const installDir = path.join(root, release.version);
    await rm(installDir, { force: true, recursive: true });
    await mkdir(installDir, { recursive: true });
    const installed = path.join(installDir, release.binary);
    await rename(extracted, installed);
    // Tidying, after the new copy is in: a copy still running, which Windows
    // will not delete, is left for the next install rather than failing this one.
    await removeEntries(
      root,
      (entry) => entry !== release.version && !entry.startsWith(".download-"),
    ).catch((error: unknown) => {
      log.warn("Couldn't remove an older Claude Code", error);
    });
    log.info(`Installed Claude Code ${release.version} at ${installed}`);
    return installed;
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

async function fetchOk(url: string) {
  // Electron's network stack, so a system proxy applies as it does to the app.
  const response = await net.fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response;
}

async function sha256(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** Removes the entries of `root` that `remove` picks. */
async function removeEntries(root: string, remove: (entry: string) => boolean) {
  const entries = await readdir(root).catch(() => []);
  for (const entry of entries) {
    if (remove(entry)) {
      await rm(path.join(root, entry), { force: true, recursive: true });
    }
  }
}

/**
 * The `tar` to unpack with. On Windows, the one Windows ships, named in full,
 * since a GNU tar earlier on the PATH would read `C:\\` as a remote host.
 */
function tarPath() {
  if (process.platform !== "win32") {
    return "tar";
  }
  const systemRoot =
    Object.entries(process.env).find(
      ([name]) => name.toLowerCase() === "systemroot",
    )?.[1] ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "tar.exe");
}

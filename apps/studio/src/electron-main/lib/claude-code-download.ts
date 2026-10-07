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
import { Result } from "typescript-result";
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

/** Why our copy of Claude Code could not be installed, by the stage that failed. */
export class ClaudeCodeInstallError extends Error {
  readonly type = "claude-code-install";
  constructor(
    readonly failedStage:
      | "download"
      | "install"
      | "unpack"
      | "unsupported"
      | "verify",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** One stage of the install, whose failure becomes that stage's error. */
function stage<T>(
  failedStage: ClaudeCodeInstallError["failedStage"],
  message: string,
  work: () => Promise<T>,
) {
  return Result.fromAsyncCatching(
    work,
    (cause) => new ClaudeCodeInstallError(failedStage, message, { cause }),
  );
}

/**
 * Download the Claude Code binary this build drives from npm, where Anthropic
 * publishes it beside the Agent SDK, check it against npm's integrity hash
 * and Anthropic's own checksum, and install it in the app's data folder.
 * Unmodified, and signed in to through its own flow like any other copy.
 */
export function downloadClaudeCode(
  onProgress: (progress: DownloadProgress) => void,
) {
  return Result.gen(async function* () {
    const release = wantedRelease();
    if (!release) {
      return Result.error(
        new ClaudeCodeInstallError(
          "unsupported",
          `Claude Code isn't built for ${process.platform}-${process.arch}.`,
        ),
      );
    }
    const root = installRoot();
    const staging = path.join(root, `.download-${randomUUID()}`);
    yield* await stage(
      "install",
      "Couldn't make a folder for the download.",
      async () => {
        // A download cut short by a quit leaves its staging folder behind; one
        // at a time runs, so any found now is left over.
        await removeEntries(root, (entry) => entry.startsWith(".download-"));
        await mkdir(staging, { recursive: true });
      },
    );
    try {
      const registry = yield* await stage(
        "download",
        "Couldn't find Claude Code on npm.",
        async () =>
          RegistryVersionSchema.parse(
            await (
              await fetchOk(
                `https://registry.npmjs.org/${release.packageName.replace("/", "%2f")}/${release.packageVersion}`,
              )
            ).json(),
          ),
      );

      const tarball = path.join(staging, "package.tgz");
      const [algorithm, expected] = registry.dist.integrity.split("-", 2);
      const digest = yield* await stage(
        "download",
        "The Claude Code download didn't finish.",
        () =>
          downloadTo(
            registry.dist.tarball,
            tarball,
            algorithm ?? "sha512",
            release.size,
            onProgress,
          ),
      );
      if (digest !== expected) {
        return Result.error(
          new ClaudeCodeInstallError(
            "verify",
            "The Claude Code download didn't match npm's integrity hash.",
          ),
        );
      }

      const extracted = path.join(staging, "package", release.binary);
      const checksum = yield* await stage(
        "unpack",
        "Couldn't unpack the Claude Code download.",
        async () => {
          // Every platform this runs on has a `tar` that reads gzip: bsdtar on
          // macOS and Windows 10 and later, GNU tar on Linux.
          await run(tarPath(), [
            "-xzf",
            tarball,
            "-C",
            staging,
            `package/${release.binary}`,
          ]);
          return sha256(extracted);
        },
      );
      if (checksum !== release.sha256) {
        return Result.error(
          new ClaudeCodeInstallError(
            "verify",
            "Claude Code didn't match Anthropic's checksum.",
          ),
        );
      }

      const installed = yield* await stage(
        "install",
        "Couldn't install Claude Code in Instrument's folder.",
        async () => {
          await chmod(extracted, 0o755);
          const installDir = path.join(root, release.version);
          await rm(installDir, { force: true, recursive: true });
          await mkdir(installDir, { recursive: true });
          const binary = path.join(installDir, release.binary);
          await rename(extracted, binary);
          return binary;
        },
      );
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
      await rm(staging, { force: true, recursive: true }).catch(() => {});
    }
  });
}

/** Stream `url` to `file`, reporting progress, and answer its digest in base64. */
async function downloadTo(
  url: string,
  file: string,
  algorithm: string,
  expectedSize: number,
  onProgress: (progress: DownloadProgress) => void,
) {
  const response = await fetchOk(url);
  const total = Number(response.headers.get("content-length")) || expectedSize;
  if (!response.body) {
    throw new Error("The download came back empty.");
  }
  const hash = createHash(algorithm);
  const reader = response.body.getReader();
  const out = createWriteStream(file);
  let received = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    hash.update(value);
    received += value.length;
    if (!out.write(value)) {
      await once(out, "drain");
    }
    if (Date.now() - lastReport > 250) {
      lastReport = Date.now();
      onProgress({ received, total });
    }
  }
  out.end();
  await finished(out);
  onProgress({ received, total });
  return hash.digest("base64");
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
